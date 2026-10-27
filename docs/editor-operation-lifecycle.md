# Local test-side operation lifecycle patch

Baseline: `pwappy-com/pwappy-web-tests`, branch
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
- Quick-property, file-explorer, event-build and property-parsing-build specs:
  give the `editorPage` fixture its own
  bounded setup/teardown budget (CI 120s, local 60s), leaving scenario bodies,
  assertions and their existing limits unchanged. Dependencies such as `page`
  and `context` are not automatically excluded from the scenario budget. This
  intentionally increases the possible total elapsed time; it is not a speed claim.

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
with existing loading15s, appearance6s, button2s and settling0.3s, configured phases
sum to58.3s, plus protocol and runtime overhead. They are not a wall-clock upper bound:
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

The current combined follow-up revision has not yet undergone live Playwright or
semantic TypeScript validation. Earlier revisions were exercised in the runs
documented below; those outcomes do not validate these later corrections.
This local snapshot has no installed Playwright/TypeScript dependencies.
No dependency installations, workflow triggers,
remote commits/pushes or deployment were performed during local validation. `node --check` on the TypeScript
source is not a valid check here (it uses the JS parser and rejects type annotations);
the actual module is parsed and executed by the offline import tests instead.

Next authorized isolated E2E run should record action+trace completion, assertion
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
on error. Live E2E and TypeScript semantic checking remain separate/unperformed for
this local correction. Awaited diagnostics can still consume the outer test budget.

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
