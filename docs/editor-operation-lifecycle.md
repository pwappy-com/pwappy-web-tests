# Local test-side operation lifecycle patch

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
503s are fixed: their root cause remains unconfirmed without server logs.
Previously observed frontend explanation-input loss remains unmodified. Code,
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
or production deployment is represented by this test-side validation record.
