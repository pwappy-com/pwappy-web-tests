// Main/scheduled/manual execution shares deployment checks, never the marked-branch trigger.
import { readFileSync } from 'node:fs';
import { readPin, validateStagingConfiguration, verifyPinnedDeployment } from './branch-verification-guard.mjs';
export const SCHEDULES = ['0 1,4,7,10,13,20,23 * * *', '0 18 * * *', '0 0 * * *'];
export function validateMainConfiguration(env, event, pin, suite) {
  const fail = () => { throw new Error('Main verification blocked: unexpected trigger.'); };
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) fail();
  switch (env.GITHUB_EVENT_NAME) {
    case 'push':
      if (env.GITHUB_REF !== 'refs/heads/main' || event?.ref !== env.GITHUB_REF
          || event.after !== env.GITHUB_SHA || event.head_commit?.id !== env.GITHUB_SHA
          || event.deleted === true || event.forced === true) fail();
      break;
    case 'schedule':
      if (env.GITHUB_REF !== 'refs/heads/main' || !SCHEDULES.includes(event?.schedule)) fail();
      break;
    case 'workflow_dispatch':
      // Preserve the existing branch selector; the selected checkout's pin must match staging.
      if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(env.GITHUB_REF || '')
          || ![env.GITHUB_REF, env.GITHUB_REF.slice('refs/heads/'.length)].includes(event?.ref)) fail();
      break;
    default: fail();
  }
  return validateStagingConfiguration(env, pin, suite);
}
export async function mainGuard(suite, env = process.env, dependencies = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const result = validateMainConfiguration(env, event, (dependencies.readPin || readPin)(), suite);
  return verifyPinnedDeployment(env, result, dependencies.fetch || fetch);
}
