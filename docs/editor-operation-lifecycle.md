# Editor operation lifecycle: investigation and validation

## Current status — 2026-10-27

[Final same-revision validation](#final-same-revision-normal-suite-validation)
passed **608 tests across five projects**, with **27 existing skips and zero
failures**, on tests `856e525c599153a69605b8070c589cd1871f7956` and staging
frontend `69f76ad09c6ae0c0a817edfc9982236dd75b3775`. All account cleanups passed.
This combines three runs with one worker, serialized jobs, whole-test retries
disabled and trace snapshots disabled; it is not validation of the workflow defaults or Premium.
No main merge or production deployment is represented here. The historical 503
origin and rapid cross-editor pending-write conflict remain unresolved; the
latter has a test-sequencing correction, not an application fix. Earlier sections
preserve the investigation history and superseded outcomes.

Original patch baseline: `pwappy-com/pwappy-web-tests`, branch
`fix/stabilize-editor-e2e-39687552586`, verified head
`4ec2c08458e3f0b96e475d9391c7b6b49582f667`.

## What changed

- Starter dismissal: one awaited native `click`, then an independently awaited
  reflected-state assertion. Removed the mutating 4-second `expect.toPass` callback.
- Diagnostic probe: bounded locator-resolution budgets for installation/readback;
  explicit cleanup releases listeners, mutation observer and timer. The timer's
  lifetime fallback now releases all resources, not just itself. Cleanup tolerates
  an already-expired probe. A cleanup failure cannot replace an input/assertion
  failure. Optional probe readback/cleanup failures are warnings even after behavior
  success; real mouse release remains strict.
- Component insertion: one awaited native drag and unconditional awaited mouse
  release, then exactly-one-new-ID assertion. No input replay on delayed state.
  Release failure cannot replace the original drag failure.
- Initial snapshot discard: one native click and separate confirmation assertion,
  retaining the existing finally listener removal.
- Quick-property, file-explorer, event-build, property-parsing-build and script specs:
  give the `editorPage` fixture its own
  bounded setup/teardown budget (CI 120s, local 60s), leaving scenario bodies,
  assertions and their existing limits unchanged. Dependencies such as `page`
  and `context` are not automatically excluded from the scenario budget. This
  intentionally increases the possible total elapsed time; it is not a speed claim.

The script-deletion failure in run `40440727088` provides a further exact example:
`editorPage` setup consumed 33.388390s of 37.607503s before-hooks, and the scenario's
own setup consumed 81.178794s. Deletion began with approximately 1.144s remaining
in its 120s scenario budget. Only the editorPage fixture is separated by the script
spec correction; the remaining 4.219113s of before-hooks and the full scenario
setup still count. Under identical timings this would leave about 34.533s at
deletion, but it is an accounting illustration, not a guarantee of success. The
120s body ceiling, all assertions and existing afterAll app cleanup are unchanged.

No forced/synthetic input, product state writes, skipped assertions, or swallowed
native input errors were added. Changes elsewhere in the helper are preserved.
The other mutating toPass sites are not covered by this deliberately narrow patch.

## Budgets and limitations

The historical 4-second deadline is not a product SLA. Prior investigation reported
one 9.739-second client action (1.858 seconds server action; approximately 7.9 seconds
post-action tracing path). That observation disproves assuming every instrumented
operation completes within 4 seconds; it does not establish a percentile or prove
that 15 seconds is sufficient.

Starter input 15s and reflected-state assertion 10s are **provisional orchestration
budgets**. Installation/readback each use 5s locator resolution timeouts. Combined
with loading15s, configured startup observation20s CI/10s local, button2s and
settling0.3s, configured phases sum to72.3s CI/62.3s local, plus protocol/runtime
overhead (the previous six-second appearance phase summed to58.3s). These are not
a wall-clock upper bound or a guarantee all phase maxima fit the outer fixture:
shared setup currently has120s CI/60s local. Per-phase maxima are not guaranteed
entitlements: the outer timeout intentionally caps cumulative execution. The local
sum exceeding60s is a headroom limitation, not proof every phase must receive its
maximum. This candidate preserves outer fixture/scenario budgets and does not
automatically inflate global timeouts.
Playwright locator evaluation's timeout is a resolution budget, not cancellation
of JavaScript already running, and trace/protocol completion can overrun an action
budget. The test/fixture needs additional headroom; do not wrap these calls in a
short `toPass`, `Promise.race`, or timeout that leaves them running.

Probe fallback is event-loop dependent and cannot run while a renderer is frozen;
page destruction destroys that renderer's resources. Outer runner interruption can
still terminate a test. This patch removes helper-owned abandoned retry callbacks,
not all possible external cancellation. No production latency conclusion or full
E2E success can be inferred from offline doubles.

## Offline verification

Node24.22.1, built-in modules only:

```sh
node --test offline-tests/editor-operation-lifecycle.test.mjs
```

The harness is outside Playwright testDir (`./tests`) so normal E2E discovery cannot
load its module double. Tests import the actual TypeScript EditorHelper with native Node type stripping and
an isolated Playwright module double. They exercise single-input ordering, deferred
input settlement before rejection, no late helper mutation after rejection,
assertion negative controls, original-error preservation during page-closure cleanup,
full probe expiration/cleanup, existing-app short circuit, exact-one insertion and
snapshot listener removal. No browser, target site, credentials or real data.

At the offline-validation stage, live Playwright and semantic TypeScript checks
were not performed. Subsequent live results are recorded in the dated section
below; they do not constitute a semantic TypeScript check.
This local snapshot has no installed Playwright/TypeScript dependencies.
No dependency installations, workflow triggers,
remote commits/pushes or deployment were performed during local validation. `node --check` on the TypeScript
source is not a valid check here (it uses the JS parser and rejects type annotations);
the actual module is parsed and executed by the offline import tests instead.

Further isolated E2E investigation should record action+trace completion, assertion
latency, input count, and cleanup ordering on each failing browser. Keep native
input failures visible; an observed modal close does not turn a thrown click into
success. Validate time budgets from a distribution, not from a single sample.


## Follow-up: diagnostic-induced Safari regression

Full run `40425257223`, mobile Safari artifact `12701483127` showed two successful
behavior operations incorrectly failed by our new telemetry cleanup rule:

- properties `84868`: native click1856ms, hidden-attribute assertion510ms succeeded;
  diagnostic readback selector resolution6961ms then exceeded its5s timeout.
- file `129f4`: native click2313ms, hidden assertion35ms succeeded; diagnostic
  readback7608ms then exceeded its5s timeout.

The direct regression was `if (closeSucceeded) throw cleanupError` in the optional
readback catch. The narrow correction removes that throw and emits unavailable
telemetry with operation success metadata. It does not change the native click,
reflected-state assertion, drag release, snapshot assertions, or any timeout.
No zero measurements are invented. Probe self-expiration remains the cleanup
fallback. Native action and assertion exceptions still propagate unchanged.

At the readback-only correction stage, optional installation remained strict and supplies the successfully
read initial visible attribute; there was no observed installation failure in those
two traces. A best-effort installation redesign was considered separately, not
included in that immediate evidence-backed fix. That stage passed18 lifecycle tests.


## Follow-up: optional diagnostic installation separation

Comparison run `40431697485` at `e9638f9` supplies new evidence: two WebKit cases
(clipboard and line-height) fail on the initial probe's5s locator.evaluate resolution
budget before native input or the test body, despite resolving a visible modal.
This is another optional diagnostic cap incorrectly acting as a behavior gate.

Installation is now awaited best-effort, reporting only fixed unavailable reason
metadata. `initialVisible` has an explicit unknown (`undefined`) state. Unknown is
NOT closed: it executes the one required native click with the existing15s budget,
then the mandatory attribute-absence assertion with its existing10s budget. Only a
successful DOM read of null can skip an already-unnecessary click. No new fallback
state-read gate, retries, Promise.race or synthetic input is introduced.

Browser probe acquisition now defines rollback before registering listeners and
creating the observer/timer. Partial initialization failure releases acquired
resources, including the timer if a later read fails. If installation ran in the
renderer but the protocol response failed, the existing30s self-expiration and
normal finally readback remain available. Like all renderer timers, expiration
cannot progress while the renderer is frozen.

Offline lifecycle verification now passes24 tests, including unavailable install
with successful behavior, native failure and attribute failure; partial listener/
observer rollback; late initialization timer rollback; and protocol rejection
with a successfully installed self-expiring probe. Real input cleanup still fails
on error. Live E2E and TypeScript semantic checks were not performed at this
local-correction stage; subsequent live results are recorded below. Awaited
diagnostics can still consume the outer test budget.

Separate finding (NOT changed by this diagnostic patch): Safari snapshot-confirm
case2f0d8 call@4480 times out at5005ms. Locator resolution consumes3448ms;
actionability ends4854ms; native click begins4892ms, leaving about108ms of its5s
budget. A proposed separate15s native-action budget aligns with starter/drag but is
not a proven latency bound. Native click failures must remain failures even when a
screenshot suggests that the action took effect; both hidden-dialog assertions
must stay required.


## Separate candidate: snapshot confirmation native-action allowance

The snapshot-confirm click now has a provisional15s action budget, aligned with the
starter close/drag allowance. This is a separate change from optional diagnostics,
grounded in the measured3448ms locator resolution and4892ms dispatch start above.
It does not assume the action succeeded: native errors propagate even if the screen
suggests an effect, and both dialogs must still become hidden. The single awaited
click is not replayed. No forced/synthetic click or Promise.race was added.

Two additional offline contracts verify the exact15000ms timeout and unchanged
native-error propagation/listener removal, bringing the combined suite to26 tests.
The existing separate negative controls still require both dialogs to be hidden.
15s is not a product response-time SLA or proof of sufficient high-percentile
latency; live verification and fixture-budget monitoring remain necessary.


## Separate local candidate after ec60979: startup readiness observation

Baseline `ec60979e665fa1834874fb53e650f8bcf3f72a2f`. The e963 WebKit script-cancel
fixture failed its6s starter appearance assertion at1901010.570ms; the same editor
page's1902313.849ms frame shows the starter modal fully visible (1.303s later and
7.304s after waiting began). The earlier frame shows a real empty root and starter
placeholder, not proof of missing DOM. This is evidence of a premature readiness
gate, not proof that save, IndexedDB or browser scheduling was the single cause.
Frontend startup sets loading=false before awaiting initial save and orphaned
snapshot checking, so overlay-hidden alone is not full startup completion.

The helper now uses one read-only locator.evaluateAll observation per expect.poll
iteration to classify attached page/ons-navigator nodes and starter-modal visibility.
Both marker predicates require isConnected. The native full #dom-tree descendant
predicate is source-specific: TemplateContainer.js at deployed reference b89dd73
renders a plain #dom-tree div inside its ShadowRoot (L2520); displayDOMTree gets that
same div (L1641) and appends rootNode (L1660); createNode clones an ordinary .node
(L1732) and recursively node.appendChild creates descendants (L1793). Thus #dom-tree
and its content nodes share the same native tree. Native matches does not cross
shadow-host boundaries; if this product structure changes, this assumption and the
classifier must be revisited rather than assuming Playwright and native selectors
have identical shadow semantics. Full-scope rechecking rejects moved-out nodes. A connected visible starter takes priority if both markers exist. Existing content preserves
the previous no-modal-action path. No DOM, an empty tree, or hidden placeholder stays
pending and ultimately fails setup if no positive state appears. The poll inherits
configured expect timeout (20s CI/10s local) rather than imposing another short4/6s
cap. Caller opt-out (skipStarterModal:false) remains outside this helper and unchanged;
no new demo/empty-app success exemption was invented.

This is a narrow replacement of the prior content-or-starter decision, not a claim
of a universal editor startup-complete flag. Existing overlay-hidden prerequisite
and snapshot-dialog handling remain unchanged. In particular, this patch does not
silently dismiss any late snapshot dialog or expand startup orchestration.

All mutation/probe installation is after the awaited successful poll. A pending
protocol read can finish after a poll deadline, but it cannot cause a later click:
the helper already rejected, and the callback only reads DOM/assigns local result.
The offline regression explicitly models this ordering and waits for that late
read to finish. This distinguishes harmless late reads from the removed mutating
toPass callbacks; it does not claim browser protocol cancellation.

The combined offline lifecycle harness now passes35 tests, including delayed
appearance/content, pending/absent/placeholder negatives, no operations before
readiness, visible-modal precedence, disconnected-marker negatives, strict required-read failure and a late-read
negative control. State-sequence doubles validate orchestration, not real browser
latency or Playwright's internal clock. Real E2E and semantic type validation were
outstanding at this stage; the candidate did not alter the then-active ec60979
run. Subsequent live results are recorded below.

A product-shaped native DOM/ShadowRoot check was prepared outside the publishable
patch, but installed Chromium could not start under this environment's socket
restriction (`process_singleton_posix socket(): Operation not permitted`). No
browser privileges were escalated, no workaround was attempted, and no real-DOM
browser pass is claimed. The source-specific same-tree assumption was independently
verified from [TemplateContainer.js at b89dd73](https://github.com/pwappy-com/pwappy-web/blob/b89dd73/src/components/TemplateContainer.js#L1641-L1660)
and its [recursive node construction](https://github.com/pwappy-com/pwappy-web/blob/b89dd73/src/components/TemplateContainer.js#L1726-L1793).
The live runs below provide separate browser-level evidence; no new
browser-dependent test was added to the offline suite.


## Live normal-suite validation — 2026-10-27

These are real Playwright normal-suite runs, separate from the mocked offline
contracts above. Counts exclude the separate cleanup tests; durations are the
Playwright normal-suite summaries. Every listed project's cleanup step succeeded;
Ubuntu run `40452803611` completed successfully at 05:38:12 UTC.

| Run / project | Tested commit | Workers | Passed / failed / skipped | Duration |
| --- | --- | ---: | --- | --- |
| [40437301666](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40437301666), Windows Chromium | `ec60979e665fa1834874fb53e650f8bcf3f72a2f` | 2 | 122 / 0 / 5 | 28.9m |
| [40440727088](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40440727088), macOS desktop WebKit | `8ff119000d9441cc75dd68183487fc4d192e29c7` | 2 | 122 / 0 / 5 | 21.6m |
| [40440727088](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40440727088), macOS Mobile Safari | `8ff119000d9441cc75dd68183487fc4d192e29c7` | 2 | 119 / 2 / 6 | 39.5m |
| [40449179165](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40449179165), macOS Mobile Safari | `c123249c467a53e17e72c30d320ec71bea4621c0` | 1 | 121 / 0 / 6 | 29.6m |
| [40452803611](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40452803611), Ubuntu Chromium | `c123249c467a53e17e72c30d320ec71bea4621c0` | 1 | 122 / 0 / 5 | 19.1m |
| [40452803611](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40452803611), Ubuntu Mobile Chrome | `c123249c467a53e17e72c30d320ec71bea4621c0` | 1 | 121 / 0 / 6 | 17.5m |

All listed runs use normal scope `all`, matrix parallelism `1`, trace snapshots
`false`, and retries `0`; matrix serialization does not mean one worker per job.
These are manual validation settings, **not workflow defaults**. At `c123249`,
[workflow-dispatch defaults](https://github.com/pwappy-com/pwappy-web-tests/blob/c123249c467a53e17e72c30d320ec71bea4621c0/.github/workflows/e2e-tests.yml)
remain workers `75%`, matrix parallelism `5`, trace snapshots `true`, retries `5`.
No default-setting change is implied by these results.

The finalized Windows, successful Mobile Safari and both Ubuntu project logs
showed no HTTP 503; Mobile Safari and both Ubuntu projects also showed no
native-input timeout. This does not establish that intermittent
503s are fixed: server logs had not yet been inspected at this stage.
Frontend explanation-input loss was unmodified by these test-side changes. Code,
worker count, matrix load and recording settings changed in combinations across
comparisons, so a passing run does not isolate one causal fix. In particular,
[scheduled main run 40443598188](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40443598188)
executed Premium jobs on Ubuntu Chromium, Ubuntu Mobile Chrome and Windows during
03:20–03:54 UTC, overlapping the failed Mobile Safari phase of `40440727088`
(03:13–03:52 UTC). This is a shared-staging/server-load confound, not evidence of
shared Safari-account use: the scheduled macOS jobs were canceled without steps.
The desktop WebKit phase finished before that scheduled run started.

Windows and desktop WebKit passed earlier commits, not `c123249`; these results
are not an all-five-project pass on one SHA. Existing scenario assertions and
pre-existing skips were preserved, but skipped tests and every business feature
are not validated by the passing counts. Premium was not exercised by the listed
normal-suite runs. Semantic TypeScript checking remains unverified. No application-code change, main merge
or production deployment is represented by the normal-suite runs above.


## Subsequent frontend and staging investigation — 2026-10-27

The earlier test-side results above predate the application change. Frontend
[`69f76ad09c6ae0c0a817edfc9982236dd75b3775`](https://github.com/pwappy-com/pwappy-web/commit/69f76ad09c6ae0c0a817edfc9982236dd75b3775)
addresses explanation-draft synchronization, focus and startup/bootstrap behavior.
[Frontend CI 40466341181](https://github.com/pwappy-com/pwappy-web/actions/runs/40466341181)
passed the full build, 23 state tests and four real-browser combinations
(Ubuntu/macOS × Chromium/WebKit). These focused checks are not the normal suite.
[Staging deployment 40466981401](https://github.com/pwappy-com/pwappy-web/actions/runs/40466981401)
succeeded at 07:28:12 UTC; deployed asset hashes were verified against that build.
This was staging only, not a production deployment.

Tests commit `f65045d1d884f1972f5dd2f1d62a1e9d6afefe5c` adds the seven-scenario
`quick-property-regression` selection; the default scope remains `all`. Its 174
offline checks are separate from live browser validation.
[Focused E2E 40467795865](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40467795865)
completed successfully at 07:47:06 UTC on that exact test commit against the
updated staging frontend: **35 passed, 0 failed, 0 skipped**. Each of the five
projects passed all seven scenarios, including explanation metadata at
`editor-quick-property-editor.spec.ts:348` (line number at the tested revision):

| Project | Focused-suite duration | Cleanup result |
| --- | --- | --- |
| Ubuntu Chromium | 1.1m | 1 passed (4.5s) |
| Ubuntu Mobile Chrome | 56.1s | 1 passed (3.9s) |
| Windows Chromium | 1.2m | 1 passed (5.1s) |
| macOS WebKit | 2.3m | 1 passed (6.8s) |
| macOS Mobile Safari | 4.6m | 1 passed (8.4s) |

All five cleanup steps succeeded. Jobs ran sequentially with workers `1`, retries
`0`, matrix parallelism `1`, trace snapshots `false` and point preparation enabled.
Finalized logs showed no actual HTTP 503 or native-input timeout warnings. The
07:33:05–07:47:05 UTC test-job interval did not overlap the inspected main jobs
(latest end 06:32:21 UTC) or staging deployment (end 07:28:12 UTC).
These seven scenarios per project validate the focused correction, not the full
normal or Premium suite, production behavior, or a latency distribution.

[Bounded server-log diagnostic 40462359543](https://github.com/pwappy-com/pwappy-web/actions/runs/40462359543)
at `d2ac19da5233d6da21d9141d8840db37c676406e` found 19,435 requests in the
01:18:50–01:30:24 UTC incident window, including 157 HTTP 503 responses
(29 GET and 10 PUT classified as editor-json), plus three HTTP 507 responses
classified as GET/other. These are counts in the inspected log data, not guaranteed
complete incident totals: the current-log read was bounded to 32 MiB and truncated.
[Error/storage diagnostic 40463551214](https://github.com/pwappy-com/pwappy-web/actions/runs/40463551214)
at `4e0f5b7de23a9256b352e313312f1e0b3ef548a4` found no attributed error patterns
in the incident window. Current filesystem usage was 53% and inode usage 1%;
this does not establish historical capacity or quota state, nor does HTTP 507
alone identify a disk problem. The server-side root cause remains unresolved;
neither the frontend correction nor passing browser checks proves it fixed.

### Full normal-suite follow-up on the updated staging frontend

[Run 40469724484](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40469724484)
completed at 10:43:58 UTC on tests commit
`f65045d1d884f1972f5dd2f1d62a1e9d6afefe5c` and staging frontend
`69f76ad09c6ae0c0a817edfc9982236dd75b3775`: **607 passed, 27 skipped, 1 failed**.
Unlike the earlier cross-revision results, all five projects tested the same test
commit, but this was not a full pass.

| Project | Passed / failed / skipped | Normal-suite duration |
| --- | --- | --- |
| Ubuntu Chromium | 122 / 0 / 5 | 19.8m |
| Ubuntu Mobile Chrome | 121 / 0 / 6 | 21.2m |
| Windows Chromium | 121 / 1 / 5 | 18.3m |
| macOS WebKit | 122 / 0 / 5 | 56.0m |
| macOS Mobile Safari | 121 / 0 / 6 | 51.8m |

The sole failure was the style-sizing scenario at
`editor-ui-properties-2.spec.ts:227`, invalid-CSS assertion at line 293.
Explanation metadata at `editor-quick-property-editor.spec.ts:348` passed in all
five projects. All five account
cleanup steps succeeded. Final logs showed no actual HTTP 503 or native-input
timeout warnings; this still does not resolve the historical server incident.
The run used scope `all`, workers `1`, matrix parallelism `1`, retries `0`, trace
snapshots `false` and point preparation enabled, not the workflow defaults.
Inspected main/deployment job intervals did not overlap this run. Premium was
not exercised; the 27 existing skips are not passing coverage.

Tests-only follow-up `856e525c599153a69605b8070c589cd1871f7956` adds a raw inline
declaration `width: 300px` commit barrier after Monaco input/readback and before switching tabs.
The failing trace showed invalid input beginning 74ms after the Monaco helper,
while the prior write was deferred by 100ms; later reads still saw `width: 300px`.
This supports an ordering race, but the trace does not prove the exact dispatch
interleaving.
The barrier orders the existing scenario without changing its final invalid-CSS
assertion or timeouts. See [style-sizing commit ordering](style-sizing-commit-order.md)
for the evidence and eight offline regression checks (182 offline checks total).
This does not fix the residual product-level conflict between pending writes from
different editors. Subsequent full-suite validation is recorded below.


### Final same-revision normal-suite validation

All five normal projects completed on tests
`856e525c599153a69605b8070c589cd1871f7956` against staging frontend
`69f76ad09c6ae0c0a817edfc9982236dd75b3775`, across the three runs below:
**608 passed, 27 skipped, 0 failed**. The final run completed at 13:06:10 UTC.

| Run / project | Passed / failed / skipped | Normal-suite duration | Account cleanup |
| --- | --- | --- | --- |
| [40491183079](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40491183079), Windows Chromium | 122 / 0 / 5 | 18.8m | 1 passed (4.5s) |
| [40493991207](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40493991207), Ubuntu Chromium | 122 / 0 / 5 | 17.9m | 1 passed (4.0s) |
| [40493991207](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40493991207), Ubuntu Mobile Chrome | 121 / 0 / 6 | 19.7m | 1 passed (4.7s) |
| [40499176746](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40499176746), macOS WebKit | 122 / 0 / 5 | 32.7m | 1 passed (6.3s) |
| [40499176746](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40499176746), macOS Mobile Safari | 121 / 0 / 6 | 40.2m | 1 passed (9.8s) |

Each run used normal scope `all`, workers `1`, matrix parallelism `1`, retries
`0`, trace snapshots `false` and point preparation enabled. These manual settings
do not change the workflow defaults. All five projects passed the style-sizing
scenario at `editor-ui-properties-2.spec.ts:227` (execution #69) and explanation
metadata at `editor-quick-property-editor.spec.ts:348`; finalized logs contained
no actual HTTP 503 or native-input timeout warnings. All five account-cleanup
steps succeeded. Existing assertions and the 27 pre-existing skips were
preserved; skipped cases are not validated, and Premium was not exercised.

The final macOS run must not be described as fully isolated: scheduled main run
[40508600487](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40508600487)
at `3bd403ae26e7ad447eef495e18b2bd06f659ac18` started Ubuntu Chromium and
Mobile Chrome test steps at 13:02:48 and 13:02:50 UTC respectively. These overlapped
the final Mobile Safari test phase until 13:05:40 and its cleanup until 13:05:59.
Mobile Safari style-sizing at `editor-ui-properties-2.spec.ts:227` (12:48:25) and
metadata at `editor-quick-property-editor.spec.ts:348` (12:31:28) passed before that
overlap.
No deployment overlapped. Passing results do not resolve the historical
server-side 503 cause or the application's rapid cross-editor pending-write
conflict, nor establish high-percentile latency or a causal performance gain.


## Late snapshot blocker rendezvous (2026-10-28)

Run 40651643267 at 05fed79697c8b72b4ac76bb97c72697d3b054231, Windows job 122699992375,
failed the tour "do not show again" test after editor reload: the starter readiness
classifier remained pending for its configured 20s. The log did not record snapshot
visibility, so a missed late snapshot dialog is a source-supported hypothesis,
not an established cause of that particular failure.

At frontend f40418e, AppContainer sets loading=false before awaiting initial save
and the asynchronous orphaned-snapshot lookup. Its snapshot message box must settle
before starterModal.show(). The existing optional snapshot helper's isVisible()
check is immediate; its timeout option does not wait for later appearance.

The starter helper now recognizes an attached visible message-box containing the
same orphaned-snapshot prompt used by the existing snapshot helper. This known
blocker takes priority over starter/content markers. Only after the read-only poll
resolves does it invoke the existing snapshot helper once: the same discard and
confirmation choices, native actions, hidden-state assertions and listener cleanup.
It neither restores snapshots nor adds a new deletion mechanism or broader target.

A distinct post-dismissal readiness observation then requires the original
starter/content outcome. Each observation phase inherits configured expect budget
(20s CI/10s local); only the observed-blocker branch has a second phase. This is not
a claim that the combined phase budget remains 20s. Existing native-action budgets
are unchanged. A persistent/returning snapshot blocker fails after one handling
invocation; empty/hidden/detached/wrong-text states remain pending and fail. Native
inputs never run inside polling and cannot occur after a rejected observation.

The existing-content fast path is preserved, not promoted to proof that snapshot
checking finished. Content can render before asynchronous snapshot lookup; this
change does not claim universal editor-startup completion or fix every late-dialog
schedule. A fixed enum log identifies an actually observed late blocker without
printing URLs, DOM text, application data or credentials.

Seventeen new actual-helper offline cases cover late-blocker sequencing, blocker
priority, pending native input, exact failures and listener cleanup, no repeated
dismissal within one rendezvous invocation, invalid marker negatives, and late read completion after either phase
has expired. These synthetic schedules demonstrate the helper contract, not the
runtime cause of the hosted Windows failure. Existing browser proof gates and
business assertions remain unchanged.
