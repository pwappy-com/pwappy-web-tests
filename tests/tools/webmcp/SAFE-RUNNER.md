# Safe, reproducible isolated WebMCP runs

The existing `e2e-tests.yml` intentionally invokes the all-app cleanup script for
its generated test accounts. That workflow and cleanup script are unchanged.
Do not confuse that intended cleanup with the separate isolated workflow here.
This document does not authorize a live account, publication, PP charges, or deletion.

## Local commands

From `pwappy-web-tests`:

```sh
npm run test:webmcp:checks
npm run test:webmcp:list
npm run test:webmcp -- --headed
# If pwappy-web is not the adjacent checkout:
npm run test:webmcp -- --headed --app-root /absolute/path/to/pwappy-web
```

`--grep TEXT` can select focused isolated cases. Other Playwright flags,
configurations, test paths and project selectors are deliberately rejected.
The list command does not build, load `.env`, use saved `.auth`, or run setup/tests.

Each full run builds the selected working tree into a **new** temporary directory,
with actual source webpack rules and a synthetic loopback-only endpoint map.
The dotenv loader is substituted only while reading webpack configuration, so
developer `.env` files and production credentials are not loaded into the bundle.
The development deployment/copy script is never invoked. Source files are not
modified. A source digest and bundle inventory accompany the report.

Child processes receive an explicit environment allowlist, not inherited login
or API key settings. Tests use empty browser profiles and disposable PHP data.
Port 8093 is not reused from another server, and an exclusive temporary lock
prevents two safe-runner invocations from sharing the fixed CDP ports. An existing
lock causes failure. Do not delete it until its recorded process is confirmed stopped.

Results use unique `test-results/pwappy-webmcp-run-*` and
`playwright-report/pwappy-webmcp-run-*` folders. Builds are retained at the printed
temporary path, so previous evidence is not overwritten. All reports contain
synthetic data only. They are ignored by Git.

## Prerequisites and boundaries

- Linux, Node 20+, Python 3, installed test dependencies and installed source build dependencies.
- Playwright's Chromium and a Google Chrome version exposing the native experimental WebMCP APIs.
- PHP with SQLite/PDO, OpenSSL and ZipArchive, plus the reviewed plugin source and its vendor dependencies.
- Headed mode also requires an existing graphical display. Headless is the default.
- The plugin defaults to `/var/www/html/wordpress/wp-content/plugins/pwappy-plugin`.
  A different reviewed source may be selected using `PWAPPY_WEBMCP_PLUGIN_DIR`.
- Public OnsenUI/Holder/FontAwesome GET dependencies are still used by some cases.
- PHP source reads run against generated SQLite/files and ephemeral authentication,
  not the existing WordPress bootstrap or accounts. Writes remain synthetic fixtures.
- Mobile preview dimensions, browser touch and offline networking do not establish
  physical device, camera, OS-back or installed-PWA service-worker behavior.

## CI definition, not a claim of CI execution

`webmcp-isolated.yml` is **manual dispatch only** and requires a deliberately
provisioned self-hosted Linux runner with label `pwappy-webmcp`. It has no push,
pull-request or scheduled trigger, no user-secret inputs, and read-only repository
permissions. It installs only the test repository's locked dependencies without
lifecycle scripts, then uses the reviewed app/plugin checkouts provided at dispatch.
The source dependencies, browsers, PHP and display/headless capability must be
provisioned separately. The source path is required rather than silently fetching
or deploying another repository.

Adding this file does not provision a runner, register its label, push a branch,
or start a GitHub Actions job. Those actions have not been performed by this work.
The existing normal/premium CI and cleanup are left intact.

## Discovery boundary regression check

The default `playwright.config.ts` excludes `tests/specs/webmcp/**`, because those
cases require the isolated build/server and empty authentication provided by the
dedicated configuration. `npm test` otherwise keeps its previous normal/premium
and cleanup discovery. The cleanup is not removed or disabled.

`npm run test:discovery` copies only reviewed test/configuration files into a new
temporary directory and uses the installed dependencies. It never copies the
repository's `.env` or `.auth`. Every Playwright invocation has `--list`, uses a
credential-free environment, and blocks Node network connections/listeners.
It checks the default five-project inventory, the existing CI suite selectors,
explicit cleanup discovery, and the separate WebMCP inventory. Test bodies,
hooks, browser launches, application mutations and cleanup are not executed.
