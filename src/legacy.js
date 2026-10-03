import { readFile } from 'node:fs/promises';
import { Service } from '@deepseek-ai/cordis';
import cordisPackage from '@deepseek-ai/cordis/package.json' with { type: 'json' };
import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader';
import registryPackage from '@deepseek-ai/dsh-agent-preset-registry/package.json' with { type: 'json' };
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import yaml from 'js-yaml';
import { createLegacyDefinition } from './preset-definition.js';
import { hideLegacyPreset } from './legacy-list.js';

/** Non-selectable compatibility identity, not a new user-facing preset. */
export default class LegacyCompactionPreset {
  static inject = ['agentPresets'];
  static [EntryGroup.key] = true;
  constructor(ctx) { this.ctx = ctx; }
  async *[Service.init]() {
    if (registryPackage.version !== '0.2.0-rc.2' || cordisPackage.version !== '4.0.4') throw new Error('compaction-policy legacy compatibility requires DSH registry 0.2.0-rc.2 and Cordis 4.0.4');
    const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml')), 'utf8');
    const definition = createLegacyDefinition(yaml.load(source, { schema: entryListSchema }));
    const registry = this.ctx.agentPresets[Symbol.for('cordis.original')] ?? this.ctx.agentPresets;
    if (!(registry.definitions instanceof Map)) throw new Error('compaction-policy: unsupported registry ownership map');
    if (registry.definitions.has(definition.id)) throw new Error('compaction-policy: legacy identity already registered; remove the old explicit preset plugin before enabling compatibility');
    // Filter before asynchronous activation so roster reads cannot cache a
    // transient visible row. Duplicate ownership was checked synchronously.
    const restore = hideLegacyPreset(this.ctx.agentPresets, definition.id);
    yield () => {
      if (restore() === 'inactive-foreign-wrapper-retained') this.ctx.logger?.warn('[compaction-policy] legacy roster filter disabled; foreign list wrapper retained.');
    };
    yield await this.ctx.agentPresets.register(definition);
    if (this.ctx.agentPresets.defaultId === definition.id) {
      this.ctx.logger?.warn('[compaction-policy] legacy preset is still your selected default; it stays visible until you select an existing normal default. No preference was silently changed.');
    }
  }
}
