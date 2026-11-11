'use strict';
const path = require('node:path');

// Deliberately do not forward arbitrary Playwright/config/project arguments.
function parseOptions(args, repoRoot) {
  const options = { list: false, headed: false, grep: undefined, appRoot: path.resolve(repoRoot, '../pwappy-web') };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') options.list = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--grep' || arg === '--app-root') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--grep') options.grep = value;
      else options.appRoot = path.resolve(value);
    } else throw new Error(`Unsupported argument: ${arg}. Only --list, --headed, --grep and --app-root are allowed.`);
  }
  return options;
}

function childEnvironment(source = process.env) {
  const env = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (source[name]) env[name] = source[name];
  }
  env.NODE_ENV = 'development';
  env.BUILD_ENV = 'development';
  env.CI = '1';
  return env;
}

module.exports = { parseOptions, childEnvironment };
