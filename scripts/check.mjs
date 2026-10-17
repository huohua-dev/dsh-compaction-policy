import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CORDIS_RANGE, DSH_RANGE } from '../src/host-version.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const file of pkg.files) await access(join(root, file));
if (pkg.dependencies || pkg.bundledDependencies) throw new Error('Keep host dependencies as peers; do not bundle another DSH kernel.');
for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
  if (pkg.scripts?.[name]) throw new Error(`Unexpected automatic install/pack hook: ${name}`);
}
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of await readdir(join(root, directory))) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', join(root, directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
if (/selectedDefault|agent-preset-registry|disabled:\s*true/.test(patch)) throw new Error('Bundle must not change built-ins or defaults.');
if (pkg.exports['./global'] !== './src/global.js' || !patch.includes('name: dsh-compaction-policy/global')) {
  throw new Error('Default bundle must export and load /global');
}
if ((patch.match(/\bname:/g) ?? []).length !== 1 || /legacy|\/preset|Compaction Policy \(standard\)/.test(patch)
  || pkg.exports['./legacy'] || pkg.exports['./preset']) {
  throw new Error('Bundle must contain exactly one global component and no compatibility preset');
}
// The host treats engines.dsh as the sole manifest compatibility gate and
// evaluates it with prereleases included. It must stay a *range*: an exact
// host build here is what turned every DSH rc bump into an incompatibility
// error before any plugin code could run. The method fingerprints remain
// the activation contract inside that range.
if (pkg.engines?.dsh !== DSH_RANGE || !DSH_RANGE.startsWith('^')) {
  throw new Error(`engines.dsh must be the shared non-exact host range (${DSH_RANGE}).`);
}
for (const name of ['@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction', '@deepseek-ai/dsh-agent-preset-registry']) {
  if (pkg.peerDependencies[name] !== DSH_RANGE) throw new Error(`Peer ${name} must use the shared host range (${DSH_RANGE}), not an exact build.`);
}
if (pkg.peerDependencies['@deepseek-ai/cordis'] !== CORDIS_RANGE) {
  throw new Error(`Cordis must stay on the shared 4.0.x patch range (${CORDIS_RANGE}).`);
}
console.log('Syntax, package inventory, host ranges, and single-global bundle checks passed.');
