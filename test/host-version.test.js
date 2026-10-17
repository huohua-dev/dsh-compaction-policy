import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSemver,
  isSupportedCordisVersion,
  isSupportedDshVersion,
  parseSemver,
  unsupportedHostVersions,
} from '../src/host-version.js';

test('semver comparison orders cores, releases and prereleases', () => {
  assert.equal(compareSemver('0.2.1-rc.1', '0.2.1-rc.2'), -1);
  assert.equal(compareSemver('0.2.1-rc.2', '0.2.1'), -1);
  assert.equal(compareSemver('0.2.1', '0.2.1+build.5'), 0);
  assert.equal(compareSemver('0.2.2-alpha.1', '0.2.1'), 1);
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  assert.equal(parseSemver('0.2.1-rc..1'), null);
  assert.equal(parseSemver('not-a-version'), null);
  assert.equal(parseSemver(undefined), null);
});

test('DSH admission covers the 0.2.x line instead of one exact build', () => {
  // The regression this guards: 0.2.1-rc.1 -> 0.2.1-rc.2 changed no code,
  // yet an exact pin made the host reject the plugin as incompatible.
  for (const version of ['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.10', '0.2.1', '0.2.2-rc.1', '0.2.9', '0.2.1-rc.1+desktop']) {
    assert.equal(isSupportedDshVersion(version), true, version);
  }
  for (const version of ['0.2.0-rc.2', '0.2.0', '0.2.1-alpha.3', '0.1.7-rc.1', '0.3.0-rc.1', '0.3.0', '1.0.0', '', 'garbage', undefined]) {
    assert.equal(isSupportedDshVersion(version), false, String(version));
  }
});

test('Cordis admission stays on the verified 4.0.x patch line', () => {
  for (const version of ['4.0.4', '4.0.5', '4.0.12']) assert.equal(isSupportedCordisVersion(version), true, version);
  for (const version of ['4.0.3', '4.0.5-alpha.1', '4.1.0', '3.9.9', '5.0.0', undefined]) {
    assert.equal(isSupportedCordisVersion(version), false, String(version));
  }
});

test('unsupportedHostVersions names only the packages outside their ranges', () => {
  assert.deepEqual(unsupportedHostVersions({ basic: '0.2.1-rc.2', compaction: '0.2.1-rc.2', cordis: '4.0.5' }), []);
  assert.deepEqual(
    unsupportedHostVersions({ basic: '0.3.0', compaction: '0.2.1-rc.2', cordis: '4.1.0' }),
    ['@deepseek-ai/dsh-compaction-basic@0.3.0', '@deepseek-ai/cordis@4.1.0'],
  );
});
