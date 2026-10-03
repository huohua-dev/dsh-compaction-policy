import assert from 'node:assert/strict';
import { createPolicyEngine } from '../src/engine.js';

export class FakeSession {
  events = [];
  surface = { nodes: [], replaceGeneration: 0 };
  prices = new Map();
  header = { config: { provider: 'local', model: 'model', maxTokens: 131072, reasoningEffort: 'max' }, tools: [] };
  id = 'synthetic-test';
  get seq() { return this.events.length; }
  eventAt(seq) { return this.events[seq]; }
  requestHeader() { return this.header; }
  deriveEventMessage(event) { return event.type === 'user/message' ? event.data : event.data.message ?? null; }
  log(type, data = {}) { const event = { seq: this.seq, type, data }; this.events.push(event); return event; }
  add(type, tokens, content = [{ type: 'text', text: `synthetic ${this.seq}` }], source) {
    const data = type === 'user/message'
      ? { role: 'user', content, ...(source ? { source } : {}) }
      : { message: { role: type === 'tool/result' ? 'tool' : type === 'system/message' ? 'system' : 'assistant', content } };
    const event = this.log(type, data);
    this.surface.nodes.push(event.seq);
    this.prices.set(event.seq, tokens);
    return event.seq;
  }
  checkpoint(tokens = 141) { return this.add('user/message', tokens, [{ type: 'text', text: 'old checkpoint' }], { kind: 'compact-checkpoint' }); }
  measure() { const nodes = this.surface.nodes.map((seq) => ({ seq, tokens: this.prices.get(seq), heuristicTokens: this.prices.get(seq) }));
    return { nodes, totalTokens: this.forcedPressure ?? nodes.reduce((sum, n) => sum + n.tokens, 0) + 1000 }; }
}
export const pairing = {
  before(session, seq) { return balance(session, session.surface.nodes.indexOf(seq)); },
  after(session, seq) { return balance(session, session.surface.nodes.indexOf(seq) + 1); },
};
function balance(session, cut) {
  let pending = 0;
  for (const seq of session.surface.nodes.slice(0, cut)) {
    const event = session.eventAt(seq);
    if (event.type === 'assistant/message') pending += event.data.message.content.filter((b) => b.type === 'tool-call').length;
    if (event.type === 'tool/result') pending--;
    assert(pending >= 0, 'invalid fake fixture');
  }
  return pending === 0;
}
export function fixture(config = {}, dependencies = {}) {
  const session = new FakeSession();
  session.add('system/message', 1000);
  session.add('user/message', 240000);
  session.add('user/message', 10000);
  const state = { calls: 0, stock: [], flushes: 0, now: 0, logs: [], commands: [], summary: async () => 'short summary' };
  const ctx = {
    logger: { info: (message) => state.logs.push(message), warn: (message) => state.logs.push(message) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 262144 }, defaultMaxTokens: 32768 }) },
    tokenMeter: { measure: (s) => s.measure() },
    get: (key) => key === 'commands' ? { register: (definition) => { state.commands.push(definition); return () => {}; } } : state[key],
    effect: (fn) => { const iterator = fn(); iterator.next(); },
  };
  class FakeBasic {
    constructor(context, source) { this.ctx = context; this.config = { maxTokens: 65536, auto: true, ...source }; }
    async compactIfNeeded(agent, trigger) { state.stock.push(trigger); return state.stockResult ?? null; }
    async summarize(input, agent, signal) { state.calls++; return state.summary(input, agent, signal); }
    async compactRegion(start, end, agent, signal) {
      const s = agent.session;
      s.log('compaction/start');
      try {
        const value = await this.summarize({ messages: s.surface.nodes.map((seq) => s.deriveEventMessage(s.eventAt(seq))) }, agent, signal);
        if (value === 'NO_SHRINK') throw new Error('summary is not smaller than the shadowed content (300 estimated framed tokens >= 200)');
        if (value === 'COMMIT_ERROR') throw new Error('synthetic commit failure');
        const i = s.surface.nodes.indexOf(start), j = s.surface.nodes.indexOf(end);
        const shadowedSeqs = s.surface.nodes.slice(i, j + 1);
        s.log('compaction/summary');
        const newSeq = s.checkpoint(100);
        s.surface.nodes.pop();
        s.surface.nodes.splice(i, j - i + 1, newSeq);
        s.surface.replaceGeneration++;
        return { shadowedSeqs, shadowedRange: { start, end }, shadowedTokenCount: 100 };
      } finally { s.log('compaction/end'); }
    }
    async compactNow(agent, signal, sourceCommandId) {
      state.manual = sourceCommandId;
      const s = agent.session;
      const result = await this.compactRegion(s.surface.nodes[1], s.surface.nodes.at(-2), agent, signal);
      state.flushes++;
      return result;
    }
  }
  const Engine = createPolicyEngine({ BasicCompactionEngine: FakeBasic,
    toolPairingBalancedBefore: pairing.before, toolPairingBalancedAfter: pairing.after }, { now: () => state.now, ...dependencies });
  const engine = new Engine(ctx, config);
  return { engine, ctx, state, session, agent: { session, options: { provider: 'wrong-option', model: 'wrong-option', maxTokens: 131072 } }, signal: new AbortController().signal };
}
