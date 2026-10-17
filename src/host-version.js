// Host-version admission is deliberately coarse. A DSH release-candidate or
// patch bump must not, by itself, make the plugin unloadable: package versions
// only select the supported host generation, while the Basic method
// fingerprints in global-adapter.js are the feature-activation contract.
//
// Keep DSH_RANGE in sync with package.json (`engines.dsh` and the dsh-*
// peers). scripts/check.mjs enforces that invariant. The host evaluates
// `engines.dsh` with prereleases included, so ^0.2.1-rc.1 admits the whole
// 0.2.x host line (rc.2, the 0.2.1 release, later 0.2.x builds, ...).
export const DSH_RANGE = '^0.2.1-rc.1';
export const DSH_MIN_VERSION = '0.2.1-rc.1';

// Cordis stays on its 4.0.x patch line: lib/index.js is byte-identical across
// 4.0.4 and 4.0.5, so a patch bump cannot move the runtime-root /
// cordis.original seams this plugin depends on. A 4.1 host should be reviewed
// rather than silently admitted.
export const CORDIS_RANGE = '~4.0.4';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Object.freeze(match[4]?.split('.') ?? []),
  });
}

function comparePrerelease(left, right) {
  if (!left.length || !right.length) return left.length === right.length ? 0 : left.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareSemver(left, right) {
  const a = typeof left === 'string' ? parseSemver(left) : left;
  const b = typeof right === 'string' ? parseSemver(right) : right;
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

const DSH_MIN = parseSemver(DSH_MIN_VERSION);

// The runtime counterpart of DSH_RANGE for the host generation this adapter
// was built against: the 0.2.x line, at or after 0.2.1-rc.1.
export function isSupportedDshVersion(version) {
  const parsed = parseSemver(version);
  return parsed !== null
    && parsed.major === 0
    && parsed.minor === 2
    && compareSemver(parsed, DSH_MIN) >= 0;
}

export function isSupportedCordisVersion(version) {
  const parsed = parseSemver(version);
  return parsed !== null
    && parsed.major === 4
    && parsed.minor === 0
    && parsed.patch >= 4
    && parsed.prerelease.length === 0;
}

/** Return human-readable admission failures; an empty list admits the host. */
export function unsupportedHostVersions({ basic, compaction, cordis }) {
  const issues = [];
  if (!isSupportedDshVersion(basic)) issues.push(`@deepseek-ai/dsh-compaction-basic@${basic ?? 'unknown'}`);
  if (!isSupportedDshVersion(compaction)) issues.push(`@deepseek-ai/dsh-compaction@${compaction ?? 'unknown'}`);
  if (!isSupportedCordisVersion(cordis)) issues.push(`@deepseek-ai/cordis@${cordis ?? 'unknown'}`);
  return issues;
}
