// Version-pinned compatibility adapter, NOT a public DSH strategy API.
// It changes one dynamically-dispatched method; no Service is constructed,
// no second event listener is added and no preset/session is recomposed.
import { createHash } from 'node:crypto';
import { createPolicyEngine } from './engine.js';
import { resolveConfig } from './policy.js';

const KEY = Symbol.for('dsh-compaction-policy.global-adapter.v1');
const METHODS = ['compactIfNeeded', 'compactRegion', 'regionDependencies', 'summarize', 'compactNow'];
const raw = value => value?.[Symbol.for('cordis.original')] ?? value;
const rootOf = ctx => raw(ctx?.root);
const hash = fn => createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');

export const RC2_METHOD_HASHES = Object.freeze({
  compactIfNeeded: 'fd7625c4d66b8286fca1098ddd0b98f2afcf3e9d93ae821836f7df13d21404c3',
  compactRegion: 'a247e99c98e56c0236fae5eaa00a2de25f2bff26f8069fb8f637b759cf5a4efa',
  regionDependencies: '808f10f4e9550664dfd4054f624deb2b45283bef7fb6541fbce9f41a9a7dea13',
  summarize: 'ae745613f2a453b5beeb5de758b30c06bf7b8ff40498de404b7b63423f1cdb07',
  compactNow: '5c34231543f1d21c8e77404aae5f1b0bca4fbbce0514f8ae7fd6cb3bf7a4240a',
});

export const GLOBAL_DEFAULTS = Object.freeze({
  thresholdRatio: .9,
  // The unoccupied 10% is the proactive reserve. Do not subtract the output
  // cap AGAIN; it remains unchanged on real requests (not a guarantee of fit).
  outputReserveCap: 0,
  headroomTokens: 0,
  pruneToolResults: false,
});

function waitForPending(pending, signal) {
  if (!signal) return pending.catch(() => {});
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(signal.reason); };
    const done = () => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) reject(signal.reason); else resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    pending.then(done, done);
  });
}

function registry() {
  let value = globalThis[KEY];
  if (value === undefined) {
    value = { abi: 1, managers: new WeakMap() };
    Object.defineProperty(globalThis, KEY, { value, configurable: false, writable: false });
  }
  if (value?.abi !== 1 || !(value.managers instanceof WeakMap)) throw new Error('compaction-policy: incompatible adapter registry');
  return value.managers;
}

/** Install for one Cordis runtime root. Existing/future EXACT official Basic
 * engines are eligible; custom subclasses/instance overrides are left alone.
 * dispose() deactivates immediately and drains our in-flight calls before
 * restoration. An unrelated wrapper is never overwritten on disposal.
 */
export function installGlobalAdapter({ BasicCompactionEngine: Basic, toolPairingBalancedBefore,
  toolPairingBalancedAfter, ctx, policy = {}, expectedHashes = RC2_METHOD_HASHES }) {
  const root = rootOf(ctx);
  if (!root) throw new Error('compaction-policy: a Cordis runtime root is required');
  const config = resolveConfig({ ...GLOBAL_DEFAULTS, ...policy });
  if (Object.keys(config.basic).length) throw new Error('compaction-policy: global mode preserves each existing Basic config; basic overrides are not supported');
  const managers = registry();
  let manager = managers.get(Basic.prototype);
  if (!manager) {
    const descriptor = Object.getOwnPropertyDescriptor(Basic.prototype, 'compactIfNeeded');
    if (!descriptor?.writable || !descriptor.configurable) throw new Error('compaction-policy: unsupported pressure method descriptor');
    const originals = {};
    for (const name of METHODS) {
      const method = Basic.prototype[name];
      if (typeof method !== 'function' || hash(method) !== expectedHashes[name]) {
        throw new Error(`compaction-policy: ${name} differs from the verified host; refusing an unknown version or foreign method patch`);
      }
      originals[name] = method;
    }
    // Capture lexical super targets BEFORE changing the live prototype.
    // Neither this bridge nor its policy subclass may be constructed.
    class Bridge { constructor() { throw new Error('compaction-policy: method bridge cannot construct a service'); } }
    for (const name of METHODS) Object.defineProperty(Bridge.prototype, name, { value: originals[name] });
    Object.freeze(Bridge.prototype);
    manager = { descriptor, originals, roots: new Map(), wrapper: null, Bridge };
    const m = manager;
    m.restore = () => {
      if (m.roots.size) return 'active-other-roots';
      if (Object.getOwnPropertyDescriptor(Basic.prototype, 'compactIfNeeded')?.value !== m.wrapper) {
        return 'inactive-foreign-wrapper-retained';
      }
      Object.defineProperty(Basic.prototype, 'compactIfNeeded', m.descriptor);
      managers.delete(Basic.prototype);
      return 'restored';
    };
    m.wrapper = function (...args) {
      const receiver = this;
      const engine = raw(receiver);
      const exact = Object.getPrototypeOf(engine) === Basic.prototype && !METHODS.some(name => Object.hasOwn(engine, name));
      const methodsUnchanged = METHODS.every(name => name === 'compactIfNeeded' || Basic.prototype[name] === m.originals[name]);
      const owner = exact && methodsUnchanged && m.roots.get(rootOf(engine.ctx));
      const [agent, trigger, signal] = args;
      if (!owner) { m.restore(); return m.originals.compactIfNeeded.apply(receiver, args); }
      // Preserve the async method's cancellation contract even when a second
      // pressure call would otherwise be deduplicated before facade dispatch.
      try { signal?.throwIfAborted(); } catch (error) { return Promise.reject(error); }
      const pending = owner.pending.get(agent.session);
      if (pending) {
        if (owner.active && trigger === 'pressure') return Promise.resolve(null);
        return waitForPending(pending, signal).then(() => { signal?.throwIfAborted(); return m.wrapper.apply(receiver, args); });
      }
      if (!owner.active) return m.originals.compactIfNeeded.apply(receiver, args);
      let facade = owner.facades.get(engine);
      if (!facade) {
        const Policy = createPolicyEngine({ BasicCompactionEngine: m.Bridge, toolPairingBalancedBefore, toolPairingBalancedAfter });
        facade = Object.create(Policy.prototype);
        facade.policyConfig = owner.config;
        owner.facades.set(engine, facade);
      }
      const call = Object.create(facade);
      // Retain caller-context injection and exact existing summary config.
      call.ctx = receiver.ctx;
      call.config = engine.config;
      const promise = Promise.resolve().then(() => call.compactIfNeeded(...args));
      owner.pending.set(agent.session, promise);
      owner.inFlight.add(promise);
      const cleanup = () => { owner.pending.delete(agent.session); owner.inFlight.delete(promise); };
      promise.then(cleanup, cleanup);
      return promise;
    };
    Object.defineProperty(Basic.prototype, 'compactIfNeeded', { ...descriptor, value: m.wrapper });
    managers.set(Basic.prototype, m);
  } else {
    if (Basic.prototype.compactIfNeeded !== manager.wrapper) throw new Error('compaction-policy: foreign wrapper above adapter; refusing another install');
    // Another package copy must agree on EVERY pinned original, not just ABI.
    for (const name of METHODS) if (hash(manager.originals[name]) !== expectedHashes[name]
      || (name !== 'compactIfNeeded' && Basic.prototype[name] !== manager.originals[name])) {
      throw new Error(`compaction-policy: incompatible or changed host method ${name}`);
    }
  }
  if (manager.roots.has(root)) throw new Error('compaction-policy: already installed or draining in this runtime');
  const owner = { active: true, config, facades: new WeakMap(), pending: new WeakMap(), inFlight: new Set() };
  manager.roots.set(root, owner);
  let disposal;
  return {
    status(engine, session) {
      const original = raw(engine);
      if (!original || Object.getPrototypeOf(original) !== Basic.prototype || METHODS.some(name => Object.hasOwn(original, name))) {
        return { reason: 'not-an-unmodified-official-basic-engine' };
      }
      if (rootOf(original.ctx) !== root) return { reason: 'outside-runtime' };
      if (METHODS.some(name => name !== 'compactIfNeeded' && Basic.prototype[name] !== manager.originals[name])) {
        return { reason: 'host-method-changed-after-activation' };
      }
      return owner.facades.get(original)?.status(session) ?? { reason: 'not-measured' };
    },
    reset(engine, session) {
      const original = raw(engine);
      const facade = owner.facades.get(original);
      if (!facade) return;
      const call = Object.create(facade);
      call.ctx = engine.ctx;
      call.config = original.config;
      return call.reset(session);
    },
    dispose() {
      if (disposal) return disposal;
      owner.active = false;
      disposal = (async () => {
        await Promise.allSettled([...owner.inFlight]);
        manager.roots.delete(root);
        return manager.restore();
      })();
      return disposal;
    },
  };
}
