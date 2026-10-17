import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORDIS_RANGE, DSH_RANGE } from '../src/host-version.js';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8');

test('package ships one global component and no compatibility preset exports or source', () => {
  assert.equal(pkg.exports['./global'], './src/global.js');
  assert.equal(pkg.exports['./legacy'], undefined);
  assert.equal(pkg.exports['./preset'], undefined);
  assert.deepEqual([...patch.matchAll(/\bname:\s*(\S+)/g)].map(match => match[1]), ['dsh-compaction-policy/global']);
  for (const path of ['src/legacy.js', 'src/legacy-list.js', 'src/preset.js', 'src/preset-definition.js']) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});

test('host compatibility is a shared range, never an exact host build', () => {
  // The host evaluates engines.dsh before importing plugin code. An exact
  // build here makes every DSH rc/patch bump an incompatibility error even
  // when the compaction code is byte-identical.
  assert.equal(pkg.engines.dsh, DSH_RANGE);
  assert.match(DSH_RANGE, /^\^/);
  for (const name of ['@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction', '@deepseek-ai/dsh-agent-preset-registry']) {
    assert.equal(pkg.peerDependencies[name], DSH_RANGE, name);
  }
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], CORDIS_RANGE);
});

test('preset-only peer dependencies are removed from the distributable', () => {
  for (const name of ['js-yaml', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/cordis-plugin-include']) {
    assert.equal(pkg.peerDependencies[name], undefined);
    assert.equal(pkg.peerDependenciesMeta[name], undefined);
  }
});
