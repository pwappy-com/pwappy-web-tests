# Isolated WebMCP browser verification

Run from the separate `pwappy-web-tests` project. This workflow does not run the existing live-service E2E scenarios.

## Run

Preferred: the safe runner builds the adjacent source checkout with synthetic
loopback endpoints, without reading `.env` or saved authentication:

```sh
npm run test:webmcp:checks
npm run test:webmcp:list
npm run test:webmcp -- --headed
```

For a non-adjacent checkout, add `--app-root /absolute/path/to/pwappy-web`.
See `tests/tools/webmcp/SAFE-RUNNER.md` for prerequisites, unique evidence folders,
source digests and the manual-only self-hosted CI definition. The existing
normal/premium CI and intentional all-app cleanup remain unchanged.

The previous explicit build workflow is retained below for reproducibility of
older reports. It uses the source project's development build configuration:

```sh
cd ../pwappy-web
npm run build:dev -- --output-path /tmp/pwappy-webmcp-build
cd ../pwappy-web-tests
./node_modules/.bin/playwright test --config playwright.webmcp.config.ts --headed
```

The config starts a static Python server on `127.0.0.1:8093` and refuses to reuse an existing server. It does not run the application's `dev` deployment script, replace a deployed web directory, or start CI. Headed runs require a graphical display, installed Playwright Chromium and Google Chrome. Do not rebuild while browser tests are running because that replaces referenced assets.

## Isolation and limits

- Fresh browser contexts, no `.env` loading, no `.auth` state, a fake local cookie, service workers blocked.
- Synthetic gzip/base64 editor data. All backend writes/readbacks remain intercepted in Playwright memory. Upload/delete/create/clone payloads are inspected but never sent to a live service. The added PHP read cases execute installed readapi.php with disposable SQLite/files and generated test authentication, never an existing account.
- Only local compiled assets and known public OnsenUI/Holder/FontAwesome GET dependencies can reach the network. Initial unversioned OnsenUI requests are served from version 2.12.8.
- No real apps, versions, PP charges, authentication, publication, existing user profiles or persistent browser flags are involved.
- The 12 baseline cases use a registration adapter. The editor, stores, commands, rendered iframe, test runner, UI device buttons and IndexedDB are real.
- The additional native cases use actual browser APIs without a registration adapter. Four external-client cases also use a separate MCP stdio process and native CDP WebMCP, including actual PHP dashboard/editor/asset reads. This does not configure a particular end-user AI application or validate live persistence.
- Deliberate application/test failures are expected in negative cases. They must be reported correctly for assertions to pass.

## Expanded reliability coverage: 50 additional cases

- `success-response.spec.ts` and `success-zip.spec.ts`: 42 cases harden the shared
  normal/premium helpers. Matching save targets, HTTP/application success, visible
  denial, silent readback failure, explicit coupon duplicate reasons, icon output
  counts, completed archive bytes, required original/minified HTML and CRC are
  checked. These use synthetic UI/API/download fixtures. They do not execute real
  coupon transactions, charge PP or verify actual generated icon dimensions.
- `persistence-recovery.spec.ts`: 6 cases edit all eight persisted stores through
  the real native editor, save captured compressed bytes, close the original
  document and load an empty browser context. Every durable field is compared.
  Rendering reload flags and test execution status are explicitly checked as reset
  runtime state, not silently omitted data. Further cases cover network disconnect,
  expired authentication during PUT and readback (including actual MENU > Save),
  server-applied writes with lost responses, and two-context readback conflicts.
  The transport is intercepted synthetic persistence, not a real PHP write test.
- `offline-mobile-runtime.spec.ts`: 2 headed browser cases exercise an app authored
  by native WebMCP: touch navigation/input in Android/iOS preview styles and both
  orientations, real browser offline networking and reconnect. Its error handling
  is fixture-authored. This is not an installed PWA, physical/mobile browser engine,
  camera, OS-back, offline cold-start or generated-service-worker test.

The new persistence cases reproduced and led to narrow source fixes for auth
expiry discarding the editor document and runtime flag resets falsely marking a
fresh saved document dirty. Authentication still fails and expired cookies clear.
The dirty comparison excludes only two runtime fields; full save payload/readback
validation and concurrent-edit protection remain unchanged.

## Baseline coverage: 38 cases

`editor-webmcp.spec.ts` (12):

1. Tool registration, real editor state and disconnect cleanup.
2. Unsupported-browser fallback and visible editor DOM.
3. Target/revision guards and verified save round-trip.
4. Action/layout rendering, page focus, image reads and Android/iOS UI buttons.
5. Test/API mock CRUD, real iframe PASS and deliberate FAIL.
6. Rejected save preserves dirty state.
7. Concurrent edits during saving are preserved.
8. Mismatched readback never claims verification.
9. Local snapshot create/list/restore.
10. Image upload/delete confirmation and exact intercepted payloads.
11. Target switches during save do not apply old data to a new app.
12. Snapshot restoration rejects edits arriving during the real IndexedDB read.

`native-authoring-webmcp.spec.ts` (7, Chrome 157):

13. Component catalog/detail, app language/description/manifest and verified persistence.
14. Synthetic browser property and function mocks affect real preview tests.
15. Device OS/base dimensions/orientation/scale, readiness and actual screen/iframe/outer geometry.
16. Editor JSON export/import guards, pre-import IndexedDB checkpoint, incompatible history clearing, and checkpoint recovery. Server asset bytes are excluded.
17. Native tool attribute edit, undo and redo.
18. Directory creation and JSON/SVG uploads with exact intercepted payloads.
19. Cancellation while current JavaScript is held on a synthetic promise: execution remains active until released, then later scenarios are skipped.

Native dashboard/editor cases (3):

20. Chrome 157 dashboard: all nine tools, app/version/clone/update/rename payloads/readback and review status, cost/origin/confirmation guards, saved-preview URL without navigation/publication, UI refresh and cleanup.
21. Chrome 157 editor: full native inventory, execution, preview test, save and cleanup.
22. Chromium 148 editor: full native inventory, execution, preview test, save and stale-handle protection.

Additional native workflow cases (10):

23–25. Selection with visible properties; individual trash restoration with original position/event bindings; custom toolbox CRUD and advanced settings; real Monaco keyboard edits, apply/discard, stale drafts and duplicate-name preflight.
26–27. Asset metadata, ZIP download, rename/move/copy, exact CSV/PDF/MP4/WebM uploads and guards.
28–30. Stored/deflated ZIP decoding, CRC validation, edited JSON plus asset export/import, collision preflight and truthful partial-upload failures.
31. Preview inspect/interact redaction and safety guards, synthetic local DOM effects, PNG signature/dimensions and side-by-side DOM-render versus actual browser screenshots. DOM-render is not a browser-pixel capture.

32. Script deletion through the actual UI followed by native trash listing and confirmed code restoration, without inventing lost event bindings.

33–34. Separate MCP stdio client discovers and reads native editor (72) and dashboard (9) tools via Chrome CDP WebMCP, with write denial and navigation guard.
35. External MCP → native WebMCP → actual unmodified PHP readapi → isolated SQLite application/version read. Only the dashboard-init envelope is synthetic.
36. Direct HTTP against the same isolated PHP implementation: valid/invalid authentication, app/asset lists, compressed editor JSON, authenticated asset bytes and isolation-router write rejection. This case has no browser page; the other 37 are headed browser cases.

37. External MCP editor reads the native structure, script source, settings and test definitions loaded from actual PHP compressed files; fresh asset listing and exact bytes through production PHP ZIP download logic. Source/fixture hashes remain unchanged. WordPress request/auth/streaming boundary is an isolated adapter, not a live-account test.

38. Full external-client authoring lifecycle with native dashboard/editor registrations, creation/version creation, URL validation and client navigation/reconnection, native blank-root navigator/page construction under the undismissed starter chooser, script edit, verified save, archive/restore and disposable version/app removal. API mutations are intercepted in memory. See `tests/tools/webmcp/LIFECYCLE.md`.

## Native API compatibility

Both native editor tests compare the complete declared tool inventory with the browser inventory and require zero registration warnings.

- Bundled Chromium 148: `navigator.modelContext` plus `navigator.modelContextTesting.listTools/executeTool`.
- Installed Chrome 157: `document.modelContext.getTools/executeTool`.

Native cases use `--enable-experimental-web-platform-features` only in temporary browser launches. Both installed browsers expose no WebMCP API with their default flags. Existing browser settings are unchanged.

### Chromium 148 cleanup limitation

An app-free reproduction shows Chromium 148 loses native registration cleanup after garbage collection: the AbortSignal becomes aborted but the browser inventory retains the tool. Chrome 157 removes the same registration correctly.

```sh
node tests/specs/webmcp/native-gc-probe.cjs
```

The Chromium 148 integration case explicitly records retained inventory and requires stale native read and mutation calls to reject. It does **not** claim inventory removal in that browser. Reload the page to clear stale inventory. Chrome 157 must remove all registrations.

## Evidence

- HTML report: `playwright-report/webmcp-isolated/index.html`
- Logs, screenshots, JSON and retained failure traces: `test-results/webmcp-isolated/`
- Native metadata: `native-evidence.json`, `native-lifecycle.json` (148), `native-dashboard-evidence.json`
- Screenshots: `editor-action.png`, `editor-layout.png`, `native-android-landscape.png`, `native-chrome-webmcp-action.png`, `native-dashboard.png` within each case's output directory.

Reports and screenshots are ignored by Git. Direct Playwright runs refresh their output directory; the safe runner creates a unique evidence directory instead. Run sequentially: the fixed local/CDP ports must not be shared. To preserve a direct run, use `--output /tmp/pwappy-verification-name --reporter list`. No commit, push or deployment is performed by this workflow.

## Previous verified baseline

2026-11-10: **22/22 passed (1.6 minutes)**, headed Chromium 148.0.7778.96 and Chrome 157.0.8103.50, against these frozen bundles:

- Editor: `app_editor.6c41afd08806306ab68a.bundle.js`
- Dashboard: `dashboard.8f2eccf5cc70b1ea22fa.bundle.js`

Both native editor inventories matched all **52 declared tools**, with zero registration warnings. The native Chrome 157 dashboard matched all **6 tools**, including the saved-preview URL. This inventory check is distinct from claiming every tool was exhaustively exercised.

The final run includes incompatible undo/redo history clearing after import, recovery through the pre-import snapshot, cooperative cancellation during active code, and actual Android landscape geometry: 800×400 screen/iframe inside an 824×424 outer frame at 75% scale (portrait-base dimensions 400×800). Screenshots were visually checked. Backend requests remained isolated throughout.

The Chromium 148 cleanup limitation above is still explicitly recorded and reproduced independently; stale read/mutation calls reject. Chrome 157 cleanup passes. No live backend, full existing E2E suite, or external AI-client setup is claimed verified.

## Previous 32-case verified result

2026-11-10: **32/32 passed (2.5 minutes)** in a full headed run against:

- Editor: `app_editor.b3afac4fb9aff991ede8.bundle.js`
- Dashboard: `dashboard.1cf9e5f38bdb33615452.bundle.js`

Both Chromium 148.0.7778.96 and Chrome 157.0.8103.50 native editor inventories matched all **72 declared tools** with zero registration warnings. Chrome 157 dashboard matched all **9 tools**, with zero registration warnings. Inventory completeness is not a claim that every parameter combination was tested.

All archive, preview, draft, script-trash and earlier regressions passed. The returned preview PNG and actual browser screenshot were visually compared: both now show selected option “Two,” changed input and click-result text. Capture left live option properties/attributes unchanged. The PNG remains a DOM rendering, not an actual browser screenshot.

Final log: `test-results/webmcp-isolated/final-run.log`.
Final visual pair: `test-results/webmcp-isolated/native-preview-webmcp-nati-09c18-ct-actual-isolated-viewport/native-preview-dom-render.png` and `native-preview-real-browser.png`.
Script and element UI screenshots are under the `native-workflow-webmcp-*` case directories; Android landscape under `native-authoring-webmcp-na-2760e-tation-and-awaits-readiness/`.

The Chromium 148 garbage-collection cleanup limitation remains documented above; stale native calls reject. Chrome 157 cleanup passes. All backend operations were synthetic, no live backend or external AI-client configuration was verified, and no source project files, commit, deployment or persistent browser setting were changed by these tests.


## Previous external-client and backend-read result

2026-11-10: **36/36 passed (2.6 minutes)**, using the same editor/dashboard bundles above. This comprises 35 headed browser cases and one direct-HTTP backend case. The final source Jest run also passed **382/382 (19 suites)**. Source runtime code was unchanged during this verification extension.

The separate external MCP client discovers all 72 editor and 9 dashboard tools through Chrome 157 native CDP and exercises allowed read tools without page-JavaScript invocation. Its real-PHP case follows the complete stdio → native WebMCP → dashboard → HTTP readapi → disposable SQLite path. The real PHP file remains unchanged (SHA-256 `a601b808b9448dd3090ccad86228a8b8f4884869e74b2b266fbb0679b96c298a`). No existing auth/profile, application database or live write was used. See `tests/tools/webmcp/README.md` for the synthetic initialization envelope and other limits.

- External evidence: `external-cdp-client-*/external-client-evidence.json`, `external-dashboard-evidence.json`, `external-php-readapi-evidence.json` within `test-results/webmcp-isolated/`.
- Full logs: `test-results/webmcp-isolated/final-run.log` and `final-jest.log`.
- Actual host-service unauthenticated probe: `test-results/webmcp-isolated/live-unauthenticated-probe.json`. The service is reachable; read-route returns 401, REST-route returns HTTP 500 with authentication-error code 401. Existing authenticated accounts and persistence remain unverified.

A first restricted-command launch could not create Chrome's socket. The authorized host-side run above started both browsers and passed all cases; no persistent browser/security configuration was changed. Specific end-user AI product setup, write-authorizations in that product, production/live persistence and physical devices remain unverified.


## Previous 38-case lifecycle verification

2026-11-10: **38/38 passed (2.8 minutes)** on final test code, with **410/410 Jest tests (19 suites)** and a successful development webpack build. This comprises 37 headed browser cases plus one direct PHP HTTP case. Native inventories are 72 editor tools and 14 dashboard tools, with zero registration warnings in the inventory checks.

- Editor bundle: `app_editor.b3afac4fb9aff991ede8.bundle.js`
- Dashboard bundle: `dashboard.ee849e78233b992ec507.bundle.js`
- Logs: `test-results/webmcp-isolated/final-run.log`, `final-jest.log`, `final-build.log`.
- Lifecycle evidence/screenshots: `test-results/webmcp-isolated/external-authoring-lifecyc-*/external-lifecycle-evidence.json`, `external-lifecycle-empty-chooser.png`, `external-lifecycle-saved-editor.png`, `external-lifecycle-deleted-dashboard.png`.
- External actual PHP editor/assets: `external-cdp-client-*/external-php-editor-evidence.json`.

The final lifecycle starts from only an app root. It constructs navigator/page/reference/attribute/script via external native MCP, validates one root/page/navigator with zero errors, verifies saved gzip by PUT/GET, returns through client navigation and reconnects, archives/restores, then deletes only its synthetic version/app. The starter chooser remains visible but does not block those native operations; it was never dismissed. Seven application-changing HTTP requests are intercepted in memory. The two stale clients fail closed after navigation.

The actual PHP read tests and the synthetic-write lifecycle are distinct. Particular AI-product configuration, existing-account login/permissions, live server writes, real new-app initialization files and production deployment remain unverified/not performed. Navigation is a client action; no native WebMCP navigation tool was invented. Permanent-delete flags do not replace user confirmation. See `tests/tools/webmcp/LIFECYCLE.md` and the source workbench documentation for cost and irreversible-delete constraints.

## Latest expanded verification

**88/88 passed (4.7 minutes)** using the safe runner on the final source working
tree: 76 headed browser cases, one direct PHP HTTP case and 11 pure archive
checks. The source Jest suite passed **438/438 across 20 suites**; safe-runner
guards passed **3/3**. No tests were skipped in this isolated run.

- HTML: `playwright-report/pwappy-webmcp-run-rCGBs8/index.html`
- Evidence: `test-results/pwappy-webmcp-run-rCGBs8/`
- Logs: `run.log`, `jest.log`, `runner-checks.log`; source/build evidence: `build-manifest.json`.
- Source digest: `0b3d51cc0a04df0024d77568167326f57a54433cb876a7a0a4aa153cdf2b2c07`.
- Bundles: `app_editor.639a501426e8f3f4a86b.bundle.js`, `dashboard.570482350de6d4b147ac.bundle.js`.

This final run confirms auth-expiry draft retention for both save and readback,
all eight durable stores in a fresh context, accurate clean/dirty status after
runtime resets, uncertain-save handling and concurrent readback rejection.
Earlier failing traces are retained separately; the tests were not weakened to
accept the two reproduced application bugs.

The normal/premium live-service suites were **not** run. Their shared assertions
were hardened and exercised with synthetic fixtures instead. Real PP
balance/history/deduction, actual icon output dimensions, live authenticated
persistence and physical/installed-PWA behavior remain unverified. The new
self-hosted CI definition was parsed and its local command was run, but no runner
was provisioned and no GitHub Actions execution, commit, push or deployment was
performed. The existing CI workflow and intentional all-app cleanup are unchanged.
