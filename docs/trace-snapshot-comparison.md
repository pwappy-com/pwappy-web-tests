# Controlled trace snapshot comparison

Diagnostic switch only; not an automatic permanent fix. `trace_snapshots` defaults
to `true` in workflow dispatch. Missing/empty values (including scheduled runs)
also enable snapshots. The workflow passes `github.event.inputs.trace_snapshots`
directly as a string, preserving explicit `false` without a truthy `||` fallback.
Locally, `PWAPPY_TRACE_SNAPSHOTS=true|false` controls the same option. Other
nonempty values fail config validation before tests run.

The mode stays `retain-on-failure`; screenshots, sources, and attachments retain
Playwright defaults. `false` reduces DOM and network evidence in the trace, not
application network requests, assertions, or native input. Workers, retries,
test selection, timeouts, video, and failure screenshots are unchanged.

For an authorized comparison, use the same commit, runner/browser, test selection,
workers, retries, and isolated test data for both runs; vary only this input.
Compare action timings and outcomes, not just pass counts. Prior observed
post-action instrumentation delay is motivation, not proof of a snapshot root
cause; focused versus full runs are not a controlled A/B. Re-enable snapshots
after the diagnostic run to retain normal evidence.

Verified against Playwright v1.60.0:
- [Trace config schema](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright/types/test.d.ts#L6794)
- [String/object defaults](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright/src/worker/testTracing.ts#L88-L97)
- [GitHub dispatch input string semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs)

Offline contract checks: `node --test offline-tests/trace-config.test.mjs`.
These execute config with stub imports and inspect workflow wiring; they do not
install Playwright, dispatch Actions, validate the hosted expression engine, or
prove runtime performance improvement.
