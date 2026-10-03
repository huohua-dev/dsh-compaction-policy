// Test-only resolver. Production uses the DSH plugin loader, never this hook.
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.DSH_HOST_ROOT) throw new Error('Set DSH_HOST_ROOT to the installed DSH runtime directory; see CONTRIBUTING.md.');
const parentURL = pathToFileURL(resolve(process.env.DSH_HOST_ROOT, '__policy_test_resolution__.mjs')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/')) {
      return nextResolve(specifier, { ...context, parentURL });
    }
    return nextResolve(specifier, context);
  },
});
