// One bounded failure record per live Session. No text or credentials are stored.
export class RetryGuard {
  failures = new WeakMap();

  materiallyChanged(previous, candidate, minimum) {
    if (previous.contextKey !== candidate.contextKey) return true;
    if (previous.fingerprint === candidate.fingerprint) return false;
    const before = new Map(previous.entries.map((entry) => [entry.seq, entry]));
    let added = 0;
    let removed = 0;
    for (const entry of candidate.entries) {
      const old = before.get(entry.seq);
      if (!old || old.hash !== entry.hash) {
        added += entry.tokens;
        removed += old?.tokens ?? 0;
      }
      before.delete(entry.seq);
    }
    for (const entry of before.values()) removed += entry.tokens;
    return Math.max(added, removed) >= minimum;
  }

  check(session, candidate, policy, now) {
    const previous = this.failures.get(session);
    if (!previous || this.materiallyChanged(previous, candidate, policy.retryAfterTokens)) return { allowed: true };
    return now >= previous.retryAt
      ? { allowed: true, probe: true }
      : { allowed: false, retryAt: previous.retryAt, failures: previous.count };
  }

  failed(session, candidate, policy, now) {
    const previous = this.failures.get(session);
    const count = !previous || this.materiallyChanged(previous, candidate, policy.retryAfterTokens)
      ? 1 : Math.min(previous.count + 1, 32);
    const cooldownMs = Math.min(policy.maxRetryCooldownMs, policy.retryCooldownMs * 2 ** Math.min(count - 1, 20));
    const state = { ...candidate, count, retryAt: now + cooldownMs };
    this.failures.set(session, state);
    return { count, retryAt: state.retryAt };
  }

  reset(session) { this.failures.delete(session); }
}
