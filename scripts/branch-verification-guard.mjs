// No dotenv, authentication, mutations, or arbitrary URLs. Errors never include inputs.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STAGING_ORIGIN = 'https://dev.pwappy-dev.com';
export const LOGIN_ENDPOINT = `${STAGING_ORIGIN}/pwappy-api/rest/v1/test-login`;
export const POINTS_ENDPOINT = `${STAGING_ORIGIN}/pwappy-api/read/v1/pwappy-points`;
export const BRANCH = 'refs/heads/feat/webmcp-authoring';
export const MARKER = '[verify-webmcp]';
export const MATRIX = Object.freeze([
  { os: 'ubuntu-latest', runner: 'ubuntu-latest', suffix: 'ubuntu', browser: 'chromium', binary: 'chromium', code: 'c' },
  { os: 'ubuntu-latest', runner: 'ubuntu-latest', suffix: 'ubuntu', browser: 'mobile-chrome', binary: 'chromium', code: 'a' },
  { os: 'ubuntu-latest', runner: 'ubuntu-latest', suffix: 'ubuntu', browser: 'firefox', binary: 'firefox', code: 'f' },
  { os: 'windows-latest', runner: 'windows-latest', suffix: 'win', browser: 'chromium', binary: 'chromium', code: 'c' },
  { os: 'macos-latest', runner: 'macos-26-intel', suffix: 'macos', browser: 'webkit', binary: 'webkit', code: 's' },
  { os: 'macos-latest', runner: 'macos-26-intel', suffix: 'macos', browser: 'mobile-safari', binary: 'webkit', code: 'i' },
]);
const fail = reason => { throw new Error(`Branch verification blocked: ${reason}.`); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export function readPin() {
  return JSON.parse(readFileSync(new URL('../.github/webmcp-verification.json', import.meta.url), 'utf8'));
}
export function validateStagingConfiguration(env, pin, suite) {
  if (!['preflight', 'normal', 'premium'].includes(suite)) fail('invalid suite');
  if (!pin || Object.keys(pin).join(',') !== 'sourceCommit' || !sha(pin.sourceCommit)) fail('invalid source pin');
  // A second supplied SHA is optional, but must never silently override the checked-in pin.
  if (env.PWAPPY_WEBMCP_SOURCE_SHA && env.PWAPPY_WEBMCP_SOURCE_SHA !== pin.sourceCommit) fail('source pin mismatch');
  let base;
  try { base = new URL(env.PWAPPY_TEST_BASE_URL); } catch { fail('invalid staging base configuration'); }
  if (base.origin !== STAGING_ORIGIN || base.username || base.password || base.search || base.hash
      || !['/', '/editor', '/editor/'].includes(base.pathname)) fail('unexpected staging base configuration');
  if (suite !== 'preflight') {
    if (env.PWAPPY_TEST_LOGIN_ENDPOINT !== LOGIN_ENDPOINT) fail('unexpected staging login configuration');
    if (env.PWAPPY_TEST_POINTS_READ_ENDPOINT && env.PWAPPY_TEST_POINTS_READ_ENDPOINT !== POINTS_ENDPOINT) {
      fail('unexpected staging points configuration');
    }
  }
  // Normal synthetic-account writes are separate from live Premium publication/moderation scope.
  if (suite === 'premium' && env.PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA !== pin.sourceCommit) {
    fail('live Premium authorization for this source commit is missing');
  }
  return { sourceCommit: pin.sourceCommit, baseURL: base.href };
}
export function validateConfiguration(env, event, pin, suite) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== BRANCH || !sha(env.GITHUB_SHA)
      || event?.ref !== BRANCH || event?.deleted === true || event?.forced === true
      || event?.after !== env.GITHUB_SHA || event?.head_commit?.id !== env.GITHUB_SHA
      || typeof event?.head_commit?.message !== 'string' || !event.head_commit.message.includes(MARKER)) {
    fail('unexpected trigger or unmarked commit');
  }
  return validateStagingConfiguration(env, pin, suite);
}
export async function verifyStage(env, event, pin, suite, fetchImpl = fetch) {
  const result = validateConfiguration(env, event, pin, suite);
  return verifyPinnedDeployment(env, result, fetchImpl);
}
export async function verifyPinnedDeployment(env, result, fetchImpl = fetch) {
  // Fixed origin/root marker: do not append to a secret base URL ending in /editor.
  const marker = new URL('/staging-deployment.json', STAGING_ORIGIN);
  marker.searchParams.set('verify', `${env.GITHUB_SHA}-${Date.now()}`);
  let response;
  try {
    response = await fetchImpl(marker, { method: 'GET', redirect: 'error', credentials: 'omit',
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  } catch { fail('staging marker request failed'); }
  if (!response.ok || response.redirected || new URL(response.url).origin !== STAGING_ORIGIN) fail('staging marker response invalid');
  // Bound the response before parsing; never log service text on error.
  let data;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4096) { fail('staging marker is oversized'); }
      chunks.push(chunk);
    }
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { fail('staging marker body invalid'); }
  if (!data || Object.keys(data).sort().join(',') !== 'commit,run_attempt,run_id'
      || data.commit !== result.sourceCommit || typeof data.run_id !== 'string' || typeof data.run_attempt !== 'string'
      || !/^[1-9][0-9]{0,19}$/.test(data.run_id)
      || !/^[1-9][0-9]{0,7}$/.test(data.run_attempt)) fail('staging marker does not match the pinned deployment');
  return result;
}
export async function guard(suite, env = process.env, fetchImpl = fetch) {
  let event;
  try { event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); }
  catch { fail('event metadata unavailable'); }
  return verifyStage(env, event, readPin(), suite, fetchImpl);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await guard(process.argv[2] || 'preflight');
    console.log('Pinned staging deployment verified; no authentication or mutations performed.');
  } catch (error) {
    // Only our fixed vocabulary is public, never arbitrary fetch/JSON errors or URL values.
    console.error(error.message?.startsWith('Branch verification blocked:') ? error.message : 'Branch verification blocked.');
    process.exitCode = 1;
  }
}
