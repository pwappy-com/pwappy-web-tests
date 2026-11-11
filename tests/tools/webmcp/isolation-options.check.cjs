'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOptions, childEnvironment } = require('./isolation-options.cjs');

test('safe runner accepts only explicit isolated options', () => {
  assert.equal(parseOptions([], '/tmp/tests').appRoot, '/tmp/pwappy-web');
  assert.deepEqual(parseOptions(['--list', '--headed', '--grep', 'native', '--app-root', '/tmp/app'], '/tmp/tests'),
    { list: true, headed: true, grep: 'native', appRoot: '/tmp/app' });
});
test('cannot redirect safe runner to live configuration, cleanup or arbitrary project', () => {
  for (const args of [['--config', 'playwright.config.ts'], ['tests/tools/a0-cleanup-all-apps.spec.ts'], ['--project', 'chromium'], ['--grep'], ['--app-root', '--list']]) {
    assert.throws(() => parseOptions(args, '/tmp/tests'));
  }
});
test('child environment drops credentials, saved-login settings and Node injection', () => {
  const env = childEnvironment({ PATH: '/bin', HOME: '/tmp/home', DISPLAY: ':0', PWAPPY_TEST_LOGIN_PASSCODE: 'synthetic-secret', PWAPPY_TEST_BASE_URL: 'https://not-used.invalid', NODE_OPTIONS: '--require not-used', TEST_GEMINI_API_KEY: 'synthetic-key', HTTPS_PROXY: 'https://not-used.invalid' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/tmp/home', DISPLAY: ':0', NODE_ENV: 'development', BUILD_ENV: 'development', CI: '1' });
});
