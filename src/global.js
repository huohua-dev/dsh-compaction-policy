import { Service } from '@deepseek-ai/cordis';
import cordisPackage from '@deepseek-ai/cordis/package.json' with { type: 'json' };
import compactionPackage from '@deepseek-ai/dsh-compaction/package.json' with { type: 'json' };
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import z from '@deepseek-ai/schemastery';
import { policyFields } from './index.js'; // Exact Basic version admission; no Service construction.
import { installGlobalAdapter } from './global-adapter.js';

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
    if (cordisPackage.version !== '4.0.4' || compactionPackage.version !== '0.2.0-rc.2') {
      throw new Error('compaction-policy global adapter requires verified Cordis 4.0.4 / DSH compaction 0.2.0-rc.2');
    }
    const ctx = this.ctx;
    const handle = installGlobalAdapter({ ctx, policy: this.config.policy,
      BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter });
    yield async () => {
      const result = await handle.dispose();
      if (result === 'inactive-foreign-wrapper-retained') {
        ctx.logger?.warn('[compaction-policy] policy disabled; a foreign method wrapper was left intact. Restart after disabling both plugins to reclaim its inactive delegate.');
      }
    };
    yield ctx.commands.register({
      name: 'compaction-policy-global',
      description: 'Show/reset the global official-Basic compaction policy decision.',
      handler(invocation) {
        const agent = invocation.agent;
        if (!agent?.session) return { kind: 'error', text: 'No session is available.' };
        const verb = invocation.rawInput.trim();
        if (!['', 'status', 'reset'].includes(verb)) return { kind: 'error', text: 'Usage: /compaction-policy-global [status|reset]' };
        const engine = ctx.agentPresets.serviceFor(agent, 'compaction');
        if (verb === 'reset') handle.reset(engine, agent.session);
        return { kind: 'success', text: JSON.stringify({ integration: 'global-official-basic', ...handle.status(engine, agent.session) }, null, 2) };
      },
    });
    ctx.logger?.info('[compaction-policy] global official-Basic adapter enabled; existing/future official engines covered without preset switching. Custom backends are not replaced.');
  }
}
