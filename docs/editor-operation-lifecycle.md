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
  failure; cleanup failures on the success path are still thrown.
- Component insertion: one awaited native drag and unconditional awaited mouse
  release, then exactly-one-new-ID assertion. No input replay on delayed state.
  Release failure cannot replace the original drag failure.
- Initial snapshot discard: one native click and separate confirmation assertion,
  retaining the existing finally listener removal.
- Quick-property and file-explorer specs: give the `editorPage` fixture its own
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

Full Playwright execution, TypeScript semantic checking, browser-matrix verification,
and performance validation were NOT run: this cloud snapshot has no installed
Playwright/TypeScript dependencies. No dependency installations, workflow triggers,
remote commits/pushes or deployment were performed during local validation. `node --check` on the TypeScript
source is not a valid check here (it uses the JS parser and rejects type annotations);
the actual module is parsed and executed by the offline import tests instead.

Next authorized isolated E2E run should record action+trace completion, assertion
latency, input count, and cleanup ordering on each failing browser. Keep native
input failures visible; an observed modal close does not turn a thrown click into
success. Validate time budgets from a distribution, not from a single sample.
