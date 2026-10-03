import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, resolvePolicy, resolveBudget, routeKey } from '../src/policy.js';

const target = { provider: 'local', model: 'model' };
test('256K/128K: policy threshold is 85%, output and summary budgets stay independent', () => {
  const input = { basic: { maxTokens: 65536 } };
  const before = structuredClone(input);
  const config = resolveConfig(input);
  const budget = resolveBudget(resolvePolicy(config, target), 262144, 131072);
  assert.deepEqual(budget, { contextWindow: 262144, requestedOutputTokens: 131072,
    reservedOutputTokens: 20000, thresholdTokens: 222822, retainTokens: 38743 });
  assert.equal(config.basic.maxTokens, 65536);
  assert.deepEqual(input, before);
});
test('ratio-only 90% pressure leaves the ratio tail reserve without double-subtracting the output cap', () => {
  const config = resolveConfig({ thresholdRatio: .9, outputReserveCap: 0, headroomTokens: 0, pruneToolResults: false });
  for (const window of [32768, 131072, 262144, 1000000]) {
    const budget = resolveBudget(config.defaults, window, 131072);
    assert.equal(budget.thresholdTokens, Math.floor(window * .9));
    assert.equal(budget.requestedOutputTokens, 131072);
  }
  assert.equal(config.defaults.pruneToolResults, false);
  assert.equal(resolveConfig().defaults.pruneToolResults, true);
});
test('stock arithmetic is expressible without changing requests', () => {
  const p = resolveConfig({ outputReserveCap: 131072, headroomTokens: 65536, thresholdRatio: .8 }).defaults;
  assert.equal(resolveBudget(p, 262144, 131072).thresholdTokens, 65536);
  assert.equal(resolveBudget(p, 262144, 131072).retainTokens, 20971);
});
test('reservation never exceeds requested output and supports zero', () => {
  const p = resolveConfig().defaults;
  assert.equal(resolveBudget(p, 262144, 8192).reservedOutputTokens, 8192);
  assert.equal(resolveBudget(p, 262144, 0).reservedOutputTokens, 0);
});
test('zero headroom is independent of Basic summary maxTokens', () => {
  const c = resolveConfig({ headroomTokens: 0 });
  assert.deepEqual(c.basic, {});
  assert.equal(resolveBudget(c.defaults, 262144, 131072).thresholdTokens, 222822);
});
test('exact routes, retained-token override, and stock fallback', () => {
  const c = resolveConfig({ mode: 'stock', modelPolicies: [{ ...target, mode: 'policy', retainTokens: 4000 }] });
  assert.equal(resolvePolicy(c, target).mode, 'policy');
  assert.equal(resolvePolicy(c, { ...target, provider: 'LOCAL' }).mode, 'stock');
  assert.equal(resolvePolicy(c, { ...target, model: 'Model' }).mode, 'stock');
  assert.equal(resolvePolicy(c, target).retainRatio, undefined);
  assert.equal(resolveBudget(resolvePolicy(c, target), 262144, 131072).retainTokens, 4000);
  assert.notEqual(routeKey({ provider: 'a/b', model: 'c' }), routeKey({ provider: 'a', model: 'b/c' }));
});
for (const [name, source] of Object.entries({
  typo: { outputReservationCap: 1 },
  nan: { thresholdRatio: NaN },
  ratioOne: { thresholdRatio: 1 },
  negative: { outputReserveCap: -1 },
  fractions: { minFreshTokens: 1.1 },
  unsafeInteger: { retryCooldownMs: Number.MAX_SAFE_INTEGER + 1 },
  bothRetention: { retainRatio: .1, retainTokens: 10 },
  retentionConflict: { retainRatio: .9 },
  duplicate: { modelPolicies: [target, target] },
  policyTypo: { modelPolicies: [{ ...target, enabled: false }] },
  cooldown: { retryCooldownMs: 1000, maxRetryCooldownMs: 999 },
  emptyRoute: { modelPolicies: [{ provider: '', model: 'm' }] },
  dryRun: { dryRun: 'yes' },
  pruneToolResults: { pruneToolResults: 'false' },
  routePruneToolResults: { modelPolicies: [{ ...target, pruneToolResults: 0 }] },
  basic: { basic: [] },
})) test(`invalid configuration: ${name}`, () => assert.throws(() => resolveConfig(source)));

test('invalid or exhausted capacity is rejected, never invented', () => {
  const p = resolveConfig().defaults;
  for (const window of [undefined, 0, -1, NaN, 100]) assert.throws(() => resolveBudget(p, window, 131072));
  for (const output of [-1, NaN, 1.5]) assert.throws(() => resolveBudget(p, 262144, output));
});
