import { createHash } from 'node:crypto';

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** A retention target, not a minimum. Always keep the latest atomic tool unit.
 * Expanding across a large *older* message is preferable to summarizing only
 * the tiny checkpoint in front of it. Never split or truncate a message.
 */
export function selectRange(session, measurement, { retainTokens, minFreshTokens }, pairing) {
  const surface = session.surface.nodes;
  const nodes = measurement.nodes;
  if (!Array.isArray(nodes) || nodes.length !== surface.length || nodes.some((n, i) => n.seq !== surface[i])) {
    throw new Error('compaction-policy: meter and surface do not describe the same snapshot');
  }
  if (nodes.some((n) => !Number.isFinite(n.tokens) || n.tokens < 0)) throw new Error('invalid surface token price');
  const events = surface.map((seq) => session.eventAt(seq));
  let first = 0;
  while (events[first]?.type === 'system/message') first++;
  if (first >= nodes.length - 1) return { reason: 'no-older-history' };
  if (!pairing.before(session, surface[first])) return { reason: 'unbalanced-prefix' };
  // An unexpected later system node is a barrier, not ordinary history to erase.
  let endLimit = nodes.length - 2;
  const systemBarrier = events.findIndex((event, index) => index > first && event.type === 'system/message');
  if (systemBarrier >= 0) endLimit = Math.min(endLimit, systemBarrier - 1);
  const suffix = new Array(nodes.length + 1).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + nodes[i].tokens;
  let freshTokens = 0;
  let regionTokens = 0;
  let lastUseful;
  let balanced = false;
  for (let i = first; i <= endLimit; i++) {
    regionTokens += nodes[i].tokens;
    const checkpoint = events[i].type === 'user/message' && events[i].data.source?.kind === 'compact-checkpoint';
    if (!checkpoint) freshTokens += nodes[i].tokens;
    if (!pairing.after(session, surface[i])) continue;
    balanced = true;
    if (freshTokens < minFreshTokens) continue;
    const candidate = {
      start: surface[first], end: surface[i], startIndex: first, endIndex: i,
      freshTokens, regionTokens, retainedTokens: suffix[i + 1],
    };
    // Earliest useful cut that meets the target: keeps as much raw history as possible.
    if (suffix[i + 1] <= retainTokens) return { range: candidate };
    lastUseful = candidate;
  }
  // The newest indivisible unit can exceed the entire retention target.
  if (lastUseful) return { range: lastUseful };
  return { reason: balanced ? 'insufficient-fresh-history' : 'no-balanced-range' };
}

/** Hash the actual selected replay messages, not the growing session log revision. */
export function describeCandidate(session, measurement, range, header, policy, basicConfig) {
  const firstEvent = session.eventAt(session.surface.nodes[0]);
  const system = firstEvent?.type === 'system/message' ? session.deriveEventMessage(firstEvent) : null;
  const contextKey = digest({ header, system, policy, basicConfig });
  const entries = measurement.nodes.slice(range.startIndex, range.endIndex + 1).map((node) => {
    const event = session.eventAt(node.seq);
    return {
      seq: node.seq,
      tokens: node.tokens,
      hash: digest({ message: session.deriveEventMessage(event), tokens: node.tokens }),
    };
  });
  return { contextKey, fingerprint: digest({ contextKey, entries }), entries };
}

/** Read the host's log-recorded lock without creating our own durable protocol. */
export function hasActiveCompaction(session) {
  let newerSeed = false;
  for (let seq = session.seq - 1; seq >= 0; seq--) {
    const event = session.eventAt(seq);
    if (event.type === 'session/end-seed') newerSeed = true;
    if (event.type === 'compaction/end') return false;
    if (event.type === 'compaction/start') return !newerSeed;
  }
  return false;
}
