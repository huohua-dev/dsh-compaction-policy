import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!process.env.DSH_HOST_ROOT) {
  console.error('Set DSH_HOST_ROOT to an installed DSH 0.2.0-rc.2 runtime root. See CONTRIBUTING.md. No host is installed automatically.');
  process.exit(2);
}
if (process.env.DSH_HOST_ROOT.includes('.asar/') && !process.versions.electron) {
  console.error('An ASAR host needs Electron in Node mode: ELECTRON_RUN_AS_NODE=1 <Electron executable> scripts/test-host.mjs. See CONTRIBUTING.md.');
  process.exit(2);
}
const result = spawnSync(process.execPath, ['--import', './scripts/host-hooks.mjs', '--test', 'test/host.integration.js', 'test/global.host.integration.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env: process.env, stdio: 'inherit',
});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
