/** Historical v0.1 identity, using STOCK Basic so the global adapter can apply.
 * It is a real definition (not a resolve alias): children and restored sessions
 * keep their logged identity. The legacy plugin hides it only from the roster.
 */
export function createLegacyDefinition(entries) {
  const definition = createPresetDefinition(entries);
  const backend = definition.plugins.find(row => row.id === 'compaction').config
    .find(row => row.id === 'compaction-policy-engine');
  backend.id = 'compaction-basic';
  backend.name = '@deepseek-ai/dsh-compaction-basic';
  backend.config = backend.config.basic;
  definition.name = 'Legacy compaction-policy (compatibility)';
  definition.description = 'Historical v0.1 session identity; use an existing normal preset for new sessions.';
  return definition;
}

/** Transform the host's shipped standard in memory. No filesystem writes,
 * copied roster, registry-default override, or edits to the source preset.
 */
export function createPresetDefinition(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError('host standard patch must be an entry list');
  const rows = entries.flatMap((entry) => entry.insert ?? []);
  const standard = rows.filter((row) => row.id === 'preset-standard' && row.config?.id === 'standard');
  if (standard.length !== 1 || !Array.isArray(standard[0].config.plugins)) {
    throw new Error('unsupported host standard preset shape');
  }
  const plugins = structuredClone(standard[0].config.plugins);
  const groups = plugins.filter((row) => row.id === 'compaction');
  if (groups.length !== 1 || groups[0].group !== true || groups[0].isolate?.compaction !== true
    || groups[0].isolate?.toolResultPruner !== true || !Array.isArray(groups[0].config)) {
    throw new Error('unsupported host compaction isolation shape');
  }
  const backends = groups[0].config.filter((row) => row.id === 'compaction-basic');
  if (backends.length !== 1 || backends[0].name !== '@deepseek-ai/dsh-compaction-basic') {
    throw new Error('expected exactly one official compaction-basic backend');
  }
  const id = options.id ?? 'compaction-policy';
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)
    || ['standard', 'minimal', 'ptc', 'code', 'cordis'].includes(id)) {
    throw new TypeError('choose a distinct lowercase preset id (not a built-in preset)');
  }
  // This is a newly owned cloned row, not a Loader id-targeted name patch.
  const stockConfig = backends[0].config ?? {};
  backends[0].id = 'compaction-policy-engine';
  backends[0].name = 'dsh-compaction-policy';
  backends[0].config = structuredClone({ basic: stockConfig, ...(options.policy ?? {}) });
  return {
    id,
    name: options.name ?? 'Compaction Policy (standard)',
    description: 'Capped output reservation and no-progress retry guards / 独立输出预留与压缩失败退避',
    order: 30,
    plugins,
  };
}
