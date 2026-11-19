// A recording-cost policy, never an authorization or test-selection override.
// The caller executes only after the existing main/deployment/account guards.
import { readFileSync } from 'node:fs';
import { SCHEDULES } from './main-verification-guard.mjs';
export function omitScheduledMacTraceScreenshots(selection, phase, env, runtime = process) {
  if (phase !== 'tests' || selection.mode !== 'main' || selection.suite !== 'normal'
      || selection.scope !== 'all' || selection.os !== 'macos-latest'
      || !['webkit', 'mobile-safari'].includes(selection.browser)
      || runtime.platform !== 'darwin' || runtime.arch !== 'arm64'
      || env.GITHUB_EVENT_NAME !== 'schedule' || env.GITHUB_REF !== 'refs/heads/main') return false;
  // Reuse the existing Mac/Windows Normal schedule route, not a caller-supplied flag.
  // Malformed evidence retains existing recording; the main guard still rejects it.
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    return event.schedule === SCHEDULES[1];
  } catch { return false; }
}
