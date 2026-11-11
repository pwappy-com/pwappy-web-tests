// Protect preexisting credentials before Premium tests delete or replace settings.
// Only the normal test-login POST and one read-only user-setting GET are permitted.
import { createRequire } from 'node:module';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGIN_ENDPOINT, MATRIX, STAGING_ORIGIN } from './branch-verification-guard.mjs';
const require = createRequire(import.meta.url);
// .env.base (copied into the deployment .env) and CookieService's explicit fallback.
// The live staging cookie name has not been observed; unknown names fail closed.
export const IDENTITY_COOKIE_NAME = 'pwappy_ident_key';
export const IDENTITY_COOKIE_NAMES = Object.freeze([IDENTITY_COOKIE_NAME, 'pwappy_ident']);
export const USER_SETTING_ENDPOINT = `${STAGING_ORIGIN}/pwappy-api/rest/v1/user-setting`;
const messages = Object.freeze({
  configuration: 'Premium key safety check blocked: invalid dedicated account configuration.',
  login: 'Premium key safety check blocked: test account login was unavailable.',
  identity: 'Premium key safety check blocked: the service-issued session identity could not be verified.',
  cache: 'Premium key safety check blocked: existing authentication state must not be reused or overwritten.',
  settings: 'Premium key safety check blocked: registration status was unavailable or malformed.',
  registered: 'Premium key safety check blocked: this test account already has a registered Gemini key; no Premium tests or cleanup started.',
  disposal: 'Premium key safety check blocked: authenticated request context could not be disposed.',
  failed: 'Premium key safety check blocked: registration status could not be verified.',
});
export class PremiumKeyPreflightError extends Error {
  constructor(code) {
    super(messages[Object.hasOwn(messages, code) ? code : 'failed']);
    this.name = 'PremiumKeyPreflightError';
  }
}
export function dedicatedAccount(browser, os) {
  const entry = MATRIX.find(item => item.browser === browser && item.os === os);
  const osCode = { 'ubuntu-latest': 'u', 'windows-latest': 'w', 'macos-latest': 'm' }[os];
  if (!entry || !osCode) throw new PremiumKeyPreflightError('configuration');
  return `pw${osCode}${entry.code}000`;
}
export function assertFreshPremiumAuthCache(browser, os, root = process.cwd()) {
  return assertFreshTestAccountAuthCache(browser, os, '0', root);
}
// Main CI can use multiple parallel slots. The branch entry points remain index-zero only.
export function mainAccount(browser, os, index) {
  if (!/^(0|[1-9][0-9]{0,2})$/.test(String(index)) || Number(index) > 996) {
    throw new PremiumKeyPreflightError('configuration');
  }
  return dedicatedAccount(browser, os).slice(0, 4) + String(index).padStart(3, '0');
}
export function assertFreshTestAccountAuthCache(browser, os, index, root = process.cwd()) {
  const account = mainAccount(browser, os, index);
  const directory = join(root, '.auth');
  const file = join(directory, `user-${account[2]}-${account[3]}-${Number(index)}.json`);
  try {
    const directoryStat = lstatSync(directory, { throwIfNoEntry: false });
    if (directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())) {
      throw new Error('invalid cache directory');
    }
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || readFileSync(file, 'utf8').trim() !== '{}') {
        throw new Error('nonempty cache');
      }
    }
  } catch { throw new PremiumKeyPreflightError('cache'); }
}
export function assertSessionIdentity(state, identkey, now = Date.now() / 1000) {
  // CookieService::setPwappyIdentKeyCookie sets path=/, Secure and HttpOnly;
  // AUTH_COOKIE_DOMAIN may cover the stage host or its pwappy-dev.com parent.
  // Playwright represents a subdomain-scoped Domain cookie with a leading dot.
  const identities = Array.isArray(state?.cookies)
    ? state.cookies.filter(cookie => IDENTITY_COOKIE_NAMES.includes(cookie?.name)) : [];
  const cookie = identities[0];
  if (identities.length !== 1 || cookie.value !== identkey
      || !['dev.pwappy-dev.com', '.dev.pwappy-dev.com', '.pwappy-dev.com'].includes(cookie.domain)
      || cookie.path !== '/' || cookie.secure !== true || cookie.httpOnly !== true
      || !Number.isFinite(cookie.expires) || (cookie.expires !== -1 && cookie.expires <= now)) {
    throw new PremiumKeyPreflightError('identity');
  }
}
export async function assertNoRegisteredGeminiKey(browser, os, env, requestAPI) {
  if (env.PWAPPY_TEST_ACCOUNT_INDEX !== '0') throw new PremiumKeyPreflightError('configuration');
  return assertNoRegisteredTestAccountKey(browser, os, '0', env, requestAPI);
}
export async function assertNoRegisteredTestAccountKey(browser, os, index, env, requestAPI) {
  return assertAccountHasNoRegisteredKey(mainAccount(browser, os, index), env, requestAPI);
}
export async function assertNoRegisteredSmokeAccountKey(browser, os, env, requestAPI) {
  return assertAccountHasNoRegisteredKey(dedicatedAccount(browser, os).slice(0, 4) + '998', env, requestAPI);
}
async function assertAccountHasNoRegisteredKey(identkey, env, requestAPI) {
  if (env.PWAPPY_TEST_LOGIN_ENDPOINT !== LOGIN_ENDPOINT
      || typeof env.PWAPPY_TEST_LOGIN_PASSCODE !== 'string' || env.PWAPPY_TEST_LOGIN_PASSCODE.length === 0) {
    throw new PremiumKeyPreflightError('configuration');
  }
  // Do not load a cached .auth file or dotenv; use a fresh, in-memory cookie jar.
  // Fixed HTTPS destinations and maxRedirects:0 prevent credentials following a redirect.
  let context;
  try {
    context = await (requestAPI || require('@playwright/test').request).newContext({
      ignoreHTTPSErrors: false,
    });
    let login;
    try {
      login = await context.post(LOGIN_ENDPOINT, {
        data: { passcode: env.PWAPPY_TEST_LOGIN_PASSCODE, identkey },
        maxRedirects: 0, maxRetries: 0, timeout: 15000, failOnStatusCode: false,
      });
    } catch { throw new PremiumKeyPreflightError('login'); }
    if (login.status() !== 200 || login.url() !== LOGIN_ENDPOINT) throw new PremiumKeyPreflightError('login');
    try {
      // No path argument: inspect the server-issued cookie jar only in memory.
      // Never treat an unverified JWT payload as proof of the authenticated user.
      assertSessionIdentity(await context.storageState(), identkey);
    } catch { throw new PremiumKeyPreflightError('identity'); }
    let response, body;
    try {
      response = await context.get(USER_SETTING_ENDPOINT, {
        maxRedirects: 0, maxRetries: 0, timeout: 15000, failOnStatusCode: false,
      });
      if (response.status() !== 200 || response.url() !== USER_SETTING_ENDPOINT) throw new Error('invalid status');
      body = await response.json();
    } catch { throw new PremiumKeyPreflightError('settings'); }
    if (body?.code !== 200) throw new PremiumKeyPreflightError('settings');
    const registered = body?.details?.userSetting?.isUserGeminiApiKeyRegistered;
    if (registered === true) throw new PremiumKeyPreflightError('registered');
    if (registered !== false) throw new PremiumKeyPreflightError('settings');
    // Deliberately return no user setting data, cookies, response body or credential.
  } catch (error) {
    throw error instanceof PremiumKeyPreflightError ? error : new PremiumKeyPreflightError('failed');
  } finally {
    if (context) {
      try { await context.dispose(); }
      catch { throw new PremiumKeyPreflightError('disposal'); }
    }
  }
}
