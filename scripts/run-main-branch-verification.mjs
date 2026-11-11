// Rehearse the production CI core under the existing marked-feature-push boundary.
// No event/ref/SHA rewriting and no additional event authorization.
import { pathToFileURL } from 'node:url';
import { guard } from './branch-verification-guard.mjs';
import { main } from './run-main-verification.mjs';
export async function runMainBranch(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  return main(args, env, { ...dependencies, guard: dependencies.guard || guard }, 'branch');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runMainBranch();
