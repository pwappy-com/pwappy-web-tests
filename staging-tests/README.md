# Native WebMCP staging persistence verification

Run only through `npm run test:webmcp:staging`, in the branch workflow before the
normal Ubuntu Chromium suite. This early gate catches startup/persistence
regressions before the long suite. The serial matrix stops remaining combinations
on failure; a stopped or incomplete run never qualifies for merge. This supplement is outside the default `tests/` directory. It is not selected by
ordinary `npm test`, normal/Premium selectors or the isolated WebMCP runner.
`playwright test --config=playwright.staging-native.config.ts --list` is safe,
credential-free discovery, not a live execution.

## Preconditions and safety boundaries

- The existing branch verification guard checks the exact push event, test branch,
  marked commit, checked-in source SHA, fixed staging origin and deployment marker
  before the wrapper spawns Playwright, and again before authentication and cleanup.
- Only `normal` / `ubuntu-latest` / `chromium` is accepted. Identity `pwuc000`,
  account index `0` and the normal suite's PP preparation receipt are reused.
  No local `.env` is loaded. Only the existing CI test-login secret is used.
- Chrome is a fresh, Playwright-owned temporary profile with temporary native
  WebMCP flags and a loopback debugging port. A random launch capability and
  exact synthetic editor URL are rechecked by the external client. The user's
  normal browser/profile is never used.
- Before the normal live suite starts, `node scripts/preflight-native-chrome.cjs`
  probes `WebMCP.enable` in an empty temporary Chrome/about:blank, with all page
  network requests blocked and no authentication. It prints only fixed status
  text and a validated Chrome version. The guarded supplement repeats the
  preauthentication check independently.
- Before authentication, CDP `WebMCP.enable` must exist. The editor must expose
  exactly the pinned 72 native tools. Missing Chrome/native WebMCP fails the
  supplement; there is no mock, internal adapter or fallback.
- One random app key, `wmcpstage-` plus 20 hex digits, is created through the
  existing dashboard UI helper. The existing default `1.0.0` version is used.
  Every external tool call passes through a fixed-payload allowlist. Browser
  writes are limited to this app's create/save/upload/read/delete and the
  ordinary dedicated-test-account daily report. No publication, moderation,
  AI credentials, AI generation, archive/restore or real-point purchase occurs.
- Cleanup deletes only this newly created app through the existing UI helper,
  including an uncertain result of its single create attempt. Mutations are
  never automatically replayed. If this early smoke fails before the normal
  suite starts, its own finally block handles only its new app. The workflow's
  wider stable-account cleanup runs only when the normal suite actually started.

## What this verifies

1. Separate Node MCP stdio process -> native Chrome CDP `WebMCP.enable` /
   `WebMCP.invokeTool` -> real staged application and PHP backend.
2. Native layout attribute, script, global CSS and app settings edits.
3. New synthetic JSON asset upload, real listing and ZIP-decoded exact-byte read.
4. Native save with `serverVerified: true` and clean save status.
5. Reload into an empty second browser context, transferring only the test
   authentication cookies. Verify persisted layout/templates, scripts, CSS,
   description, listing and exact asset bytes, with no prior IndexedDB,
   localStorage, service workers or editor memory.
6. Single-app cleanup and a fresh dashboard absence check.

There are no mocked API responses. Playwright drives setup/navigation/cleanup;
all feature authoring, save and asset assertions use the external native bridge.
The UI helper may evaluate DOM for its existing setup behavior. That is not the
native transport and is not presented as such.

The wrapper suppresses all child stdout/stderr. Trace, screenshots, video and
attachments are disabled. It prints only validated numeric counts, a fixed
phase label and strictly allowlisted startup diagnostic metadata. Normal and
Premium suites emit numeric progress every 30 seconds, bounded to two hours;
raw child output is still ignored and final completeness is separately checked. Raw application JSON, asset bytes, cookies and backend errors stay
out of public logs and artifacts.

## Offline validation and limits

`node --test offline-tests/staging-native.test.mjs` validates URL and payload
allowlists, preauthentication failure, account binding and output redaction.
`npm run test:discovery` proves default isolation and dedicated discovery without
network access. These checks do not authenticate or establish live success.

This is an essential real-persistence smoke, not all 72 tools, native workbench
CRUD, every OS/browser, mobile-device testing, generated PWA validation, or a
proof of production behavior. A successful live workflow result is still
required before reporting staging persistence as verified.
