# Finish manual style setup before editing sizing attributes

Evidence: Windows Chromium in [run 40469724484](https://github.com/pwappy-com/pwappy-web-tests/actions/runs/40469724484),
test revision `f65045d1d884f1972f5dd2f1d62a1e9d6afefe5c`,
staged application `69f76ad09c6ae0c0a817edfc9982236dd75b3775`.

The style-sizing scenario entered `invalid_value_test` after setting a separate
Monaco style to `width: 300px` without a semicolon. The failing trace's inner
attribute assertion sampled the preview 14 times and received `width: 300px`,
not an empty style or the requested invalid value. Native fill, Enter and blur
completed; the assertion failed.

`PropertyContainer` queues a captured Monaco style update for 100 ms. Switching
to the Attributes tab reselects the element and exposes the panel without waiting
for that queued update. The test then treated panel/input visibility as proof the
previous edit was complete. Trace fill started about 74 ms after the Monaco helper returned,
and Enter overlapped the queued-update window. Executing the actual
queued callback with controlled state also demonstrates that an older style can
overwrite a later sizing edit. This supports an ordering race; the trace does
not directly instrument Redux dispatches or prove the exact event interleaving.

The three relevant application source files (`PropertyContainer`,
`StyleSizingEditor`, `TemplateJsonSlice`) are unchanged from the earlier staged
revision `b89dd73c60d53e119ca4860ad61c004b3500a32a`.

## Test-side correction

Verify the Monaco operation succeeded and returned the requested model text.
Then await the exact raw preview declaration `width: 300px` before switching
editors. A computed width is not sufficient because layout might already produce
300 px without the requested declaration. The new check is read-only and bounded
by the existing assertion timeout; it adds no fixed sleep or repeated mutation.

The final invalid-value assertion and its timeout, all other scenarios, fixture
budgets and cleanup remain unchanged. This sequences two independent test steps;
it does not claim to fix the application's broader pending-edit conflict behavior.

`node --test offline-tests/style-sizing-commit-order.test.mjs` executes the actual
setup block with explicit doubles. Eight checks cover commit ordering, a stale
write negative control, failed model updates, missing preview commits, and an
exact hash of the rest of the scenario file. These are orchestration checks, not
real-browser validation. A live rerun is still required.
