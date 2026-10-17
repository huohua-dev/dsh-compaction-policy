import z from '@deepseek-ai/schemastery';

// Shared by the root backend and the global plugin. Kept separate from
// index.js so loading the global entry never evaluates the root backend's
// host gate or constructs its engine class.
export const policyFields = () => ({
  mode: z.union(['policy', 'stock']),
  pruneToolResults: z.boolean(),
  thresholdRatio: z.number(),
  outputReserveCap: z.number().step(1).min(0),
  headroomTokens: z.number().step(1).min(0),
  retainRatio: z.number(),
  retainTokens: z.number().step(1).min(0),
  minFreshTokens: z.number().step(1).min(1),
  retryAfterTokens: z.number().step(1).min(1),
  retryCooldownMs: z.number().step(1).min(1),
  maxRetryCooldownMs: z.number().step(1).min(1),
});
