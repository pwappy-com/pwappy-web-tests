// Main/manual/scheduled Premium guard; does not execute the branch trigger/deployment guard.
// No CLI arguments or arbitrary destinations/commands. Only the shared read-only key check.
import { pathToFileURL } from 'node:url';
import { assertFreshPremiumAuthCache, assertNoRegisteredGeminiKey, PremiumKeyPreflightError } from './premium-key-preflight.mjs';

export async function preflightMainPremium(env = process.env, dependencies = {}) {
  // The protected account and the actual browser suite must target the same staging service.
  let base;
  try { base = new URL(env.PWAPPY_TEST_BASE_URL); }
  catch { throw new PremiumKeyPreflightError('configuration'); }
  if (base.origin !== 'https://dev.pwappy-dev.com' || base.username || base.password || base.search || base.hash
      || !['/', '/editor', '/editor/'].includes(base.pathname)) {
    throw new PremiumKeyPreflightError('configuration');
  }
  const browser = env.PWAPPY_PREFLIGHT_BROWSER;
  const os = env.PWAPPY_PREFLIGHT_OS;
  assertFreshPremiumAuthCache(browser, os, dependencies.authRoot || process.cwd());
  await assertNoRegisteredGeminiKey(browser, os, env, dependencies.requestAPI);
}
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const output = dependencies.output || console;
  try {
    if (args.length !== 0) throw new PremiumKeyPreflightError('configuration');
    await preflightMainPremium(env, dependencies);
    output.log('Premium credential safety check passed; dedicated account has no registered Gemini key.');
    return 0;
  } catch (error) {
    output.error(error instanceof PremiumKeyPreflightError
      ? `::error::${error.message}`
      : '::error::Premium credential safety check blocked; no Premium tests or cleanup started.');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
