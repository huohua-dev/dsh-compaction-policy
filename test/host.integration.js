// Uses the installed DSH libraries, in-memory sessions and a scripted LLM.
// No host boot, server, credentials, actual session logs, or network requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { Session } from '@deepseek-ai/dsh-session';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import Engine from '../src/index.js';
import Preset from '../src/preset.js';
import { selectRange } from '../src/selection.js';

function context(config = {}) {
  const ctx = new Context();
  const state = { requests: [], flushes: 0, output: '## Current work\nSynthetic checkpoint. Continue the task.', finish: { kind: 'stop' }, logs: [], projections: [] };
  ctx.provide('logger', { info: (s) => state.logs.push(s), warn: (s) => state.logs.push(s) });
  ctx.provide('sessionProjections', { register(def) { state.projections.push(def); return () => {}; } });
  ctx.provide('sessions', { async flush() { state.flushes++; } });
  ctx.provide('llm', {
    async resolveModelInfo() { return { context: { contextWindow: 262144 }, defaultMaxTokens: 131072 }; },
    imageRequestPricing() { return undefined; },
    async *stream(options) {
      state.requests.push(options);
      yield { type: 'text-delta', index: 0, text: state.output };
      yield { type: 'finish', reason: state.finish };
      if (state.afterStream) state.afterStream();
    },
  });
  const meter = new TokenMeter(ctx);
  const validation = Engine.Config['~standard'].validate(config);
  assert(!validation.issues, JSON.stringify(validation.issues));
  new Engine(ctx, validation.value);
  const engine = ctx.compaction; // The real realm proxy, not the constructor's return value.
  const session = new Session('synthetic-policy-test');
  session.append('turn/start', { turn: 1 });
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'Synthetic host test system.' }] } }, { surfaceOp: 'append' });
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'history '.repeat(120000) }] }, { surfaceOp: 'append' });
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'latest user instruction' }] }, { surfaceOp: 'append' });
  session.append('request/header', { header: { config: { provider: 'test-local', model: 'test-model', reasoningEffort: 'max', maxTokens: 131072 } }, reason: 'synthetic test' });
  const agent = { session, options: { provider: 'test-local', model: 'test-model', reasoningEffort: 'max', maxTokens: 131072 },
    async runMaintenance(callback) { return callback(new AbortController().signal); } };
  return { ctx, state, meter, engine, session, agent, signal: new AbortController().signal };
}
const events = (session, type) => session.snapshotEvents().filter((e) => e.type === type);

test('host schema, realm proxy and inherited stock services load on rc.2', () => {
  const f = context();
  assert(f.engine instanceof BasicCompactionEngine);
  assert.equal(f.engine.policyConfig.defaults.thresholdRatio, .85);
  assert.equal(f.engine.config.maxTokens, 65536);
  assert.equal(f.engine.config.headroomTokens, 65536); // New pressure headroom did not leak into Basic.
  assert.equal(f.state.projections.length, 3);
  assert.throws(() => new Engine(new Context(), { unknownSetting: true }), /unknown key/);
});

test('real Session + TokenMeter + Basic summary transaction preserve budgets and provenance', async () => {
  const f = context();
  const headerBefore = structuredClone(f.session.requestHeader());
  const before = f.meter.measure(f.session).totalTokens;
  assert(before > 222822);
  const result = await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
  assert(result);
  assert.equal(f.state.requests.length, 1);
  const request = f.state.requests[0];
  assert.equal(request.maxTokens, 65536);
  assert.equal(request.purpose, 'compaction');
  assert.equal(request.reasoningEffort, undefined);
  assert.deepEqual(f.session.requestHeader(), headerBefore);
  assert.equal(f.agent.options.maxTokens, 131072);
  assert(f.meter.measure(f.session).totalTokens < before);
  const summary = events(f.session, 'compaction/summary')[0];
  const replacement = f.session.eventAt(summary.seq + 1);
  assert.equal(replacement.type, 'user/message');
  assert.equal(replacement.data.source.kind, 'compact-checkpoint');
  assert.equal(replacement.data.source.compactionId, summary.data.compactionId);
  assert(replacement.sourceEventSeqs.includes(result.startSeq));
  assert.deepEqual(summary.data.shadowedSeqs, result.shadowedSeqs);
  assert.equal(events(f.session, 'compaction/start').length, 1);
  assert.equal(events(f.session, 'compaction/end').length, 1);
  assert.equal(f.session.eventAt(f.session.surface.nodes[0]).type, 'system/message');
  assert(toolPairingBalancedBefore(f.session, replacement.seq));
  assert(toolPairingBalancedAfter(f.session, replacement.seq));
});

test('real summary-shrink failure closes the bracket and suppresses repeated calls', async () => {
  const f = context(); f.state.output = 'b'.repeat(1000000);
  const before = [...f.session.surface.nodes];
  await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal), /not smaller/);
  for (let i = 0; i < 10; i++) {
    f.session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'tiny tail' }] }, { surfaceOp: 'append' });
    await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
  }
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.session.surface.nodes.slice(0, before.length), before);
  assert.equal(events(f.session, 'compaction/summary').length, 0);
  assert.equal(events(f.session, 'compaction/start').length, events(f.session, 'compaction/end').length);
});

test('real max-token termination is not accepted as a checkpoint', async () => {
  const f = context(); f.state.finish = { kind: 'max-tokens' };
  await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal), /truncated/);
  assert.equal(events(f.session, 'compaction/summary').length, 0);
  assert.equal(f.engine.status(f.session).reason, 'summary-failed');
});

test('real ABORTED finish is cancellation, not a poisoned retry guard', async () => {
  const f = context(); f.state.finish = { kind: 'aborted', failure: { code: 'ABORTED', message: 'synthetic cancellation' } };
  await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal));
  assert.equal(f.engine.status(f.session).reason, 'cancelled');
  f.state.finish = { kind: 'stop' };
  assert(await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal));
  assert.equal(f.state.requests.length, 2);
});

test('abort at multiple microtask boundaries after stream completion never commits after cancellation', async () => {
  for (let ticks = 1; ticks <= 12; ticks++) {
    const f = context(); const controller = new AbortController(); let committedAfterAbort = false;
    const append = f.session.append.bind(f.session);
    f.session.append = (type, data, options) => {
      if (type === 'compaction/summary' && controller.signal.aborted) committedAfterAbort = true;
      return append(type, data, options);
    };
    f.state.afterStream = () => {
      let remaining = ticks;
      const tick = () => { if (--remaining === 0) controller.abort(); else queueMicrotask(tick); };
      queueMicrotask(tick);
    };
    try { await f.engine.compactIfNeeded(f.agent, 'pressure', controller.signal); }
    catch (error) { assert.equal(error.name, 'AbortError'); }
    assert.equal(committedAfterAbort, false, `abort at microtask ${ticks}`);
    assert.equal(events(f.session, 'compaction/start').length, events(f.session, 'compaction/end').length);
  }
});

test('real manual /compact transaction is idle maintenance, flushes, and keeps command correlation', async () => {
  const f = context();
  f.session.append('turn/end', { turn: 1 });
  const result = await f.engine.compactNow(f.agent, f.signal, 'synthetic-command');
  assert(result); assert.equal(f.state.flushes, 1);
  assert.equal(events(f.session, 'compaction/start')[0].data.turn, null);
  assert.equal(events(f.session, 'compaction/summary')[0].data.sourceCommandId, 'synthetic-command');
  assert.equal(f.session.eventAt(result.summarySeq + 1).data.source.sourceCommandId, 'synthetic-command');
});

test('real overflow listener authorizes retry only after durable surface progress, even after pressure cooldown', async () => {
  const f = context(); f.state.output = 'x'.repeat(1000000);
  await assert.rejects(f.engine.compactIfNeeded(f.agent, 'pressure', f.signal));
  f.state.output = 'Small recovery checkpoint';
  const outcome = await f.ctx.waterfall('agent/request-error', { agent: f.agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: f.signal }, () => ({ kind: 'original-error' }));
  assert.deepEqual(outcome, { kind: 'retry' });
  assert(f.session.surface.replaceGeneration > 0);
  assert.equal(f.state.requests.length, 2);
  const second = await f.ctx.waterfall('agent/request-error', { agent: f.agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: f.signal }, () => ({ kind: 'original-error' }));
  assert.deepEqual(second, { kind: 'original-error' }); // maxOverflowRetries stayed authoritative.
});

test('real overflow failure without a replacement never requests a retry', async () => {
  const f = context(); f.state.output = 'x'.repeat(1000000);
  const outcome = await f.ctx.waterfall('agent/request-error', { agent: f.agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: f.signal }, () => ({ kind: 'original-error' }));
  assert.deepEqual(outcome, { kind: 'original-error' });
  assert.equal(f.session.surface.replaceGeneration, 0);
});

test('real parallel tool unit is indivisible; a latest assistant in an open step stays verbatim', async () => {
  const f = context(); const s = new Session('synthetic-tool-pairing'); f.agent.session = s;
  s.append('turn/start', { turn: 1 });
  s.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'system' }] } }, { surfaceOp: 'append' });
  s.append('request/header', { header: f.session.requestHeader(), reason: 'synthetic' });
  s.append('step/start', { turn: 1, step: 1 });
  s.append('user/message', { role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'synthetic-previous' }, content: [{ type: 'text', text: 'tiny old checkpoint' }] }, { surfaceOp: 'append' });
  const content = [{ type: 'reasoning', text: 'reasoning '.repeat(96000) },
    { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{"file_path":"a"}' },
    { type: 'tool-call', id: 'call-b', name: 'read', arguments: '{"file_path":"b"}' }];
  const stream = content.map((block, index) => ({ type: 'chunk', time: index, chunk: { type: 'block-end', index, block } }));
  stream.push({ type: 'chunk', time: 3, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } });
  const assistant = s.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content }, stream }, { surfaceOp: 'append' });
  const results = [];
  for (const id of ['call-b', 'call-a']) results.push(s.append('tool/result', { turn: 1, step: 1,
    message: { role: 'tool', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: 'result' }] } }, { surfaceOp: 'append' }));
  s.append('step/end', { turn: 1, step: 1 });
  s.append('step/start', { turn: 1, step: 2 });
  const latest = s.append('assistant/message', { turn: 1, step: 2,
    message: { role: 'assistant', content: [{ type: 'text', text: 'current unfinished step' }] },
    stream: [{ type: 'chunk', time: 4, chunk: { type: 'text-delta', index: 0, text: 'current unfinished step' } }] }, { surfaceOp: 'append' });
  const selection = selectRange(s, f.meter.measure(s), { retainTokens: 20000, minFreshTokens: 2048 },
    { before: toolPairingBalancedBefore, after: toolPairingBalancedAfter }).range;
  assert(selection);
  const selected = s.surface.nodes.slice(selection.startIndex, selection.endIndex + 1);
  assert(selected.includes(assistant.seq));
  assert(results.every((result) => selected.includes(result.seq)));
  assert(!selected.includes(latest.seq));
  const result = await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal);
  assert(result); assert(s.surface.nodes.includes(latest.seq));
  assert.equal(s.eventAt(latest.seq).data.message.content[0].text, 'current unfinished step');
});

test('real cancelled overflow never retries or advances the surface', async () => {
  const f = context(); const controller = new AbortController(); controller.abort();
  const outcome = await f.ctx.waterfall('agent/request-error', { agent: f.agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: controller.signal }, () => ({ kind: 'original-error' }));
  assert.deepEqual(outcome, { kind: 'original-error' }); assert.equal(f.state.requests.length, 0);
  assert.equal(f.session.surface.replaceGeneration, 0);
});

test('shipped standard resolves through public exports; separate preset registers and disposes without defaults', async () => {
  const ctx = new Context(); const registered = [];
  ctx.provide('agentPresets', { async register(def) { registered.push(def); return () => { registered.splice(registered.indexOf(def), 1); }; } });
  const plugin = new Preset(ctx, { policy: { mode: 'stock', modelPolicies: [{ provider: 'test-local', model: 'test-model', mode: 'policy' }] } });
  const iterator = plugin[Service.init]();
  const { value: dispose } = await iterator.next();
  assert.equal(registered.length, 1);
  const definition = registered[0];
  assert.equal(definition.id, 'compaction-policy');
  assert.equal(definition.plugins.length, 19);
  const group = definition.plugins.find((p) => p.id === 'compaction');
  assert.equal(group.config.find((p) => p.id === 'compaction-policy-engine').name, 'dsh-compaction-policy');
  assert(group.config.some((p) => p.name === '@deepseek-ai/dsh-command-compact'));
  assert(group.config.some((p) => p.name === '@deepseek-ai/dsh-compaction-tool-result-pruner'));
  assert(!('default' in definition));
  await dispose(); await iterator.return(); assert.equal(registered.length, 0);
});
