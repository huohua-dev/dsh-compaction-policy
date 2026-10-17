// Host version admission, shared by the root plugin and the global adapter.
// These ranges only decide whether the method-hash gate in global-adapter.js is
// reachable; the hashes themselves are the actual compatibility contract.
export const COMPACTION_VERSION = '0.2.1-rc.1';

// Cordis allows the 4.0.x patch line: lib/index.js is byte-identical across
// 4.0.4 and 4.0.5, so a patch bump cannot move the seams this plugin depends on.
// compaction-basic stays exact — its lib/index.js was re-verified byte-identical
// between 0.2.0-rc.2 and 0.2.1-rc.1 (locale + README changes only).
export const CORDIS_RANGE = /^4\.0\.\d+$/;