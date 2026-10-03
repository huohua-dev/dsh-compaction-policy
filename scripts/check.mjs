import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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
for (const name of ['@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction']) {
  if (pkg.peerDependencies[name] !== '0.2.0-rc.2') throw new Error('Update compatibility tests before changing host range.');
}
console.log('Syntax, package inventory, host pins, and single-global bundle checks passed.');
