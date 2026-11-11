'use strict';
// Load the actual webpack configuration without reading any developer .env file.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [appRootArg, outputArg] = process.argv.slice(2);
if (!appRootArg || !outputArg) throw new Error('Usage: build-isolated.cjs APP_ROOT NEW_OUTPUT_DIRECTORY');
const appRoot = fs.realpathSync(appRootArg), output = path.resolve(outputArg);
if (fs.existsSync(output)) throw new Error('Build output must be a new directory, never an existing deployment/build.');
fs.mkdirSync(output, { recursive: true });
process.chdir(appRoot);
process.env.NODE_ENV = 'development';
process.env.BUILD_ENV = 'development';
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const origin = 'http://127.0.0.1:8093';
const configValues = {
  ENDPOINT_BASE: origin + '/rest/', DEV_URL_BASE: origin + '/', APP_URL_BASE: origin + '/apps/', BRAND_URL_BASE: origin + '/',
  LOGIN_COOKIE_NAME: 'pwappy_login', EDITOR_VERSION: '1', SITE_NAME: 'Pwappy isolated QA',
  LOGIN_CLIENT_ID: 'isolated-unused', CLOUD_FLARE_TURNSTILE_SITE_KEY: 'isolated-unused', ADMAX_ID: 'isolated-unused', DISCORD_ADDR: '',
};
const endpoints = {
  ACCOUNT_ENDPOINT: 'account', ADMAX_VIEW_STATUS_ENDPOINT: 'admax-view-status', ADSENSE_VIEW_STATUS_ENDPOINT: 'adsense-view-status', AD_SUBSCRIPTION_ENDPOINT: 'ad-subscription',
  AI_AGENT_CANCEL: 'ai-agent/cancel', AI_AGENT_MESSAGE: 'ai-agent/message', AI_AGENT_STATUS: 'ai-agent/status', AI_CODE_CANCEL: 'ai-code/cancel', AI_CODE_ENDPOINT: 'ai-code',
  APPLICATION_ARCHIVE_ENDPOINT: 'application/archive', APPLICATION_DAILY_REPORT_ENDPOINT: 'application/daily-report', APPLICATION_ENDPOINT: 'application', APPLICATION_LIST_ENDPOINT: 'application-list', APPLICATION_RESTORE_ENDPOINT: 'application/restore',
  ARCHIVE_LIST_ENDPOINT: 'archive-list', COUPON_ENDPOINT: 'pwappy-coupons', DASHBOARD_INIT_ENDPOINT: 'dashboard-init', DIRECTORY_ENDPOINT: 'directory', DOWNLOAD_OUTPUT_ZIP_ENDPOINT: 'download-output-zip',
  EDITOR_JSON_ENDPOINT: 'editor-json', FILE_COPY_ENDPOINT: 'file-copy', FILE_DOWNLOAD_ENDPOINT: 'file-download', FILE_ENDPOINT: 'file', FILE_LIST_ENDPOINT: 'file-list', FILE_MOVE_ENDPOINT: 'file-move', FILE_UPLOAD_ENDPOINT: 'file-upload',
  LOGIN_ENDPOINT: 'login', LOGOUT_ALL_ENDPOINT: 'logout-all', LOGOUT_ENDPOINT: 'logout', MODERATION_STATUS_ENDPOINT: 'moderation-status', NOTIFICATION_ENDPOINT: 'notification', POINTS_ENDPOINT: 'points', POINTS_ENDPOINT_HISTORY: 'points-history',
  PUBLISHE_LIST_ENDPOINT: 'publish-list', USED_DISK_SPACE_ENDPOINT: 'used-disk-space', USER_GEMINI_API_KEY_ENDPOINT: 'user-gemini-api-key', USER_SETTING_ENDPOINT: 'user-setting',
  VERSION_DUPLICATE_ENDPOINT: 'version-duplicate', VERSION_ENDPOINT: 'version', VERSION_LIST_ENDPOINT: 'version-list', VERSION_STATUS_ENDPOINT: 'version-status',
};
for (const [name, endpoint] of Object.entries(endpoints)) configValues[name] = 'v1/' + endpoint;
const dotenv = appRequire('dotenv'), originalConfig = dotenv.config;
let config;
try {
  dotenv.config = () => ({ parsed: { ...configValues } });
  config = appRequire('./webpack.config.js');
} finally { dotenv.config = originalConfig; }
config.context = appRoot;
config.output = { ...config.output, path: output };
function hashSource() {
  const digest = createHash('sha256');
  function hashTree(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) hashTree(file);
      else if (item.isFile()) digest.update(path.relative(appRoot, file)).update('\0').update(fs.readFileSync(file));
    }
  }
  hashTree(path.join(appRoot, 'src')); hashTree(path.join(appRoot, 'public'));
  for (const name of ['package.json', 'package-lock.json', 'webpack.config.js']) digest.update(name).update(fs.readFileSync(path.join(appRoot, name)));
  return digest.digest('hex');
}
const sourceHash = hashSource();
const webpack = appRequire('webpack');
const compiler = webpack(config);
compiler.run((error, stats) => {
  compiler.close(closeError => {
    if (error || closeError || stats.hasErrors()) {
      console.error(error || closeError || stats.toString({ all: false, errors: true })); process.exitCode = 1; return;
    }
    if (hashSource() !== sourceHash) {
      console.error('Source changed during build; refusing to label this bundle as verified. Run again after edits finish.'); process.exitCode = 1; return;
    }
    const manifest = { sourceRoot: appRoot, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(), sourceHash, builtAt: new Date().toISOString(), environment: 'synthetic loopback endpoints, no .env loaded', assets: stats.toJson({ all: false, assets: true }).assets.map(a=>a.name) };
    fs.writeFileSync(path.join(output, 'isolated-build-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(stats.toString({ all: false, timings: true, errors: true, warnings: true }));
    console.log('Isolated build source SHA-256: ' + sourceHash);
  });
});
