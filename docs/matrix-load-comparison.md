# Controlled normal-matrix load comparison

`matrix_parallelism` is a manual choice of `1`, `2`, or `5` (default `5`). It caps
concurrent **normal matrix jobs**, not workers within each job. Scheduled runs
and missing/empty manual values retain `5`. Premium remains capped at `1`;
this is not a global cap across normal and premium or unrelated workflows.

The first `prepare-matrix` step validates the environment-passed input before
service-facing dependent jobs can start. Invalid nonempty manual values fail
closed. Only the validated numeric output reaches normal `max-parallel` through
`fromJSON`; raw input is not interpolated into shell code. Dispatch inputs total
9, including `normal_browser` and the unchanged `trace_snapshots` option.

For a separately authorized comparison after the current run and cleanup finish,
use the same commit, normal suite, full matrix/test scope, per-job workers,
retries, trace setting, test data/account scope, and service state. Vary only
`matrix_parallelism` (e.g. `5` versus `1`). Keep cleanup and evidence collection
unchanged. Compare actual HTTP 503s, native-input timings, failures and durations
per browser. Job ordering is not guaranteed, and reduced overlap can change
elapsed time and service conditions; interpret results accordingly.

The snapshots-off run `40431697485` observed actual HTTP 503s across multiple
platforms. This motivates a controlled load comparison; it does **not** establish
load as the cause. No comparison is dispatched by this change. Assertions, test
count, workers, retries, timeouts, permissions, secrets, cleanup and account
concurrency remain unchanged.

Offline checks: `node --test offline-tests/matrix-load-control.test.mjs`.
They execute the actual validation Bash with isolated temporary output and
inspect workflow wiring; no install, browser, application call or workflow run.
They do not execute GitHub's hosted expression engine or prove improved outcomes.

Official Actions references:
- [Strategy context availability (`needs`)](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
- [Numeric conversion with `fromJSON`](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#fromjson)
- [Matrix parallelism](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategymax-parallel)
