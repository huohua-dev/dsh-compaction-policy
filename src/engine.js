import { resolveConfig, resolvePolicy, resolveBudget, routedTarget } from './policy.js';
import { selectRange, describeCandidate, digest, hasActiveCompaction } from './selection.js';
import { RetryGuard } from './guard.js';

const isCancellation = (error, signal) => signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORTED';
const shrinkFailure = (error) => error instanceof Error
  && /^summary is not smaller than the shadowed content \(/.test(error.message);

/** Inject the *host's* classes. This factory also makes offline, dependency-free
 * contract tests possible without vendoring any DSH implementation.
 */
export function createPolicyEngine({ BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter }, { now = Date.now } = {}) {
  const guard = new RetryGuard();
  const inFlight = new WeakSet();
  const decisions = new WeakMap();
  const summaryFailures = new WeakSet();
  const operationSignals = new WeakMap();
  const pairing = { before: toolPairingBalancedBefore, after: toolPairingBalancedAfter };

  return class PolicyCompactionEngine extends BasicCompactionEngine {
    constructor(ctx, source = {}) {
      const resolved = resolveConfig(source);
      // Keep all official listeners, including overflow recovery. These are
      // independent settings: pressure headroom never lowers the summary cap.
      super(ctx, resolved.basic);
      this.policyConfig = resolved;
      this._registerPolicyCommand();
    }

    _record(session, decision) {
      const previous = decisions.get(session);
      const next = { ...decision, at: now() };
      decisions.set(session, next);
      // Content-free and transition-only. Context grows every step; that alone
      // must not spam the log or inject more model-visible instructions.
      if (previous?.reason !== next.reason || previous?.thresholdTokens !== next.thresholdTokens) {
        this.ctx.logger?.info(`[compaction-policy] ${JSON.stringify(next)}`);
      }
      return next;
    }

    status(session) { return decisions.get(session) ?? { reason: 'not-measured' }; }
    reset(session) {
      guard.reset(session);
      return this._record(session, { reason: 'retry-guard-reset' });
    }

    _registerPolicyCommand() {
      const commands = this.ctx.get('commands');
      if (!commands) return;
      const engine = this;
      this.ctx.effect(function* () {
        yield commands.register({
          name: 'compaction-policy',
          description: 'Show the compaction policy decision, or reset its pressure retry guard.',
          handler(invocation) {
            const session = invocation.agent?.session;
            if (!session) return { kind: 'error', text: 'No session is available.' };
            const verb = invocation.rawInput.trim();
            if (verb === 'reset') engine.reset(session);
            else if (verb !== '' && verb !== 'status') return { kind: 'error', text: 'Usage: /compaction-policy [status|reset]' };
            return { kind: 'success', text: JSON.stringify(engine.status(session), null, 2) };
          },
        });
      }, 'compaction-policy command');
    }

    async compactIfNeeded(agent, trigger, signal) {
      signal?.throwIfAborted();
      if (trigger !== 'pressure' && trigger !== 'context-overflow') throw new TypeError(`unknown compaction trigger: ${trigger}`);
      // Never suppress real context-overflow recovery with a proactive guard,
      // missing capacity, a small candidate, or pressure dry-run mode.
      if (trigger === 'context-overflow') {
        const result = await super.compactIfNeeded(agent, trigger, signal);
        if (result !== null) guard.reset(agent.session);
        return result;
      }
      const session = agent.session;
      if (inFlight.has(session)) return null;
      const target = routedTarget(session);
      if (!target) return null;
      const policy = resolvePolicy(this.policyConfig, target);
      if (policy.mode === 'stock') {
        this._record(session, { ...target, reason: 'stock-policy' });
        return super.compactIfNeeded(agent, trigger, signal);
      }
      inFlight.add(session);
      try {
        return await this._policyPressure(agent, target, policy, signal);
      } finally {
        inFlight.delete(session);
      }
    }

    async _policyPressure(agent, target, policy, signal) {
      const session = agent.session;
      const header = session.requestHeader();
      const headerKey = digest(header);
      const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);
      signal?.throwIfAborted();
      // Model resolution can yield. Never evaluate a new request with the old
      // route's window, nor summarize an obsolete surface snapshot.
      if (digest(session.requestHeader()) !== headerKey) {
        this._record(session, { ...target, reason: 'request-changed-during-resolution' });
        return null;
      }
      let budget;
      try {
        budget = resolveBudget(policy, info.context?.contextWindow, header.config.maxTokens ?? info.defaultMaxTokens ?? 0);
      } catch (error) {
        this._record(session, { ...target, reason: 'invalid-pressure-budget', message: error.message });
        return null;
      }
      const meter = this.ctx.tokenMeter;
      let measurement = meter.measure(session);
      const record = (reason, extra = {}) => this._record(session, { ...target, ...budget, pressureTokens: measurement.totalTokens, reason, ...extra });
      if (!Number.isFinite(measurement.totalTokens) || measurement.totalTokens < 0) throw new Error('invalid token-meter total');
      if (measurement.totalTokens < budget.thresholdTokens) {
        record('below-threshold');
        return null;
      }
      if (hasActiveCompaction(session)) { record('compaction-busy'); return null; }
      if (!this.policyConfig.dryRun && policy.pruneToolResults) {
        this.ctx.get('toolResultPruner')?.pruneSession(session);
        signal?.throwIfAborted();
        measurement = meter.measure(session);
        if (measurement.totalTokens < budget.thresholdTokens) { record('pruning-sufficient'); return null; }
      }
      const selection = selectRange(session, measurement, { ...policy, retainTokens: budget.retainTokens }, pairing);
      if (!selection.range) { record(selection.reason); return null; }
      const range = selection.range;
      const rangeStats = {
        startSeq: range.start, endSeq: range.end, selectedTokens: range.regionTokens,
        freshTokens: range.freshTokens, retainedTokens: range.retainedTokens,
      };
      const candidate = describeCandidate(session, measurement, range, header, policy, this.config);
      const gate = guard.check(session, candidate, policy, now());
      if (!gate.allowed) { record('retry-cooldown', { ...rangeStats, retryAt: gate.retryAt }); return null; }
      if (this.policyConfig.dryRun) { record('dry-run', rangeStats); return null; }
      signal?.throwIfAborted();
      record('summarizing', rangeStats);
      try {
        // One LLM compaction transaction per pressure step. No immediate
        // second pass over the checkpoint we just created.
        const result = await this.compactRegion(range.start, range.end, agent, signal);
        guard.reset(session);
        const after = meter.measure(session);
        record(after.totalTokens < budget.thresholdTokens ? 'compacted' : 'compacted-still-above-threshold', {
          ...rangeStats, pressureAfterTokens: after.totalTokens,
        });
        return result;
      } catch (error) {
        if (!isCancellation(error, signal) && (summaryFailures.has(error) || shrinkFailure(error))) {
          const failure = guard.failed(session, candidate, policy, now());
          record('summary-failed', { ...rangeStats, retryAt: failure.retryAt, consecutiveFailures: failure.count });
        } else {
          record(isCancellation(error, signal) ? 'cancelled' : 'transaction-failed', rangeStats);
        }
        throw error; // Preserve the host's logging and failure vocabulary.
      }
    }

    async compactRegion(start, end, agent, signal) {
      const session = agent.session;
      if (operationSignals.has(session)) throw new Error('compaction-policy: a region transaction is already in progress');
      operationSignals.set(session, signal);
      try {
        return await super.compactRegion(start, end, agent, signal);
      } finally {
        operationSignals.delete(session);
      }
    }

    regionDependencies() {
      const dependencies = super.regionDependencies();
      const meter = dependencies.meter;
      // rc.2 validates whole-surface stability synchronously immediately before
      // committing. Check cancellation at that existing seam too: a check only
      // after summarize() misses a later microtask before the transaction resumes.
      // Return the exact host prices; neither the singleton nor its data changes.
      return {
        ...dependencies,
        meter: {
          measure(session, ...args) {
            operationSignals.get(session)?.throwIfAborted();
            return meter.measure(session, ...args);
          },
          estimateMessage: (...args) => meter.estimateMessage(...args),
        },
      };
    }

    async summarize(input, agent, signal) {
      try {
        const result = await super.summarize(input, agent, signal);
        // Guard the await boundary even if an adapter ignored cancellation.
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        if (!isCancellation(error, signal) && error !== null && typeof error === 'object') summaryFailures.add(error);
        throw error;
      }
    }

    async compactNow(agent, signal, sourceCommandId) {
      // A deliberate human request is never blocked by pressure cooldown.
      const result = await super.compactNow(agent, signal, sourceCommandId);
      if (result !== null) guard.reset(agent.session);
      return result;
    }
  };
}
