# Real-editor style ownership regression candidate

Target frontend: `pwappy-web` commit `0355063f2a9172bd54f96b6368cc8a961d95560c`.
Test baseline: `98fd0c33f27cac1e6cdfa683d648748e4cad5a6c` (runtime `856e525`).

## Scope and counts

`tests/specs/normal/editor-style-ownership.spec.ts` adds **4 scenarios per
project**, hence **20 executions across the existing five normal projects**.
No existing tests, assertions or skips change. The normal `all` directory scope
automatically includes the new file. The additive manual
`test_scope=style-ownership-regression` selects this whole file (no grep, shard
or assertion filtering). Existing scope selections, defaults, Premium jobs and
cleanup remain unchanged. Offline selector contracts execute the extracted Bash
selector; an exact approved-selector normalization preserves the older immutable
whole-workflow baseline hash guard.
The fixture uses the existing dashboard/create/delete lifecycle and the existing
CI/local fixture budgets. No new sleeps or increased timeouts are introduced.
The new fixture's app-card click uses normal actionability checks (no force).
Existing shared create/delete/dashboard helpers remain unchanged; this is not a
claim that those older helpers contain no forced actions or sleeps.

Authentication mapping was audited at test commit `98fd0c3`: `getStorageStatePath`
and `ensureAuthenticated` both use `resolveAccountIndex`, whose priority is
`PWAPPY_TEST_ACCOUNT_INDEX`, then Playwright's stable `TEST_PARALLEL_INDEX`, then
the supplied fallback. Therefore the fixture's existing `workerIndex` argument
does not select a fresh account on worker restart. `gotoDashboard` obtains the
normalized browser-specific authenticated session and injects its cookies;
`workerIndex` remains useful in unique app IDs. No shared authentication changes
are introduced by this suite.

1. Pending A style survives an A→B selection boundary without contaminating B;
   a separate tab boundary and native selection/tab round-trip verify editor and
   preview agreement.
2. An attribute change committed after an older Monaco draft wins, and survives
   another element's edit and a native return to A.
3. Changing only `"ab"` to `"a b"` persists raw CSS. Actual application Undo
   restores the same owner ID and same stored style, invalidating its pending
   draft; subsequent selection round-trips preserve the restored result.
4. Native Monaco text input commits through the real store without resetting
   its cursor/focus or native editor Undo history.

## Native actions versus controlled integration probes

Native Playwright actions create/select elements, click tabs, fill attributes,
type into Monaco and invoke Monaco Undo. Setup CSS uses the existing real
`setMonacoValue` helper with strict success/readback assertions.

To ensure a boundary actually occurs **before** the application's 100 ms commit,
the labelled nonnative probes perform a real Monaco model edit and an actual UI
handler/event in the same browser turn:

- DOM-tree `node.click()` invokes selection, without assigning selected classes.
- `propertyContainer.tabChange('attributes')` invokes the real tab handler.
- A native-filled, focused width input is blurred in the same turn, causing
  the browser's native non-composed `change`; its value is never assigned by the probe. Monaco remains mounted behind the
  attribute tab. This is a deliberately controlled overlap, not a claim that a
  user simultaneously types into two visible controls.
- The actual Undo toolbar button's `click()` invokes application history.

These are **not** native actionability or end-to-end human-speed race claims.
No Redux dispatch/state write, history mutation, fabricated expected DOM,
mocked Monaco/store, clock replacement or timer wrapping is used in the E2E.

## Queue fence and why it is not the success oracle

Each controlled edit captures the actual `_styleDispatchTimer` handle before
the boundary. Read-only polling waits until that handle changes, **before
changing A's selection for attribute/Undo assertions**. Behavior is then checked
through raw preview CSS, computed CSS, attribute values, owner IDs and Monaco
model text. A missing timer fails explicitly.

This fence is intentionally implementation-coupled. Audited assignments:

- In frontend `69f76ad`, replacement clears the prior handle before scheduling;
  its callback sets the handle to null **after** the synchronous Redux dispatch.
- In `0355063`, replacement calls `clearPendingStyle`; that method calls
  `clearTimeout` before setting null. Its flush clears before synchronous
  dispatch. A polling evaluation runs in a later browser turn, after that
  synchronous work returns.

Any future code that discards a handle without canceling/completing its callback
invalidates this fence and requires review. A later B edit alone is **not** an
adequate fence: the old code might write A's draft into B, then B's new edit
could conceal that wrong write. The candidate does not rely on that approach.

History snapshots are captured synchronously. The 800 ms history setting
coalesces successive actions of the **same** type; it is not a delayed snapshot.
The test commits a style action then a text-attribute action, creating distinct
checkpoints without sleeping. Undo must return the text and preserve the ID and
quoted style. Undo separately schedules a real `to-element-and-select` followup;
an observer registered before Undo awaits that event for the restored owner ID
before selecting B, then removes its listener in `finally`. This prevents a
late Undo selection from racing the next native selection without adding a sleep.
Global history explicitly excludes Monaco's composed event path,
so the fourth scenario's keyboard Undo exercises the real Monaco undo stack.

## Verification status and limits

- Local TypeScript syntax transformation/JavaScript parsing: checked.
- Offline orchestration contracts cover the queue fence, a deliberately stale
  callback negative control, input distinctions and unchanged scenario count.
- A separate local differential diagnostic executed the actual `0355063` and
  `69f76ad` PropertyContainer classes using the existing deterministic fixture:
  after the fence, newer attribute style remained 281 px / restored style
  remained 137 px on the fix; both became the stale 999 px on the baseline.
  This establishes a useful negative control for the fence, **not browser proof**.
- Real browser/staging execution, native mobile Monaco compatibility and full
  real-store/history integration remain **unverified until the candidate runs**.
  See the later correction section for the local browser launch limitation.

Deploying the target frontend and running a focused hosted staging validation
must be coordinated after the existing comparison run; the candidate itself
does not deploy or dispatch anything. A focused pass is not a full-matrix pass.


## Focused run 40529892242: orchestration corrections

The initial candidate produced 12 passes and 8 failures across five projects.
All five failed the native multiline typing exact-text expectation; three
desktop projects also failed the attribute probe's subsequent B selection.

- The attribute probe incorrectly forged a composed input `change`.
  `StyleSizingEditor` emits its own composed custom change with width detail;
  the forged original also reached `AttributesContainer` without detail and
  raised `Cannot read properties of undefined (reading 'width')`. It also left
  the dirty input focused. Native blur now commits the original input once in
  the controlled overlap turn, before the independent native B selection.
  A separate genuine native edit-to-node-click focus/rerender issue is an
  unverified possibility, not a confirmed product defect: the observed failure
  also contained the forged-event exception. This correction does not establish
  whether that separate native sequence has a defect.
- Whole multiline `keyboard.insertText` follows Monaco typing behavior, not
  verbatim paste: observed output had automatic indentation and another closing
  brace, while the old 151 value was fully replaced with 197. The corrected
  test asserts Ctrl/Meta+A's exact full-model selection, then uses native arrows
  to select exactly `151` and types `197`. Bounded read-only cursor feedback
  accommodates soft-tab cursor steps without setting selection or position.
  Exact model, cursor, focus and native
  Undo assertions remain; no direct selection/model edits bypass these checks.

The corrected orchestration is locally checked, not yet proven on staging.
Python Playwright and Chromium exist locally, but sandbox browser launch is
blocked; an attempted authorized isolated fixture escalation failed because
the environment could not create its restricted sessions path. No bypass was
attempted. Offline contracts are not native browser evidence.

## Emulated Safari shortcut binding correction

Run `40535057167` passed 19/20 focused executions (all cleanup passed). The
remaining Mobile Safari failure occurred **before typing**: select-all left a
collapsed selection at line 2, column 5. Text focus was confirmed immediately
before the shortcut. Desktop WebKit and all Chromium projects passed.

The failed trace records Playwright 1.60.0 on a `darwin` host with iPhone 12 UA
and `hasTouch: true`. Playwright resolves `ControlOrMeta` from its **host** OS.
The application lock pins Monaco 0.55.1. Monaco resolves `CtrlCmd` using its
**browser** platform: Macintosh UA, or iPhone/iPad UA **with positive
`navigator.maxTouchPoints`**, chooses Meta. Other browser platforms choose
Control. WebKit's desktop build returns zero touch points outside its iOS
compile branch; touch-event emulation does not by itself prove a positive
reported value. The historical trace did not record this field, so a runtime
modifier mismatch is strongly supported, not retrospectively measured.

The corrected test therefore reads the actual instantiated editor's resolved
Select All and Undo bindings once and maps only a single plain Control/Meta+A/Z
chord. Missing, changed, multi-chord or unsupported bindings fail closed. It does
not try alternate shortcuts, override keybindings or invoke editor commands.
A single `[monaco-native-shortcuts]` console line records only validated
Control/Meta modifiers, A/Z keys and shortcut strings, two UA-family booleans,
and touch points capped at 32 with an explicit cap flag (invalid values become
null). It never serializes the binding object, UA, URL, cookies or storage.
This fixed-schema job-log evidence does not rely on attachments: CI deliberately
excludes raw attachments and traces from uploads.
All actions remain native keyboard events; exact selection/model/cursor/focus
and native Undo assertions remain. Post-shortcut text focus is also asserted.

The read uses the version-specific, private
`_standaloneKeybindingService.lookupKeybinding().getChords()` path, explicitly
an implementation-coupled input adapter rather than a behavior oracle. Review
it on Monaco upgrades. This is not a claim that physical iOS external-keyboard
usability has been verified or repaired.

Primary source evidence:
- [Playwright 1.60.0 host modifier resolution](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/input.ts)
- [Monaco 0.55.1 VS Code source ref](https://github.com/microsoft/monaco-editor/blob/v0.55.1/package.json)
- [Pinned browser platform detection](https://github.com/microsoft/vscode/blob/86f5a62f058e3905f74a9fa65d04b2f3b533408e/src/vs/base/common/platform.ts)
- [Pinned standalone editor binding service](https://github.com/microsoft/vscode/blob/86f5a62f058e3905f74a9fa65d04b2f3b533408e/src/vs/editor/standalone/browser/standaloneCodeEditor.ts)
- [Pinned Select All / Undo registrations](https://github.com/microsoft/vscode/blob/86f5a62f058e3905f74a9fa65d04b2f3b533408e/src/vs/editor/browser/editorExtensions.ts)
- [WebKit touch-point implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Navigator.cpp)

Offline mapping contracts cover Control, Meta and malformed binding rejection.
Corrected native browser execution remains pending; offline tests do not prove
browser delivery or the inferred historical mismatch.
