import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { Session } from '@deepseek-ai/dsh-session';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import { BasicCompactionEngine as Basic } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { createPolicyEngine } from '../src/engine.js';
import { installGlobalAdapter as install, RC2_METHOD_HASHES, GLOBAL_DEFAULTS } from '../src/global-adapter.js';
import GlobalPlugin from '../src/global.js';

const original = Basic.prototype.compactIfNeeded;
const originalDescriptor = Object.getOwnPropertyDescriptor(Basic.prototype, 'compactIfNeeded');
const inputs = { BasicCompactionEngine: Basic, toolPairingBalancedBefore, toolPairingBalancedAfter, expectedHashes: RC2_METHOD_HASHES };
const config = { ...GLOBAL_DEFAULTS, retainTokens: 0 };
const events = (s, type) => s.snapshotEvents().filter(e => e.type === type);
function fixture({ Engine = Basic, isPolicy = false, auto = true, words = 120000, ctx = new Context() } = {}) {
  const state = { requests: [], output: '## Current work\nSynthetic native checkpoint.', projections: [], logs: [], hooks: [], flushes: 0 };
  ctx.provide('logger', { info: s => state.logs.push(s), warn: s => state.logs.push(s) });
  ctx.provide('sessionProjections', { register(d) { state.projections.push(d); return () => {}; } });
  ctx.provide('sessions', { async flush() { state.flushes++; } });
  ctx.provide('llm', {
    async resolveModelInfo() { if (state.resolveWait) await state.resolveWait; return { context: { contextWindow: 262144 }, defaultMaxTokens: 131072 }; },
    imageRequestPricing() { return undefined; },
    async *stream(options) {
      state.requests.push(options);
      state.started?.();
      if (state.streamWait) await state.streamWait;
      yield { type: 'text-delta', index: 0, text: state.output };
      yield { type: 'finish', reason: { kind: 'stop' } };
      state.afterStream?.();
    },
  });
  const meter = new TokenMeter(ctx);
  // Observe registrations without modifying the host implementation.
  const on = ctx.on.bind(ctx);
  ctx.on = function(name, ...args) { state.hooks.push(name); return on(name, ...args); };
  const engine = new Engine(ctx, isPolicy ? { basic: { auto, retainTokens: 0 }, retainTokens: 0 } : { auto, retainTokens: 0 });
  const session = new Session('synthetic-runtime-adapter');
  session.append('turn/start', { turn: 1 });
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'Synthetic.' }] } }, { surfaceOp: 'append' });
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'history '.repeat(words) }] }, { surfaceOp: 'append' });
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'latest instruction' }] }, { surfaceOp: 'append' });
  session.append('request/header', { header: { config: { provider: 'synthetic', model: 'model', maxTokens: 131072, reasoningEffort: 'max' } }, reason: 'proof' });
  const agent = { ctx, session, options: { provider: 'synthetic', model: 'model', maxTokens: 131072, reasoningEffort: 'max' }, async runMaintenance(cb) { return cb(new AbortController().signal); } };
  return { ctx, state, engine, service: ctx.compaction, meter, session, agent, signal: new AbortController().signal };
}
function enable(f, policy = config) { return install({ ...inputs, ctx: f.ctx, policy }); }
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

// node:test top-level tests run sequentially by default; global prototype mutation
// is contained to this single subprocess and always restored in finally blocks.
test('existing Basic listener receives native policy; no service/listener/projection duplication', async () => {
  const f = fixture(); const hooks = [...f.state.hooks], projections = [...f.state.projections];
  const before = structuredClone(f.session.requestHeader());
  const installed = enable(f);
  try {
    await f.ctx.waterfall('agent/pre-step', { agent: f.agent, signal: f.signal }, () => 'next');
    assert.equal(f.state.requests.length, 1);
    assert.equal(events(f.session, 'compaction/start').length, 1);
    assert.equal(events(f.session, 'compaction/summary').length, 1);
    assert.equal(events(f.session, 'compaction/end').length, 1);
    const e = events(f.session, 'compaction/summary')[0];
    assert.equal(e.data.llmStreamCall, true);
    assert.equal(e.data.maxTokens, 65536);
    const body = f.session.eventAt(e.seq + 1);
    assert.equal(body.data.source.kind, 'compact-checkpoint');
    assert.equal(body.data.source.compactionId, e.data.compactionId);
    assert.match(body.data.content[0].text, /<compacted-summary>/);
    assert.deepEqual(f.state.hooks, hooks);
    assert.deepEqual(f.state.projections, projections);
    assert.equal(f.ctx.compaction[Symbol.for('cordis.original')], f.engine);
    assert.deepEqual(f.session.requestHeader(), before);
    assert.equal(f.agent.options.maxTokens, 131072);
    assert.equal(f.state.requests[0].maxTokens, 65536);
  } finally { assert.equal(await installed.dispose(), 'restored'); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(Basic.prototype, 'compactIfNeeded'), originalDescriptor);
});

test('future Basic, Cordis realm proxy, and independent runtime isolation', async () => {
  const root = new Context();
  const installed = install({ ...inputs, ctx: root, policy: config });
  try {
    const f = fixture({ ctx: root, words: 50000 });
    const other = fixture({ words: 50000 });
    assert(f.meter.measure(f.session).totalTokens > 65536);
    assert(f.meter.measure(f.session).totalTokens < 235929);
    assert.equal(await f.service.compactIfNeeded(f.agent, 'pressure', f.signal), null);
    assert.equal(f.state.requests.length, 0);
    await other.service.compactIfNeeded(other.agent, 'pressure', other.signal);
    assert.equal(other.state.requests.length, 1);
  } finally { await installed.dispose(); }
});

test('separate roots can own different policies; disabling one leaves the other enabled', async () => {
  const a = fixture({ words: 50000 }), b = fixture({ words: 50000 });
  const ia = enable(a), ib = enable(b, { ...config, thresholdRatio: .3 });
  try {
    assert.equal(await a.engine.compactIfNeeded(a.agent, 'pressure', a.signal), null);
    assert(await b.engine.compactIfNeeded(b.agent, 'pressure', b.signal));
    assert.equal(await ia.dispose(), 'active-other-roots');
    assert.notEqual(Basic.prototype.compactIfNeeded, original);
  } finally { await ia.dispose(); await ib.dispose(); }
  assert.equal(Basic.prototype.compactIfNeeded, original);
});

test('custom subclass and current Policy subclass super bypass adapter without recursion', async () => {
  class Custom extends Basic { async compactIfNeeded(...args) { this.calls = (this.calls ?? 0) + 1; return super.compactIfNeeded(...args); } }
  const a = fixture({ Engine: Custom, words: 50000 }); const ia = enable(a);
  try { assert(await a.engine.compactIfNeeded(a.agent, 'pressure', a.signal)); assert.equal(a.engine.calls, 1); } finally { await ia.dispose(); }
  const Policy = createPolicyEngine(inputs);
  const b = fixture({ Engine: Policy, isPolicy: true, words: 50000 }); const ib = enable(b);
  try {
    assert.equal(await b.engine.compactIfNeeded(b.agent, 'pressure', b.signal), null);
    assert.equal(b.engine.status(b.session).thresholdTokens, 222822);
    assert.equal(b.state.requests.length, 0);
    assert(await b.engine.compactIfNeeded(b.agent, 'context-overflow', b.signal));
  } finally { await ib.dispose(); }
});

test('facade mode=stock and overflow use captured super; original overflow listener authorizes retry', async () => {
  const f = fixture({ words: 50000 }); const installed = enable(f, { ...config, mode: 'stock' });
  try { assert(await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal)); } finally { await installed.dispose(); }
  const g = fixture({ words: 50000 }); const ig = enable(g);
  try {
    assert.equal(await g.engine.compactIfNeeded(g.agent, 'pressure', g.signal), null);
    assert.deepEqual(await g.ctx.waterfall('agent/request-error', { agent: g.agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: g.signal }, () => ({ kind: 'original-error' })), { kind: 'retry' });
    assert.equal(g.state.requests.length, 1);
  } finally { await ig.dispose(); }
});

test('stock auto:false and manual method remain untouched', async () => {
  const f = fixture({ auto: false }); const installed = enable(f);
  try {
    assert(!f.state.hooks.includes('agent/pre-step'));
    await f.ctx.waterfall('agent/pre-step', { agent: f.agent, signal: f.signal }, () => 'next');
    assert.equal(f.state.requests.length, 0);
    f.session.append('turn/end', { turn: 1 });
    assert(await f.service.compactNow(f.agent, f.signal, 'proof-command'));
    assert.equal(f.state.flushes, 1);
    assert.equal(events(f.session, 'compaction/summary')[0].data.sourceCommandId, 'proof-command');
  } finally { await installed.dispose(); }
});

test('duplicate installation, pin mismatch, unknown wrapper fail closed', async () => {
  const f = fixture();
  assert.throws(() => install({ ...inputs, ctx: f.ctx, policy: config, expectedHashes: { ...RC2_METHOD_HASHES, compactIfNeeded: 'wrong' } }), /differs from/);
  const installed = enable(f);
  try { assert.throws(() => enable(f), /already installed/); } finally { await installed.dispose(); }
  function foreign(...args) { return original.apply(this, args); }
  Basic.prototype.compactIfNeeded = foreign;
  try { assert.throws(() => enable(f), /foreign method patch/); assert.equal(Basic.prototype.compactIfNeeded, foreign); } finally { Basic.prototype.compactIfNeeded = original; }
});

test('out-of-order rollback does not clobber a foreign wrapper; inactive tombstone then CAS restore', async () => {
  const f = fixture({ words: 50000 }); const installed = enable(f);
  const wrapped = Basic.prototype.compactIfNeeded;
  let foreignCalls = 0;
  function foreign(...args) { foreignCalls++; return wrapped.apply(this, args); }
  Basic.prototype.compactIfNeeded = foreign;
  assert.equal(await installed.dispose(), 'inactive-foreign-wrapper-retained');
  try {
    assert.equal(Basic.prototype.compactIfNeeded, foreign);
    assert.throws(() => enable(f), /foreign wrapper above/);
    assert(await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal));
    assert.equal(foreignCalls, 1);
    Basic.prototype.compactIfNeeded = wrapped; // Simulate foreign disposer popping itself.
    await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
    assert.equal(Basic.prototype.compactIfNeeded, original);
  } finally { Basic.prototype.compactIfNeeded = original; }
});

test('unload drains admitted summary without abort and serializes same-session stock calls', async () => {
  const f = fixture(); const gate = deferred(), started = deferred();
  f.state.streamWait = gate.promise; f.state.started = started.resolve;
  const installed = enable(f);
  const pending = f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
  await started.promise;
  assert.equal(await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal), null);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', cancelled.signal), { name: 'AbortError' });
  const queuedController = new AbortController();
  const queued = f.engine.compactIfNeeded(f.agent, 'context-overflow', queuedController.signal);
  queuedController.abort();
  await assert.rejects(queued, { name: 'AbortError' }); // Must reject BEFORE releasing the running summary.
  const disposing = installed.dispose(); let disposed = false; disposing.then(() => disposed = true);
  assert.throws(() => enable(f), /already installed.*draining/);
  const stockAfter = f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
  await Promise.resolve(); assert.equal(disposed, false);
  gate.resolve();
  assert(await pending);
  assert.equal(await stockAfter, null);
  assert.equal(await disposing, 'restored');
  assert.equal(f.signal.aborted, false);
  assert.equal(f.state.requests.length, 1);
  assert.equal(events(f.session, 'compaction/summary').length, 1);
});

test('policy retry guard survives calls and does not suppress confirmed overflow', async () => {
  const f = fixture(); f.state.output = 'x'.repeat(1000000); const installed = enable(f);
  try {
    await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal), /not smaller/);
    for (let i = 0; i < 4; ++i) assert.equal(await f.service.compactIfNeeded(f.agent, 'pressure', f.signal), null);
    assert.equal(f.state.requests.length, 1);
    f.state.output = 'Recovered checkpoint';
    assert(await f.engine.compactIfNeeded(f.agent, 'context-overflow', f.signal));
    assert.equal(f.state.requests.length, 2);
  } finally { await installed.dispose(); }
});

test('native final-measurement signal guard: 12 post-stream cancellation boundaries', async () => {
  for (let ticks = 1; ticks <= 12; ticks++) {
    const f = fixture(); const c = new AbortController(); const installed = enable(f);
    let committedAfterAbort = false;
    const append = f.session.append.bind(f.session);
    f.session.append = (type, data, options) => { if (type === 'compaction/summary' && c.signal.aborted) committedAfterAbort = true; return append(type, data, options); };
    f.state.afterStream = () => { let n = ticks; const tick = () => --n === 0 ? c.abort() : queueMicrotask(tick); queueMicrotask(tick); };
    try {
      try { await f.engine.compactIfNeeded(f.agent, 'pressure', c.signal); } catch (e) { assert.equal(e.name, 'AbortError'); }
      assert.equal(committedAfterAbort, false, `ticks=${ticks}`);
      assert.equal(events(f.session, 'compaction/start').length, events(f.session, 'compaction/end').length);
    } finally { await installed.dispose(); }
  }
});

test('pre-aborted pressure and overflow never open native transaction', async () => {
  const f = fixture(); const installed = enable(f); const c = new AbortController(); c.abort();
  try {
    for (const trigger of ['pressure', 'context-overflow']) await assert.rejects(f.engine.compactIfNeeded(f.agent, trigger, c.signal), { name: 'AbortError' });
    assert.equal(events(f.session, 'compaction/start').length, 0);
    assert.equal(f.state.requests.length, 0);
  } finally { await installed.dispose(); }
});

test('90% boundary is policy-only: 234K stays, 236K summarizes with same 128K output config', async () => {
  for (const [words, shouldSummarize] of [[117000, false], [118000, true]]) {
    const f = fixture({ words }); const installed = enable(f);
    try {
      const measured = f.meter.measure(f.session).totalTokens;
      assert.equal(measured >= 235929, shouldSummarize);
      const result = await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
      assert.equal(result !== null, shouldSummarize);
      assert.equal(f.session.requestHeader().config.maxTokens, 131072);
    } finally { await installed.dispose(); }
  }
});

test('isolated preset-like realms under same runtime root are both covered without rebinding', async () => {
  const root = new Context();
  const realm = () => ['compaction', 'tokenMeter', 'sessionProjections', 'sessions', 'llm', 'logger'].reduce((ctx, name) => ctx.isolate(name), root);
  const a = fixture({ ctx: realm(), words: 50000 });
  const installed = install({ ...inputs, ctx: root, policy: config });
  try {
    const b = fixture({ ctx: realm(), words: 50000 });
    assert.notEqual(a.engine, b.engine);
    assert.equal(a.ctx.root, b.ctx.root);
    assert.equal(await a.service.compactIfNeeded(a.agent, 'pressure', a.signal), null);
    assert.equal(await b.service.compactIfNeeded(b.agent, 'pressure', b.signal), null);
    assert.equal(a.state.requests.length + b.state.requests.length, 0);
  } finally { await installed.dispose(); }
});

test('own foreign transaction hook is respected, not silently adapted', async () => {
  const f = fixture({ words: 50000 }); let calls = 0;
  f.engine.compactRegion = async () => { calls++; return 'custom-region'; };
  const installed = enable(f);
  try {
    await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal), /still above threshold/);
    assert(calls > 0); // Stock retries; policy would have returned null below 90%.
  } finally { await installed.dispose(); }
});

test('global default emits native summary without pruning tool middles even with real pruner installed', async () => {
  const f = fixture(); new ToolResultPruner(f.ctx);
  const s = f.session;
  s.append('step/start', { turn: 1, step: 1 });
  const block = { type: 'tool-call', id: 'retained-read', name: 'read', arguments: '{}' };
  s.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [block] },
    stream: [{ type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block } },
      { type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }] }, { surfaceOp: 'append' });
  const text = 'retain this latest tool output '.repeat(2000);
  const result = s.append('tool/result', { turn: 1, step: 1, message: { role: 'tool',
    source: { kind: 'tool', callId: 'retained-read' }, toolCallId: 'retained-read',
    content: [{ type: 'text', text }] } }, { surfaceOp: 'append' });
  s.append('step/end', { turn: 1, step: 1 });
  const installed = enable(f);
  try {
    assert(await f.service.compactIfNeeded(f.agent, 'pressure', f.signal));
    assert.equal(events(s, 'compaction/prune').length, 0);
    assert.equal(events(s, 'compaction/summary').length, 1);
    assert(s.surface.nodes.includes(result.seq));
    assert.equal(s.eventAt(result.seq).data.message.content[0].text, text);
  } finally { await installed.dispose(); }
});

test('invalid global config and non-pressure foreign method patches leave host untouched', () => {
  const f = fixture();
  for (const policy of [{ pruneToolResults: 'false' }, { basic: { maxTokens: 1 } }, { thresholdRatio: 2 }]) {
    assert.throws(() => enable(f, policy));
    assert.equal(Basic.prototype.compactIfNeeded, original);
  }
  const summarize = Basic.prototype.summarize;
  Basic.prototype.summarize = async () => 'foreign';
  try { assert.throws(() => enable(f), /summarize differs/); }
  finally { Basic.prototype.summarize = summarize; }
  assert.equal(Basic.prototype.compactIfNeeded, original);
});

test('a later foreign summary method is respected and status exposes fallback instead of stale policy', async () => {
  const f = fixture({ words: 50000 }); const installed = enable(f);
  const summarize = Basic.prototype.summarize; let foreignCalls = 0;
  try {
    await f.service.compactIfNeeded(f.agent, 'pressure', f.signal);
    assert.equal(installed.status(f.service, f.session).thresholdTokens, 235929);
    Basic.prototype.summarize = function (...args) { foreignCalls++; return summarize.apply(this, args); };
    assert(await f.service.compactIfNeeded(f.agent, 'pressure', f.signal));
    assert.equal(foreignCalls, 1);
    assert.equal(installed.status(f.service, f.session).reason, 'host-method-changed-after-activation');
  } finally { Basic.prototype.summarize = summarize; await installed.dispose(); }
});

test('actual Cordis plugin activation and disposal preserve service identity and clean command', async () => {
  const f = fixture({ words: 50000 }); const commands = [];
  f.ctx.provide('commands', { register(command) { commands.push(command); return () => commands.splice(commands.indexOf(command), 1); } });
  f.ctx.provide('agentPresets', { serviceFor(agent, name) { assert.equal(name, 'compaction'); return f.service; } });
  const fiber = f.ctx.plugin(GlobalPlugin, {});
  try {
    await fiber;
    assert.notEqual(Basic.prototype.compactIfNeeded, original);
    assert.equal(commands.length, 1);
    assert.equal(f.ctx.compaction[Symbol.for('cordis.original')], f.engine);
    await f.service.compactIfNeeded(f.agent, 'pressure', f.signal);
    const response = commands[0].handler({ agent: f.agent, rawInput: 'status' });
    assert.equal(response.kind, 'success');
    const status = JSON.parse(response.text);
    assert.equal(status.reason, 'below-threshold');
    assert.equal(status.thresholdTokens, 235929);
    assert.equal(status.requestedOutputTokens, 131072);
    assert.equal(commands[0].handler({ agent: f.agent, rawInput: 'invalid' }).kind, 'error');
    const reset = commands[0].handler({ agent: f.agent, rawInput: 'reset' });
    assert.equal(reset.kind, 'success');
    assert.equal(JSON.parse(reset.text).reason, 'retry-guard-reset');
  } finally { await fiber.dispose(); }
  assert.equal(commands.length, 0);
  assert.equal(Basic.prototype.compactIfNeeded, original);
});

test('all proof cleanup leaves exactly original prototype descriptor', () => {
  assert.deepEqual(Object.getOwnPropertyDescriptor(Basic.prototype, 'compactIfNeeded'), originalDescriptor);
});
