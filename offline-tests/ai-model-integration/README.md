# Local AI model and points Playwright tests

These checks load the real Web editor and dashboard points components in Chromium.
They send real requests to an isolated WordPress Plugin instance. Only the Gemini
provider response is synthetic; a synthetic account and fresh data are used.
Do not use production or staging, a real cookie, or a real provider key.
This is not the full multi-browser Premium suite or the deployed /read gateway.

## Fixture contract

- Set up disposable WordPress with the candidate Plugin, dependency-only Composer
  vendor and a fresh utf8mb4 MariaDB database on a private Unix socket. Use the Plugin's
  schema for the user, points, points history and both AI request tables; seed one
  synthetic account with 100,000 PP. Initialize the per-user SQLite cache schemas
  and use the real WordPress route and event-bus bindings.
- Bind PHP only to `127.0.0.1`. Provide a synthetic login cookie JSON file with
  `pwappy_login`, `pwappy_auth`, and `pwappy_ident`; the auth value must carry a JWT
  signed solely for this disposable instance. Do not save the file in Git.
- Run the candidate Go workers with a fail-closed local transport that maps Gemini
  to a loopback SSE server and allows only the two local WordPress callback routes.
  The provider should return 10,000 prompt, 2,000 visible, and 1,000 thinking
  tokens, and reject Temperature for Neon and Argon. The first Agent plan should
  include the thought `ローカル検証用のホーム画面を作ります。` in its visible JSON;
  Coding returns a JS function named `pwappyFixtureResult`. A hidden thought may
  contain the marker `FIXTURE_THOUGHT_SHOULD_NOT_APPEAR`.
- The fixture exchange rate is 200 JPY/USD. Expected ledger debits are 233 PP
  (Coding Neon) and 310 PP (Agent Argon). The tests inspect request payload,
  rendered output, the actual balance, and displayed point history. They use
  the fixture REST read handlers, not the separate deployed read gateway.
- Start from a clean database for the run. Use no CI, production app database,
  live credentials, real provider request, or pre-existing browser session.

## Run from pwappy-web-tests

```sh
export PWAPPY_WEB_CHECKOUT=/path/to/pwappy-web
export PWAPPY_LOCAL_WEB_DIST="$(mktemp -d)"
export PWAPPY_LOCAL_PLUGIN_URL=http://127.0.0.1:18779
export PWAPPY_LOCAL_COOKIE_FILE=/path/to/throwaway-fixture-cookie.json
node offline-tests/ai-model-integration/build.cjs
node node_modules/@playwright/test/cli.js test --config offline-tests/ai-model-integration/playwright.config.ts
```

Set `PWAPPY_WEB_NODE_MODULES` if the candidate Web checkout reuses an installed
dependency tree. The browser test aborts requests outside its explicit loopback
allowlist, with Service Workers blocked. Stop the fixture and clean its temporary
DB and keys after the run.
