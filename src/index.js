import basicPackage from '@deepseek-ai/dsh-compaction-basic/package.json' with { type: 'json' };
import compactionPackage from '@deepseek-ai/dsh-compaction/package.json' with { type: 'json' };
import z from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { createPolicyEngine } from './engine.js';
import { assertBasicCompactionContract, UnsupportedHostError } from './global-adapter.js';
import { DSH_RANGE, isSupportedDshVersion } from './host-version.js';
import { policyFields } from './policy-fields.js';

export { policyFields };

// The root backend is an explicit, opt-in composition choice, so it fails
// loudly on an unverified host instead of silently behaving like stock. The
// default global entry (./global.js) does NOT import this module; it converts
// the same UnsupportedHostError into an inert, stock-preserving disable.
if (!isSupportedDshVersion(basicPackage.version) || !isSupportedDshVersion(compactionPackage.version)) {
  throw new UnsupportedHostError(
    `dsh-compaction-policy backend requires DSH ${DSH_RANGE}; found compaction-basic ${basicPackage.version} / compaction ${compactionPackage.version}.`,
  );
}
assertBasicCompactionContract({ BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter });
if (!BasicCompactionEngine.Config) {
  throw new UnsupportedHostError('dsh-compaction-policy backend requires BasicCompactionEngine.Config.');
}

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
