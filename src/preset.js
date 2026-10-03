import { readFile } from 'node:fs/promises';
import { Service } from '@deepseek-ai/cordis';
import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import z from '@deepseek-ai/schemastery';
import yaml from 'js-yaml';
import PolicyCompactionEngine from './index.js';
import { createPresetDefinition } from './preset-definition.js';

/** Register a separate preset from the current host's shipped standard.
 * No runtime path discovery, profile writes, or default-model changes.
 */
export default class CompactionPolicyPreset {
  static inject = ['agentPresets'];
  static [EntryGroup.key] = true;
  static Config = z.object({
    id: z.string(),
    name: z.string(),
    policy: PolicyCompactionEngine.Config,
  });

  constructor(ctx, config = {}) { this.ctx = ctx; this.config = config; }

  async *[Service.init]() {
    const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml')), 'utf8');
    // Preserve !!js as host expression nodes. Never evaluate YAML expressions here.
    const entries = yaml.load(source, { schema: entryListSchema });
    const definition = createPresetDefinition(entries, this.config);
    yield await this.ctx.agentPresets.register(definition);
  }
}
