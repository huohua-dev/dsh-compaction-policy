import { Service } from '@deepseek-ai/cordis';
import cordisPackage from '@deepseek-ai/cordis/package.json' with { type: 'json' };
import basicPackage from '@deepseek-ai/dsh-compaction-basic/package.json' with { type: 'json' };
import compactionPackage from '@deepseek-ai/dsh-compaction/package.json' with { type: 'json' };
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import z from '@deepseek-ai/schemastery';
import { policyFields } from './policy-fields.js';
import { installGlobalAdapter, UnsupportedHostError } from './global-adapter.js';
import { CORDIS_RANGE, DSH_RANGE, unsupportedHostVersions } from './host-version.js';

export const HOST_VERSIONS = Object.freeze({
  basic: basicPackage.version,
  compaction: compactionPackage.version,
  cordis: cordisPackage.version,
});

function versionGateError() {
  const issues = unsupportedHostVersions(HOST_VERSIONS);
  if (!issues.length) return null;
  return new UnsupportedHostError(
    `compaction-policy global adapter requires DSH ${DSH_RANGE} / Cordis ${CORDIS_RANGE}; unsupported: ${issues.join(', ')}`,
  );
}

/** Root plugin, intentionally NOT a compaction Service or preset provider. */
export default class GlobalCompactionPolicy {
  static inject = ['commands', 'agentPresets'];
  static Config = z.object({ policy: z.object({
    ...policyFields(),
    modelPolicies: z.array(z.object({ provider: z.string().required(), model: z.string().required(), ...policyFields() })),
    dryRun: z.boolean(),
  }) });
  constructor(ctx, config = {}) { this.ctx = ctx; this.config = config; }

  async *[Service.init]() {
    const ctx = this.ctx;
    let handle = null;
    let disabled = versionGateError();
    if (!disabled) {
      try {
        handle = installGlobalAdapter({ ctx, policy: this.config.policy,
          BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter });
      } catch (error) {
        // A host that drifted away from the verified seams must lose the
        // policy, not the application: stay loaded, leave stock Basic
        // untouched, and say why. Configuration errors are NOT host drift,
        // so rethrow anything that is not an UnsupportedHostError.
        if (!(error instanceof UnsupportedHostError)) throw error;
        disabled = error;
      }
    }
    const disabledStatus = () => ({
      enabled: false,
      reason: 'unsupported-host',
      message: disabled.message,
      hostVersions: HOST_VERSIONS,
      supportedDsh: DSH_RANGE,
      supportedCordis: CORDIS_RANGE,
    });
    if (handle) {
      yield async () => {
        const result = await handle.dispose();
        if (result === 'inactive-foreign-wrapper-retained') {
          ctx.logger?.warn('[compaction-policy] policy disabled; a foreign method wrapper was left intact. Restart after disabling both plugins to reclaim its inactive delegate.');
        }
      };
    }
    yield ctx.commands.register({
      name: 'compaction-policy-global',
      description: 'Show/reset the global official-Basic compaction policy decision.',
      handler(invocation) {
        const agent = invocation.agent;
        if (!agent?.session) return { kind: 'error', text: 'No session is available.' };
        const verb = invocation.rawInput.trim();
        if (!['', 'status', 'reset'].includes(verb)) return { kind: 'error', text: 'Usage: /compaction-policy-global [status|reset]' };
        if (!handle) {
          return { kind: 'success', text: JSON.stringify({ integration: 'global-official-basic', ...disabledStatus() }, null, 2) };
        }
        const engine = ctx.agentPresets.serviceFor(agent, 'compaction');
        if (verb === 'reset') handle.reset(engine, agent.session);
        return { kind: 'success', text: JSON.stringify({ integration: 'global-official-basic', enabled: true, ...handle.status(engine, agent.session) }, null, 2) };
      },
    });
    if (disabled) {
      ctx.logger?.warn(`[compaction-policy] global adapter disabled; stock Basic compaction is unchanged. ${disabled.message}`);
    } else {
      ctx.logger?.info(`[compaction-policy] global official-Basic adapter enabled on DSH compaction ${HOST_VERSIONS.compaction} / Cordis ${HOST_VERSIONS.cordis}; existing/future official engines covered without preset switching. Custom backends are not replaced.`);
    }
  }
}
