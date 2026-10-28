# Candidate bounded normal CI defaults

The workflow candidate uses one worker per normal job, at most two normal matrix
jobs, zero whole-test retries, and trace snapshots disabled. These settings apply
to scheduled normal runs and omitted/default manual inputs; explicit manual
worker, matrix (1/2/5), and retry (0–5) overrides remain available. Scope still
selects the full normal suite by default. This is an operating candidate, not an
application latency SLA or a guarantee of sustained reliability.

`trace_snapshots` is now a choice: `auto` (default), `true`, or `false`.
`auto` and missing input resolve to normal `false` / Premium `true`.
Explicit `true` or `false` applies to both suites, preserving diagnostic opt-in.
Invalid manual values fail during preparation, before service-facing jobs.
Premium keeps its existing one worker, matrix parallelism one, CI retries five,
and default snapshots enabled. Direct/local Playwright configuration is unchanged.

Snapshots disabled reduces DOM/network trace evidence, not application network
traffic. Retain-on-failure tracing, screenshots and other configured/default trace
evidence remain. Use `trace_snapshots=true` for deeper diagnostic runs; use
`matrix_parallelism=1` to compare the known serial operating condition.
Instrumentation overhead observed in a prior native-click trace motivates this
tradeoff; it does not prove that every HTTP 503 was caused by concurrency.

## Verification and remaining conditions

- Offline contracts cover manual/scheduled fallbacks, explicit false/zero,
  malformed input rejection, per-suite trace outputs, Premium preservation,
  normal-only points preparation and unchanged Premium fallback, cleanup and complete scope selection.
- Earlier whole-workflow baseline hashes remain unchanged. Exact approved default
  edits are reversed before applying those hashes; unrelated changes still fail.
- A comparison run using explicit matrix parallelism two is separate evidence from
  validating this final workflow commit with its defaults. Publication and final
  runtime validation remain dependent on that comparison's actual result.
- The prior successful five-project serial runs explicitly enabled normal point
  preparation. The new normal-only boolean `normal_prepare_points` defaults to
  `true`; scheduled and omitted manual inputs resolve to `true` as well. This
  versioned job-level override matches that prerequisite without changing GitHub
  variables, credentials or Premium. Explicit `false` is a diagnostic opt-out,
  **not** the validated operating condition. Invalid manual strings fail before
  service-facing jobs. There are ten dispatch inputs in total.
- The existing `prepare_points` input (default false) and its global repository
  variable fallback remain unchanged for Premium. A read-only check on 2026-10-27
  of the repository's Actions variables page reported no repository variables;
  no claim about organization-variable absence is made. Normal runs no longer
  depend on that fallback. Offline schedule resolution does not itself prove an
  actual scheduled run; the final candidate still requires runtime validation.
- No test assertions, existing skips, cleanup policy, permissions or account
  concurrency controls are changed by this candidate. A successful run is not a
  substitute for resolving separately observed infrastructure/maintenance errors.
