import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hideLegacyPreset } from '../src/legacy-list.js';
class Registry {
  defaultId = 'standard';
  rows = [{ id: 'standard' }, { id: 'compaction-policy' }];
  async list() { if (this.wait) await this.wait; return this.rows; }
}
const fingerprint = createHash('sha256').update(Registry.prototype.list.toString()).digest('hex');
const install = registry => hideLegacyPreset(registry, 'compaction-policy', fingerprint);
test('filter only hides healthy nondefault legacy row, preserving default and diagnostics', async () => {
  const registry = new Registry(); const dispose = install(registry);
  assert.deepEqual(await registry.list(), [{ id: 'standard' }]);
  registry.defaultId = 'compaction-policy'; assert.equal((await registry.list()).length, 2);
  registry.defaultId = 'standard'; registry.rows[1].broken = 'broken'; assert.equal((await registry.list()).length, 2);
  assert.equal(dispose(), 'restored'); assert(!Object.hasOwn(registry, 'list'));
});
test('independent registries and duplicate or unknown method rejection', async () => {
  const a = new Registry(), b = new Registry();
  assert.throws(() => hideLegacyPreset(a, 'compaction-policy', 'wrong'), /unsupported/);
  const dispose = install(a);
  try { assert.throws(() => install(a), /wrapped/); assert.equal((await b.list()).length, 2); }
  finally { dispose(); }
});
test('foreign wrapper is not overwritten; its retained filter is inert after disposal', async () => {
  const registry = new Registry(); const dispose = install(registry); const ours = registry.list;
  const foreign = function (...args) { return ours.apply(this, args); };
  registry.list = foreign;
  assert.equal(dispose(), 'inactive-foreign-wrapper-retained');
  assert.equal(registry.list, foreign); assert.equal((await registry.list()).length, 2);
});
test('in-flight roster reads stop filtering after disposal', async () => {
  const registry = new Registry(); let finish;
  registry.wait = new Promise(resolve => { finish = resolve; });
  const dispose = install(registry); const pending = registry.list(); dispose(); finish();
  assert.equal((await pending).length, 2);
});
