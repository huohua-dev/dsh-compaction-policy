import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetDefinition, createLegacyDefinition } from '../src/preset-definition.js';
const source = () => [{ insert: [{ id: 'preset-standard', config: { id: 'standard', plugins: [
  { id: 'tools', name: 'host-tools', disabled: { __js: 'process.platform' } },
  { id: 'compaction', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
    { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: { maxTokens: 65536 } },
    { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
  ] },
] } }] }];
test('opt-in preset copies host standard, preserves all companions and never mutates source', () => {
  const entries = source(); const before = structuredClone(entries);
  const preset = createPresetDefinition(entries, { policy: { mode: 'stock' } });
  assert.equal(preset.id, 'compaction-policy');
  assert.equal(preset.plugins[1].config[0].name, 'dsh-compaction-policy');
  assert.deepEqual(preset.plugins[1].config[0].config, { basic: { maxTokens: 65536 }, mode: 'stock' });
  assert.deepEqual(preset.plugins[0], before[0].insert[0].config.plugins[0]);
  assert.deepEqual(preset.plugins[1].config.slice(1), before[0].insert[0].config.plugins[1].config.slice(1));
  assert.deepEqual(entries, before);
});
test('legacy identity keeps the shipped stock composition and all original configuration', () => {
  const entries = source(); const before = structuredClone(entries);
  const legacy = createLegacyDefinition(entries);
  assert.equal(legacy.id, 'compaction-policy');
  assert.deepEqual(legacy.plugins, before[0].insert[0].config.plugins);
  assert.deepEqual(entries, before);
});
test('never clobber built-in preset ids and fail on changed host shape', () => {
  for (const id of ['standard', 'minimal', 'ptc', 'code', 'cordis', '../x', '']) assert.throws(() => createPresetDefinition(source(), { id }));
  assert.throws(() => createPresetDefinition([]));
  const noRealm = source(); noRealm[0].insert[0].config.plugins[1].isolate.compaction = false;
  assert.throws(() => createPresetDefinition(noRealm), /isolation/);
  const foreign = source(); foreign[0].insert[0].config.plugins[1].config[0].name = 'third-party';
  assert.throws(() => createPresetDefinition(foreign), /official/);
});
