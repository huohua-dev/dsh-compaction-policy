import basicPackage from '@deepseek-ai/dsh-compaction-basic/package.json' with { type: 'json' };
import z from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { createPolicyEngine } from './engine.js';

const version = basicPackage.version;
if (version !== '0.2.0-rc.2') {
  throw new Error(`dsh-compaction-policy supports DSH 0.2.0-rc.2; found ${version}. Re-test before upgrading.`);
}

export const policyFields = () => ({
  mode: z.union(['policy', 'stock']),
  pruneToolResults: z.boolean(),
  thresholdRatio: z.number(),
  outputReserveCap: z.number().step(1).min(0),
  headroomTokens: z.number().step(1).min(0),
  retainRatio: z.number(),
  retainTokens: z.number().step(1).min(0),
  minFreshTokens: z.number().step(1).min(1),
  retryAfterTokens: z.number().step(1).min(1),
  retryCooldownMs: z.number().step(1).min(1),
  maxRetryCooldownMs: z.number().step(1).min(1),
});
const PolicyCompactionEngine = createPolicyEngine({
  BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter,
});
PolicyCompactionEngine.Config = z.object({
  ...policyFields(),
  modelPolicies: z.array(z.object({ provider: z.string().required(), model: z.string().required(), ...policyFields() })),
  basic: BasicCompactionEngine.Config,
  dryRun: z.boolean(),
});

export { PolicyCompactionEngine };
export default PolicyCompactionEngine;
