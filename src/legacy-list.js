import { createHash } from 'node:crypto';

export const RC2_LIST_HASH = '0d90f7b34308af7acda2730aa0ace2bc2f5ded043645f2589878d564c3412129';
const hash = fn => createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');

/** Hide only our compatibility declaration from the selection roster, not
 * resolution/mount/retain. Never hide a selected default or a broken entry.
 * No global registry prototype changes, and no history/preset-id rewrites.
 */
export function hideLegacyPreset(service, id, expectedHash = RC2_LIST_HASH) {
  const registry = service?.[Symbol.for('cordis.original')] ?? service;
  if (!registry || typeof registry.list !== 'function') throw new Error('compaction-policy: missing preset list service');
  const descriptor = Object.getOwnPropertyDescriptor(registry, 'list');
  const original = registry.list;
  if (descriptor || hash(original) !== expectedHash) throw new Error('compaction-policy: unsupported or already wrapped preset list');
  let active = true;
  const wrapper = async function (...args) {
    const rows = await original.apply(this, args);
    if (!active) return rows;
    return rows.filter(row => row.id !== id || row.id === this.defaultId || row.broken !== undefined);
  };
  Object.defineProperty(registry, 'list', { value: wrapper, writable: true, configurable: true });
  return () => {
    active = false;
    if (Object.getOwnPropertyDescriptor(registry, 'list')?.value !== wrapper) return 'inactive-foreign-wrapper-retained';
    delete registry.list; // Exact checked own method; reveal the original inherited method.
    return 'restored';
  };
}
