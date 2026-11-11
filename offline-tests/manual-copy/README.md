# Manual prompt clipboard regression (isolated Linux browser test)

This explicit tool builds the **actual checked-out AgentChatWindow component** without the application's webpack configuration or `.env`. It uses synthetic controller state, suppresses points/account fetching, and retains the component's render, lifecycle, and clipboard handlers. It does not test the live AI/controller flow, staging accounts, or WebMCP.

## Run

Requirements: Node 24, already-installed repository dependencies, reviewed Playwright Chromium/Firefox/WebKit binaries, `Xvfb`/`xvfb-run`, `xauth`, and `dbus-run-session` on Linux. No dependencies are installed or downloaded by these commands.

From the `pwappy-web-tests` checkout:

```sh
node offline-tests/manual-copy/run-isolated.cjs /absolute/path/to/pwappy-web
node --test offline-tests/manual-copy/permission-scope.check.cjs tests/tools/discovery-boundaries.check.cjs
```

The permission and direct-run contract checks also run in the existing `node --test offline-tests/*.test.mjs` CI step through `manual-copy-permission.test.mjs`; that step never launches the browser harness.

An adjacent `../pwappy-web` source checkout is the default when no source argument is supplied. Set `PLAYWRIGHT_BROWSERS_PATH` only to an existing, reviewed browser installation if the usual `~/.cache/ms-playwright` is not used. The launcher reports its temporary directory containing the bundle and `results.json`; no live source/build directory is overwritten. Run only the launcher, never the internal `run.cjs`.

## Safety boundary

- The launcher creates a private Xvfb display and Xauthority file, HOME, runtime directory, and DBus session. It does not inherit the user's display, Wayland socket, session bus, account state, or credential environment variables.
- Browsers use fresh disposable contexts. Browser requests are restricted to the exact local fixture origin's HTML and component bundle. All other requests are aborted. No live APIs, external AI, saved login, application dev/deploy script, CI dispatch, or production changes are involved.
- Writes contain only a synthetic marker plus a synthetic JSON schema. Clipboard contents are observed through native Ctrl+V **only after that probe's own successful write**. The user's host clipboard is never read or overwritten.
- Only Chromium receives `clipboard-write`, scoped to the temporary local fixture origin and its disposable context. There is no `clipboard-read` grant, persistent browser permission, or OS permission change.
- The internal runner refuses normal direct execution without the launcher's private session configuration. This is an accidental-use guard, not a security boundary against deliberately forged environment variables.
- Files are outside default Playwright discovery and no package/default test command invokes this harness.

## Assertions and interpretation

Six engine/display combinations run: Chromium, Firefox, and WebKit, each headless and headed. Diagnostic clicks use native mouse input at the visible copy button’s bounding-box center, avoiding Playwright locator stability waits on a background tab; they never call a synthetic JavaScript click. The live Premium test retains its original locator click. Each compares a native foreground click, a second-tab foreground attempt, and explicit `bringToFront`. Chromium additionally repeats all three with a write-only permission. That is **24 probes**, with **at least 21 mandatory native-write + exact-native-paste successes**.

The three unpermissioned headless Chromium probes are diagnostics: either exact success or an actual `NotAllowedError` is accepted, because browser versions can change the default policy. All other probes require actual write success, the product's success label, and full prompt/schema equality after native paste. Missing browsers, a failed mandatory probe, or a page error fails the run. No clipboard call is replaced with fake success.

On the tested Linux Playwright engines (Chromium 148.0.7778.96, Firefox 150.0.2, WebKit 26.4), unpermissioned headless Chromium rejected writes despite `document.hasFocus()` and transient user activation both being true. `bringToFront` did not fix it; origin-scoped write permission did. Other engine/display combinations succeeded without a grant. In this environment the other-tab foreground attempt still reported focus=true, so these results do not demonstrate a real background-focus failure or establish behavior on macOS/mobile devices.

The corresponding live Premium test change is deliberately smaller: it adds only a Chromium/editor-origin write grant to that one disposable test context and retains the strict existing copy-success assertion. This harness's clipboard-content verification remains isolated from live account data.
