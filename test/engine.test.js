import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, FakeSession } from './helpers.js';
const run = (f, trigger = 'pressure', signal = f.signal) => f.engine.compactIfNeeded(f.agent, trigger, signal);

test('threshold boundary and immutable main request/agent options/model info', async () => {
  const f = fixture();
  const before = structuredClone({ header: f.session.header, options: f.agent.options });
  f.session.forcedPressure = 222821;
  assert.equal(await run(f), null); assert.equal(f.state.calls, 0);
  f.session.forcedPressure = 222822;
  assert(await run(f)); assert.equal(f.state.calls, 1);
  assert.deepEqual({ header: f.session.header, options: f.agent.options }, before);
  assert.equal(f.engine.config.maxTokens, 65536);
  assert.equal(f.engine.status(f.session).reason, 'compacted-still-above-threshold');
});
test('one successful transaction per step, and only-summary is skipped', async () => {
  const f = fixture(); f.session.forcedPressure = 250000;
  await run(f); assert.equal(f.state.calls, 1);
  await run(f); assert.equal(f.state.calls, 1);
  assert.equal(f.engine.status(f.session).reason, 'insufficient-fresh-history');
});
test('100 tail appends do not reset failure cooldown; probes back off exponentially', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK';
  await assert.rejects(run(f), /not smaller/);
  for (let i = 0; i < 100; i++) { f.session.add('user/message', 1); await run(f); }
  assert.equal(f.state.calls, 1);
  assert.equal(f.engine.status(f.session).reason, 'retry-cooldown');
  f.state.now = 60000; await assert.rejects(run(f)); assert.equal(f.state.calls, 2);
  f.state.now = 179999; await run(f); assert.equal(f.state.calls, 2);
  f.state.now = 180000; await assert.rejects(run(f)); assert.equal(f.state.calls, 3);
});
test('stream failures also back off, but commit failures and cancellation do not poison the guard', async () => {
  const f = fixture(); f.state.summary = async () => { throw new Error('synthetic network failure'); };
  await assert.rejects(run(f)); await run(f); assert.equal(f.state.calls, 1);
  f.engine.reset(f.session);
  f.state.summary = async () => 'COMMIT_ERROR';
  await assert.rejects(run(f)); await assert.rejects(run(f)); assert.equal(f.state.calls, 3);
  assert.equal(f.engine.status(f.session).reason, 'transaction-failed');
});
test('model route changes clear unrelated failure scope', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK';
  await assert.rejects(run(f)); f.session.header.config.model = 'other';
  await assert.rejects(run(f)); assert.equal(f.state.calls, 2);
});
test('projected candidate content change can retry while unrelated tail cannot', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK'; await assert.rejects(run(f));
  f.session.events[1].data.content[0].text = 'materially changed';
  await assert.rejects(run(f)); assert.equal(f.state.calls, 2);
});
test('two sessions with identical seqs do not share failures', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK'; await assert.rejects(run(f));
  const other = fixture();
  await assert.rejects(f.engine.compactIfNeeded(other.agent, 'pressure', other.signal));
  assert.equal(f.state.calls, 2); await run(f); assert.equal(f.state.calls, 2);
});
test('same-session reentrancy makes only one in-flight attempt', async () => {
  const f = fixture(); let finish;
  f.state.summary = () => new Promise((resolve) => { finish = resolve; });
  const first = run(f);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await run(f), null); assert.equal(f.state.calls, 1);
  finish('done'); await first;
});
test('route mutation across model resolution yields instead of mixing requests', async () => {
  const f = fixture();
  f.ctx.llm.resolveModelInfo = async () => { f.session.header.config.model = 'new-model'; return { context: { contextWindow: 16384 } }; };
  await run(f); assert.equal(f.state.calls, 0);
  assert.equal(f.engine.status(f.session).reason, 'request-changed-during-resolution');
});
test('abort before, during resolution, and ignored by summarizer cannot commit', async () => {
  for (const phase of ['before', 'resolve', 'summary']) {
    const f = fixture(); const controller = new AbortController();
    if (phase === 'before') controller.abort();
    if (phase === 'resolve') f.ctx.llm.resolveModelInfo = async () => { controller.abort(); return { context: { contextWindow: 262144 } }; };
    if (phase === 'summary') f.state.summary = async () => { controller.abort(); return 'ignored abort'; };
    await assert.rejects(run(f, 'pressure', controller.signal), { name: 'AbortError' });
    assert.equal(f.session.surface.replaceGeneration, 0);
    assert.equal(f.session.events.filter((e) => e.type === 'compaction/start').length,
      f.session.events.filter((e) => e.type === 'compaction/end').length);
  }
});
test('overflow bypasses cooldown, small-candidate gates, invalid capacity and dry-run', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK'; await assert.rejects(run(f));
  await run(f, 'context-overflow'); assert.deepEqual(f.state.stock, ['context-overflow']);
  const dry = fixture({ dryRun: true }); dry.ctx.llm.resolveModelInfo = async () => { throw new Error('must not resolve'); };
  await run(dry, 'context-overflow'); assert.deepEqual(dry.state.stock, ['context-overflow']);
});
test('pruner runs only above the threshold and outside dry-run; remeasurement can skip LLM', async () => {
  const f = fixture(); let pruned = 0;
  f.state.toolResultPruner = { pruneSession(s) { pruned++; s.forcedPressure = 1; } };
  f.session.forcedPressure = 1; await run(f); assert.equal(pruned, 0);
  f.session.forcedPressure = 250000; await run(f); assert.equal(pruned, 1); assert.equal(f.state.calls, 0);
  assert.equal(f.engine.status(f.session).reason, 'pruning-sufficient');
  const dry = fixture({ dryRun: true }); dry.state.toolResultPruner = { pruneSession() { assert.fail('dry-run mutated history'); } };
  const count = dry.session.seq; await run(dry); assert.equal(dry.session.seq, count);
  assert.equal(dry.engine.status(dry.session).reason, 'dry-run');
});
test('summary-first pressure never prunes tools and still delegates real overflow', async () => {
  const f = fixture({ pruneToolResults: false, thresholdRatio: .9, outputReserveCap: 0, headroomTokens: 0 });
  f.state.toolResultPruner = { pruneSession() { assert.fail('summary-first pressure must not prune'); } };
  f.session.forcedPressure = 235928;
  await run(f); assert.equal(f.state.calls, 0);
  f.session.forcedPressure = 235929;
  await run(f); assert.equal(f.state.calls, 1);
  assert.equal(f.engine.status(f.session).thresholdTokens, 235929);
  await run(f, 'context-overflow'); assert.deepEqual(f.state.stock, ['context-overflow']);
});
test('an active durable lock prevents pruning and model calls', async () => {
  const f = fixture(); f.session.log('compaction/start');
  f.state.toolResultPruner = { pruneSession() { assert.fail('must not mutate active compaction'); } };
  await run(f); assert.equal(f.state.calls, 0); assert.equal(f.engine.status(f.session).reason, 'compaction-busy');
});
test('stock mode delegates; exact model override opts in', async () => {
  const f = fixture({ mode: 'stock', modelPolicies: [{ provider: 'local', model: 'model', mode: 'policy' }] });
  f.session.header.config.provider = 'other'; await run(f); assert.deepEqual(f.state.stock, ['pressure']);
  f.session.header.config.provider = 'local'; await run(f); assert.equal(f.state.calls, 1);
});
test('manual compact bypasses cooldown, forwards command id and flushes', async () => {
  const f = fixture(); f.state.summary = async () => 'NO_SHRINK'; await assert.rejects(run(f));
  f.state.summary = async () => 'manual summary';
  assert(await f.engine.compactNow(f.agent, f.signal, 'command-test'));
  assert.equal(f.state.manual, 'command-test'); assert.equal(f.state.flushes, 1);
});
test('status/reset command is content-free and invalid capacity is visible', async () => {
  const f = fixture(); f.ctx.llm.resolveModelInfo = async () => ({ context: { contextWindow: 100 } });
  await run(f); assert.equal(f.engine.status(f.session).reason, 'invalid-pressure-budget');
  const command = f.state.commands[0];
  const response = command.handler({ agent: f.agent, rawInput: 'status' });
  assert.equal(response.kind, 'success'); assert(!response.text.includes('synthetic 1'));
  command.handler({ agent: f.agent, rawInput: 'reset' });
  assert.equal(f.engine.status(f.session).reason, 'retry-guard-reset');
});
test('only-system/only-checkpoint histories do not call summarizer', async () => {
  const f = fixture(); f.agent.session = new FakeSession(); f.agent.session.forcedPressure = 250000;
  f.agent.session.add('system/message', 240000); f.agent.session.checkpoint(141); f.agent.session.add('user/message', 1);
  await run(f); assert.equal(f.state.calls, 0);
});
