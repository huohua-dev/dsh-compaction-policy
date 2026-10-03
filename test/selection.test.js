import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRange, describeCandidate, hasActiveCompaction } from '../src/selection.js';
import { FakeSession, pairing } from './helpers.js';
const pick = (s, options = {}) => selectRange(s, s.measure(), { retainTokens: 20971, minFreshTokens: 2048, ...options }, pairing);

test('regression: tiny old checkpoint does not shield huge early reasoning in one turn', () => {
  const s = new FakeSession();
  const system = s.add('system/message', 1000);
  const long = s.add('assistant/message', 23700, [{ type: 'reasoning', text: 'long reasoning' }, { type: 'tool-call', id: 'x' }]);
  const result = s.add('tool/result', 100);
  s.add('user/message', 10000);
  const checkpoint = s.checkpoint();
  s.surface.nodes = [system, checkpoint, long, result, 3]; // Surface seq order is not numeric order.
  const selected = pick(s).range;
  assert.equal(selected.start, checkpoint);
  assert.equal(selected.end, result);
  assert.equal(selected.freshTokens, 23800);
  assert.equal(selected.retainedTokens, 10000);
});
test('only old checkpoints are a visible skip', () => {
  const s = new FakeSession(); s.checkpoint(30000); s.add('user/message', 1);
  assert.equal(pick(s).reason, 'insufficient-fresh-history');
});
test('keep the latest indivisible tool unit even above the retention target', () => {
  const s = new FakeSession(); const old = s.add('user/message', 30000);
  s.add('assistant/message', 100000, [{ type: 'tool-call', id: 'a' }, { type: 'tool-call', id: 'b' }]);
  s.add('tool/result', 1000); s.add('tool/result', 2000);
  assert.equal(pick(s).range.end, old);
  assert.equal(pick(s).range.retainedTokens, 103000);
});
test('pending tool calls stay on the retained side', () => {
  const s = new FakeSession(); const old = s.add('user/message', 30000);
  s.add('assistant/message', 1000, [{ type: 'tool-call', id: 'a' }, { type: 'tool-call', id: 'b' }]);
  s.add('tool/result', 1000);
  assert.equal(pick(s).range.end, old);
});
test('system nodes are excluded, including unexpected in-history barriers', () => {
  const s = new FakeSession(); s.add('system/message', 1000); const old = s.add('user/message', 30000);
  s.add('system/message', 100); s.add('user/message', 200000); s.add('user/message', 100);
  assert.equal(pick(s).range.start, old); assert.equal(pick(s).range.end, old);
});
test('latest node survives even with zero retention', () => {
  const s = new FakeSession(); const old = s.add('user/message', 3000); const last = s.add('user/message', 1);
  assert.equal(pick(s, { retainTokens: 0 }).range.end, old);
  assert.notEqual(pick(s, { retainTokens: 0 }).range.end, last);
});
test('empty and single-node surfaces do not create transactions', () => {
  const s = new FakeSession(); assert.equal(pick(s).reason, 'no-older-history');
  s.add('user/message', 100000); assert.equal(pick(s).reason, 'no-older-history');
});
test('stale meter snapshot and corrupt prices fail closed', () => {
  const s = new FakeSession(); s.add('user/message', 4000); s.add('user/message', 1);
  const m = s.measure(); m.nodes.reverse();
  assert.throws(() => selectRange(s, m, { retainTokens: 0, minFreshTokens: 1 }, pairing), /same snapshot/);
  s.prices.set(0, NaN); assert.throws(() => pick(s), /token price/);
});
test('fingerprint ignores appended tail but detects projected content and header changes', () => {
  const s = new FakeSession(); s.add('system/message', 100); s.add('user/message', 30000); s.add('user/message', 100);
  const describe = () => describeCandidate(s, s.measure(), pick(s).range, s.header, {}, {});
  const first = describe(); s.add('user/message', 1);
  assert.equal(first.fingerprint, describe().fingerprint);
  s.events[1].data.content[0].text = 'projection changed without a new seq';
  assert.notEqual(first.fingerprint, describe().fingerprint);
  const second = describe(); s.header.config.model = 'other';
  assert.notEqual(second.contextKey, describe().contextKey);
});
test('durable lock respects closed transactions and new lifecycle seeds', () => {
  const s = new FakeSession(); assert.equal(hasActiveCompaction(s), false);
  s.log('compaction/start'); assert.equal(hasActiveCompaction(s), true);
  s.log('compaction/end'); assert.equal(hasActiveCompaction(s), false);
  s.log('compaction/start'); s.log('session/end-seed'); assert.equal(hasActiveCompaction(s), false);
  s.log('compaction/start'); assert.equal(hasActiveCompaction(s), true);
});
test('generated valid tool traces never split parallel tool calls/results', () => {
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let iteration = 0; iteration < 150; iteration++) {
    const s = new FakeSession(); s.add('system/message', 1000);
    const groups = [];
    for (let group = 0; group < 12; group++) {
      const count = random() % 4 + 1;
      const calls = Array.from({ length: count }, (_, k) => ({ type: 'tool-call', id: `${group}-${k}` }));
      const start = s.add('assistant/message', random() % 50000, calls);
      const results = [...calls].reverse().map((call) => s.add('tool/result', random() % 1000, [{ type: 'text', text: call.id }]));
      groups.push({ start, results });
    }
    s.add('user/message', random() % 4000);
    const selected = pick(s, { retainTokens: random() % 70000, minFreshTokens: 1 }).range;
    if (!selected) continue;
    const selectedSeqs = new Set(s.surface.nodes.slice(selected.startIndex, selected.endIndex + 1));
    assert(!selectedSeqs.has(0)); assert(!selectedSeqs.has(s.surface.nodes.at(-1)));
    for (const group of groups) for (const seq of group.results) assert.equal(selectedSeqs.has(group.start), selectedSeqs.has(seq));
  }
});
