import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader';
import Registry from '@deepseek-ai/dsh-agent-preset-registry';
import { createScope } from '@deepseek-ai/dsh-scope';
import { Session } from '@deepseek-ai/dsh-session';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import yaml from 'js-yaml';
import { hideLegacyPreset } from '../src/legacy-list.js';
import { createLegacyDefinition } from '../src/preset-definition.js';
import { installGlobalAdapter } from '../src/global-adapter.js';
import LegacyPlugin from '../src/legacy.js';

function fixture() {
  const ctx = new Context(); const state = { selected: undefined, started: false, requests: [] };
  ctx.provide('logger', { info() {}, warn() {}, error() {} });
  ctx.provide('sessionProjections', { register() { return () => {}; }, stateOf() { return { openTurnStartSeq: null, lastTurn: state.started ? 1 : 0 }; } });
  ctx.provide('sessions', { async flush() {} });
  ctx.provide('llm', { async resolveModelInfo() { return { context: { contextWindow: 262144 }, defaultMaxTokens: 131072 }; },
    imageRequestPricing() {}, async *stream(request) { state.requests.push(request); yield { type: 'text-delta', index: 0, text: 'Synthetic checkpoint.' }; yield { type: 'finish', reason: { kind: 'stop' } }; } });
  new TokenMeter(ctx);
  const loader = new Loader(ctx, { baseUrl: new URL('../', import.meta.url).href });
  loader.builtins.group = Group;
  const registry = new Registry(ctx, { default: 'standard', selectedDefault: { get: () => state.selected } });
  return { ctx, registry, service: ctx.agentPresets, state };
}

test('real registry hidden historical identity resolves, mounts, forks and retires without rewriting ids', async () => {
  const f = fixture(); const r = f.service;
  const dropStandard = await r.register({ id: 'standard', plugins: [] });
  const restore = hideLegacyPreset(r, 'compaction-policy');
  const dropLegacy = await r.register({ id: 'compaction-policy', plugins: [] });
  const a = createScope(f.ctx, {}), b = createScope(f.ctx, {});
  let lease;
  try {
    assert.deepEqual((await r.list()).map(x => x.id), ['standard']);
    assert.deepEqual((await r.remoteExportList()).presets.map(x => [x.id, x.isDefault]), [['standard', true]]);
    assert.deepEqual(await r.resolve('compaction-policy'), { id: 'compaction-policy' });
    assert.equal((await r.readDocument('compaction-policy')).agentPreset, 'compaction-policy');
    assert.deepEqual(await r.mount(a.ctx, 'compaction-policy'), { id: 'compaction-policy' });
    assert.equal(r.composeFrom(b.ctx, a.ctx), 'compaction-policy');
    assert.equal(r.composedPreset(b.ctx), 'compaction-policy');
    lease = await r.acquireScope('compaction-policy');
    const events = [];
    const agent = { id: 'synthetic', ctx: a.ctx, session: { append: (...args) => events.push(args) } };
    assert.equal(await r.select(agent, 'compaction-policy'), 'compaction-policy');
    assert.deepEqual(events, [['agent-preset/selected', { agentPreset: 'compaction-policy' }]]);
    f.state.started = true;
    await assert.rejects(r.select(agent, 'standard'), error => error.code === 'agent-preset/locked');
    f.state.selected = 'compaction-policy';
    assert((await r.remoteExportList()).presets.some(row => row.id === 'compaction-policy' && row.isDefault));
    f.state.selected = 'standard';
    await dropLegacy();
    assert.equal(r.composedPreset(a.ctx), 'compaction-policy');
    assert.equal(r.composedPreset(b.ctx), 'compaction-policy');
    await assert.rejects(r.resolve('compaction-policy'), error => error.code === 'agent-preset/not-found');
  } finally {
    if (lease) await lease[Symbol.asyncDispose]();
    await b.dispose(); await a.dispose(); await dropLegacy(); restore(); await dropStandard();
  }
  assert(!Object.hasOwn(f.registry, 'list'));
});

test('actual shipped legacy compaction group mounts official Basic and uses global policy on cold restore', async () => {
  const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml')), 'utf8');
  const definition = createLegacyDefinition(yaml.load(source, { schema: entryListSchema }));
  assert.equal(definition.id, 'compaction-policy');
  const group = definition.plugins.find(row => row.id === 'compaction');
  assert(group.config.some(row => row.name === '@deepseek-ai/dsh-compaction-basic'));
  assert(!group.config.some(row => row.name === 'dsh-compaction-policy'));
  // This is a real registry/Loader mount of the original isolated Basic row.
  // Tools, commands and pruner companions are structurally checked elsewhere;
  // unrelated whole-app services are intentionally not booted by this fixture.
  const f = fixture();
  const drop = await f.service.register({ ...definition, plugins: [{ ...group,
    config: group.config.filter(row => row.name === '@deepseek-ai/dsh-compaction-basic') }] });
  const scope = createScope(f.ctx, {});
  const adapter = installGlobalAdapter({ ctx: f.ctx, BasicCompactionEngine, toolPairingBalancedBefore, toolPairingBalancedAfter });
  try {
    assert.deepEqual(await f.service.resolve('compaction-policy'), { id: 'compaction-policy' });
    await f.service.mount(scope.ctx, 'compaction-policy');
    const header = { ...new Session('synthetic-cold-legacy').header, agentPreset: 'compaction-policy' };
    const original = new Session('synthetic-cold-legacy', undefined, header);
    original.append('turn/start', { turn: 1 });
    original.append('user/message', { id: `synthetic-user-${original.seq}`, source: { kind: 'user' }, role: 'user', content: [{ type: 'text', text: 'h'.repeat(400000) }] }, { surfaceOp: 'append' });
    original.append('user/message', { id: `synthetic-user-${original.seq}`, source: { kind: 'user' }, role: 'user', content: [{ type: 'text', text: 'latest' }] }, { surfaceOp: 'append' });
    original.append('request/header', { header: { config: { provider: 'test', model: 'model', maxTokens: 131072, reasoningEffort: 'max' } }, reason: 'initial' });
    const restored = new Session('synthetic-cold-legacy', JSON.parse(JSON.stringify(original.snapshotEvents())), header);
    const agent = { ctx: scope.ctx, session: restored, options: { provider: 'test', model: 'model', maxTokens: 131072 } };
    const engine = f.service.serviceFor(agent, 'compaction');
    assert(engine instanceof BasicCompactionEngine);
    assert.equal(await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal), null);
    assert.equal(adapter.status(engine, restored).thresholdTokens, 235929);
    assert.equal(f.state.requests.length, 0);
    assert.equal(restored.header.agentPreset, 'compaction-policy');
    assert.equal(f.service.composedPreset(scope.ctx), 'compaction-policy');
  } finally { await adapter.dispose(); await scope.dispose(); await drop(); }
});

test('actual legacy plugin owns registration and filter, and disposes both without changing defaults', async () => {
  const f = fixture(); const dropStandard = await f.service.register({ id: 'standard', plugins: [] });
  const register = f.registry.register; let supplied;
  // Exercise the real plugin lifecycle/registry, stubbing unrelated app tools
  // only; the shipped compaction composition is checked in the preceding test.
  f.registry.register = function (definition) { supplied = definition; return register.call(this, { ...definition, plugins: [] }); };
  const fiber = f.ctx.plugin(LegacyPlugin);
  try {
    await fiber;
    assert.equal(supplied.id, 'compaction-policy');
    assert(supplied.plugins.find(row => row.id === 'compaction').config.some(row => row.name === '@deepseek-ai/dsh-compaction-basic'));
    assert.deepEqual((await f.service.list()).map(row => row.id), ['standard']);
    assert.deepEqual(await f.service.resolve('compaction-policy'), { id: 'compaction-policy' });
    assert.equal(f.service.defaultId, 'standard');
  } finally { await fiber.dispose(); delete f.registry.register; }
  assert(!Object.hasOwn(f.registry, 'list'));
  await assert.rejects(f.service.resolve('compaction-policy'), error => error.code === 'agent-preset/not-found');
  await dropStandard();
});

test('legacy plugin rejects duplicate identity without hiding or unregistering its owner', async () => {
  const f = fixture(); const drop = await f.service.register({ id: 'compaction-policy', plugins: [] });
  const fiber = f.ctx.plugin(LegacyPlugin);
  try { await assert.rejects(Promise.resolve(fiber), /already registered/); }
  finally { await fiber.dispose(); }
  assert(!Object.hasOwn(f.registry, 'list'));
  assert.deepEqual(await f.service.resolve('compaction-policy'), { id: 'compaction-policy' });
  await drop();
});

test('package exports and default bundle activate global/legacy, never the old selectable preset', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
  const rows = patch.flatMap(row => row.insert ?? []);
  assert.deepEqual(rows.map(row => row.name), ['dsh-compaction-policy/global', 'dsh-compaction-policy/legacy']);
  for (const entry of ['global', 'legacy']) {
    assert.equal(pkg.exports[`./${entry}`], `./src/${entry}.js`);
    assert.equal(typeof (await import(`dsh-compaction-policy/${entry}`)).default, 'function');
  }
});
