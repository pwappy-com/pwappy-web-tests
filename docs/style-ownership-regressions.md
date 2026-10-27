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
