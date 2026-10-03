// Independent policy arithmetic. No host state or request is mutated here.
const POLICY_KEYS = [
  'mode', 'thresholdRatio', 'outputReserveCap', 'headroomTokens', 'retainRatio',
  'retainTokens', 'minFreshTokens', 'retryAfterTokens', 'retryCooldownMs', 'maxRetryCooldownMs', 'pruneToolResults',
];
const TOP_KEYS = new Set([...POLICY_KEYS, 'modelPolicies', 'basic', 'dryRun']);
const ROUTE_KEYS = new Set([...POLICY_KEYS, 'provider', 'model']);
export const DEFAULTS = Object.freeze({
  mode: 'policy',
  pruneToolResults: true,
  thresholdRatio: 0.85,
  outputReserveCap: 20000,
  headroomTokens: 13000,
  retainRatio: 0.16,
  minFreshTokens: 2048,
  retryAfterTokens: 4096,
  retryCooldownMs: 60000,
  maxRetryCooldownMs: 600000,
});

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
}
function keys(value, allowed, label) {
  record(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}: unknown key ${key}`);
  }
}
function integer(value, key, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new TypeError(`${key} must be a safe integer >= ${min}`);
}
function validate(policy, label) {
  if (policy.pruneToolResults !== undefined && typeof policy.pruneToolResults !== 'boolean') {
    throw new TypeError(`${label}.pruneToolResults must be boolean`);
  }
  if (policy.mode !== undefined && !['policy', 'stock'].includes(policy.mode)) {
    throw new TypeError(`${label}.mode must be policy or stock`);
  }
  for (const key of ['thresholdRatio', 'retainRatio']) {
    if (policy[key] !== undefined && (!Number.isFinite(policy[key]) || policy[key] <= 0 || policy[key] >= 1)) {
      throw new TypeError(`${label}.${key} must be between 0 and 1 (exclusive)`);
    }
  }
  for (const key of ['outputReserveCap', 'headroomTokens', 'retainTokens']) {
    if (policy[key] !== undefined) integer(policy[key], `${label}.${key}`);
  }
  for (const key of ['minFreshTokens', 'retryAfterTokens', 'retryCooldownMs', 'maxRetryCooldownMs']) {
    if (policy[key] !== undefined) integer(policy[key], `${label}.${key}`, 1);
  }
  if (policy.retainTokens !== undefined && policy.retainRatio !== undefined) {
    throw new TypeError(`${label}: retainTokens and retainRatio are mutually exclusive`);
  }
}
function mergePolicy(base, override) {
  const merged = { ...base, ...override };
  if (override.retainTokens !== undefined) delete merged.retainRatio;
  if (override.retainRatio !== undefined) delete merged.retainTokens;
  if (merged.retainRatio !== undefined && merged.retainRatio >= merged.thresholdRatio) {
    throw new TypeError('retainRatio must be below thresholdRatio');
  }
  if (merged.maxRetryCooldownMs < merged.retryCooldownMs) {
    throw new TypeError('maxRetryCooldownMs must be >= retryCooldownMs');
  }
  return Object.freeze(merged);
}
export function routeKey(target) {
  return JSON.stringify([target.provider, target.model]);
}
export function resolveConfig(source = {}) {
  keys(source, TOP_KEYS, 'config');
  validate(source, 'config');
  if (source.dryRun !== undefined && typeof source.dryRun !== 'boolean') throw new TypeError('dryRun must be boolean');
  const ownPolicy = Object.fromEntries(POLICY_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  const defaults = mergePolicy(DEFAULTS, ownPolicy);
  const policies = source.modelPolicies ?? [];
  if (!Array.isArray(policies)) throw new TypeError('modelPolicies must be an array');
  const seen = new Set();
  const modelPolicies = policies.map((row, index) => {
    keys(row, ROUTE_KEYS, `modelPolicies[${index}]`);
    validate(row, `modelPolicies[${index}]`);
    for (const key of ['provider', 'model']) {
      if (typeof row[key] !== 'string' || !row[key].trim()) throw new TypeError(`${key} must be nonempty`);
    }
    const key = routeKey(row);
    if (seen.has(key)) throw new TypeError(`duplicate model policy ${key}`);
    seen.add(key);
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
    return mergePolicy(defaults, defined);
  });
  const basic = source.basic ?? {};
  record(basic, 'basic');
  // The stock engine owns validation/defaults for this separate namespace.
  // Never pass pressure headroom into it: Basic defaults summary maxTokens to its headroom.
  return Object.freeze({ defaults, modelPolicies: Object.freeze(modelPolicies), basic: structuredClone(basic), dryRun: source.dryRun ?? false });
}
export function resolvePolicy(config, target) {
  return config.modelPolicies.find((p) => p.provider === target.provider && p.model === target.model) ?? config.defaults;
}
export function resolveBudget(policy, contextWindow, requestedOutputTokens) {
  integer(contextWindow, 'contextWindow', 1);
  integer(requestedOutputTokens, 'requestedOutputTokens');
  const reservedOutputTokens = Math.min(requestedOutputTokens, policy.outputReserveCap);
  const messageBudgetTokens = contextWindow - reservedOutputTokens;
  const thresholdTokens = Math.floor(Math.min(
    contextWindow * policy.thresholdRatio,
    messageBudgetTokens - policy.headroomTokens,
  ));
  const retainTokens = policy.retainTokens ?? Math.floor(messageBudgetTokens * policy.retainRatio);
  if (thresholdTokens <= 0 || retainTokens >= thresholdTokens) {
    throw new RangeError('policy leaves no valid pressure budget; configure smaller reserve/headroom/retention for this model');
  }
  return Object.freeze({ contextWindow, requestedOutputTokens, reservedOutputTokens, thresholdTokens, retainTokens });
}
export function routedTarget(session) {
  const config = session.requestHeader()?.config;
  return typeof config?.provider === 'string' && config.provider.length > 0
    && typeof config.model === 'string' && config.model.length > 0
    ? { provider: config.provider, model: config.model } : undefined;
}
