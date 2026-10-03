import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryGuard } from '../src/guard.js';
const policy = { retryAfterTokens: 4096, retryCooldownMs: 60000, maxRetryCooldownMs: 600000 };
const candidate = (hash = 'a', tokens = 10000) => ({ contextKey: 'route-and-policy', fingerprint: hash, entries: [{ seq: 1, tokens, hash }] });

test('exponential cooldown is capped and one expired probe is permitted', () => {
  const guard = new RetryGuard(), session = {}; let now = 0;
  for (const expected of [60000, 120000, 240000, 480000, 600000, 600000]) {
    const result = guard.failed(session, candidate(), policy, now);
    assert.equal(result.retryAt - now, expected);
    assert.equal(guard.check(session, candidate(), policy, result.retryAt - 1).allowed, false);
    assert.equal(guard.check(session, candidate(), policy, result.retryAt).allowed, true);
    now = result.retryAt;
  }
});
test('small candidate additions do not evade cooldown; substantial changes do', () => {
  const guard = new RetryGuard(), session = {};
  guard.failed(session, candidate(), policy, 0);
  const small = { ...candidate(), fingerprint: 'changed', entries: [...candidate().entries, { seq: 2, tokens: 1, hash: 'small' }] };
  assert.equal(guard.check(session, small, policy, 1).allowed, false);
  const big = { ...small, entries: [...candidate().entries, { seq: 2, tokens: 4096, hash: 'big' }] };
  assert.equal(guard.check(session, big, policy, 1).allowed, true);
});
test('removed or repriced large content and changed summary policy can retry', () => {
  const guard = new RetryGuard(), session = {};
  guard.failed(session, candidate(), policy, 0);
  assert.equal(guard.check(session, candidate('smaller', 100), policy, 1).allowed, true);
  assert.equal(guard.check(session, { ...candidate(), contextKey: 'new-summary-policy' }, policy, 1).allowed, true);
});
test('manual reset and separate Session objects are independent', () => {
  const guard = new RetryGuard(), a = {}, b = {};
  guard.failed(a, candidate(), policy, 0);
  assert.equal(guard.check(b, candidate(), policy, 1).allowed, true);
  guard.reset(a);
  assert.equal(guard.check(a, candidate(), policy, 1).allowed, true);
});
