# Native external WebMCP verification

Run from the separate `pwappy-web-tests` project:

```sh
npx playwright test -c playwright.webmcp.config.ts external-cdp-client.spec.ts --headed
```

## What this proves

The tests start fresh, temporary Chrome profiles and start a **separate Node process** as a small MCP stdio server. The test is the MCP client and exchanges JSON-RPC `initialize`, `tools/list`, and `tools/call` messages over that process's stdin/stdout. The bridge attaches to the isolated browser via CDP, discovers registrations using `WebMCP.enable` / `WebMCP.toolsAdded`, invokes them with **`WebMCP.invokeTool`**, and receives `WebMCP.toolResponded` results. It does not evaluate page JavaScript or use `document.modelContext.executeTool` / `navigator.modelContextTesting.executeTool`.

Verified with locally installed Google Chrome **157.0.8103.50**, using the experimental web platform features flag. Actual protocol schema is available from this test browser's `/json/protocol`; Chrome 157 includes `WebMCP.invokeTool` even though Playwright 1.60's bundled protocol typings do not yet include that command.

- Editor: native discovery of 72 tools; external calls read editor context and application JSON.
- Dashboard: native discovery of 14 tools; external call reads fixture applications and versions.
- Authoring mutations are denied by an explicit read-only tool allowlist. The PHP asset-content case allows the existing read-only file-download POST, which creates only a temporary ZIP in the fixture directory; application files are hash-checked unchanged.
- Navigating away from the exact fixture page makes bridge calls fail closed. Current URL is checked through `Page.getFrameTree`, not a potentially stale client-side cached URL.

Evidence JSON files are attached to the Playwright results. In-app browser inventory was empty during verification, so this is **not** a claim that a particular end-user AI application has been connected or configured. It proves native browser protocol interoperability and a real separate-process MCP transport path. No production backend persistence is tested.

## Deliberate restrictions

This is a local test harness, not a production bridge. Use only against the test's Playwright-owned browser profile and synthetic fixtures. Do not attach it to an authenticated personal browser. The CLI accepts only credential-free `http://127.0.0.1` endpoints and a single exact target URL. Only seven editor read tools and one dashboard read tool are exposed. No persistent MCP settings, credentials, browser extensions, profile settings, or permissions are changed. The tests close the bridge process and browser afterward. Debugging port 19230 is used only during the test, so do not run concurrent copies.

To integrate a real AI product later, use a supported native WebMCP client or separately review an explicitly authorized local MCP bridge setup. Do not advertise ordinary remote MCP/HTTP service availability: WebMCP registrations live inside the browser page, and these tests use Chrome's experimental CDP API.

## Isolated real-PHP read integration

The dashboard PHP external-client test also exercises the installed, unchanged `readapi.php` via `isolated-readapi.cjs`. A temporary loopback PHP server uses synthetic SQLite records/assets and disposable signing keys. An external `pwappy_list_apps` call triggers a fresh PHP `publish-list` GET and returns `Isolated backend fixture` / `v1` / `draft`; the actual list response is forwarded unchanged. Source hash remains unchanged and no API write is attempted.

`dashboard-init` is **not** a verified real endpoint in this test: its envelope, notifications, usage, and same-day daily-report timestamps are synthetic. Initial app/version records come from PHP `publish-list`. The synthetic same-day timestamps avoid the dashboard's unrelated automatic daily-report/billing POST. Real WordPress initialization, real accounts, persistence writes, publication, billing, and production services remain outside this test.

## Isolated installed PHP read API

`isolated-readapi.cjs` starts a disposable loopback PHP HTTP server loading the installed `readapi.php` unchanged. It creates a unique temporary directory, synthetic SQLite rows and compressed editor/asset files. Fresh RSA keys and a test JWT are generated in memory. Only the public key is written to the temporary router; no token/private key is written to reports. The child environment is allowlisted, `PWAPPY_ENV_DIR` points to an empty directory, and WordPress fallback is disabled. No original test bootstrap, production `.env`, account, cookie/profile, database, service configuration or persistent authentication is used. GET/OPTIONS are allowed only for listed fixture routes; mutation methods are rejected. The separate file-download POST is allowed only for the exact synthetic app/version/file, authenticates against a disposable public key, and invokes the existing production FileDownloadUseCase. The server and only its own temporary files are removed afterward. SQLite may create WAL/lock files inside that disposable directory.

```sh
npx playwright test -c playwright.webmcp.config.ts real-readapi.spec.ts external-cdp-client.spec.ts --headed
```

The direct HTTP test verifies real PHP JWT rejection, app/version list, asset listing, compressed editor JSON, authenticated asset bytes and unauthenticated 404. The external-client test forwards dashboard read requests to the same actual PHP implementation and requires a fresh `publish-list` HTTP read after `pwappy_list_apps`. The dashboard initialization envelope remains synthetic because that combined endpoint requires WordPress; its app list comes from the real PHP response. Source SHA-256 before/after is included in evidence.

This is real backend **source integration with isolated data**, not an authenticated existing-service/production test. An unauthenticated host-side GET to the actual local service returned HTTP 401 (`app_token_error`) from `/read/v1/publish-list`; `/rest/v1/publish-list` returned HTTP 500 with a code-401 authentication-error body. The service is reachable. The earlier connection-refused result was specific to the restricted command environment, not evidence that the host service was down. We did not start/change the service or retrieve existing credentials. Existing-account writes, WordPress fallback, PP accounting, authentication refresh and live persistence are unverified.

## External editor, saved data and asset bytes

`external-cdp-client.spec.ts` also starts the editor using the real PHP `editor-json` response. The response is forwarded unchanged, then the real editor decompresses it into stores. External MCP calls (no page JavaScript invocation) retrieve:

- `pwappy_get_application_json`: the saved native page/node tree and the `phpFixtureValue` script containing `from-real-php-file`.
- `pwappy_export_project`: settings (`lang=ja`, `app_exp=Saved by isolated PHP fixture`), script store, and the saved `php-scenario` test. This is current editor state loaded from PHP, not a fresh server GET on every export.
- `pwappy_list_asset_files`: a new actual PHP file-list GET returns `test.txt` (25 bytes) and the `images` directory.
- `pwappy_read_asset_file`: a fresh file-list GET and the existing download POST return a ZIP generated by unchanged production `FileDownloadUseCase::execute` and native PHP `ZipArchive`. The frontend validates the archive, CRC and target, returning exact text/base64 for `isolated readapi fixture\n`.

The download helper is explicitly a **boundary adapter**, not a complete WordPress endpoint: request/current-user/container, disposable JWT gate, and HTTP streaming are supplied by `isolated-file-download.php`. It calls the existing production use case/trait/response classes unchanged. WordPress routing, production authentication middleware and real-account permissions are not exercised. The exact synthetic file only is allowed; unauthorized and traversal requests are rejected. Its temporary ZIP is removed after streaming, and source files plus all fixture editor/asset files are hash-checked unchanged.

This replaces the previous limitation that assets/editor data were tested only by direct HTTP. It does not turn synthetic fixture data into existing user data or establish a particular AI product's persistent integration. Evidence: `external-php-editor-evidence.json` includes the retrieved application/export/list/content, real HTTP read records, download body/status, hashes and the adapted boundaries; no credentials.
