# Main CI safety boundary

`e2e-tests.yml` uses `scripts/run-main-verification.mjs` for Normal and Premium tests and cleanup. The five existing OS/browser combinations, schedule-specific OS selection, manual suite/browser/scope selection, points on/off, trace settings and matrix parallelism remain available. Firefox is not included until its staging test account is authorized.

## Before any authenticated work

- Pushes require the exact non-forced `main` tip. Schedules require `main` and an existing schedule. Manual dispatch accepts the selected branch's matching short or `refs/heads/…` event ref, never a tag or a different ref.
- The checked-in `.github/webmcp-verification.json` pin must match the public staging deployment marker. Base URL, login and points endpoints must belong to the fixed staging service. The marker is checked again after key preflight and before each cleanup process.
- Premium additionally requires `PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA` to equal the pin. This is source-specific authorization, not a persistent bypass.
- Each candidate Normal/Premium account must have no reusable local auth cache and a server-issued identity cookie matching that exact account. A read-only settings check must report `isUserGeminiApiKeyRegistered === false`. Only the synthetic test key is passed to test processes. Smoke uses its dedicated `998` account with the same read-only identity/key check.

The branch verification workflow retains its separate marked-feature-push trigger and index-zero contract. Main's broader trigger support does not change the branch guard.

## Workers, scopes and retries

Automatic runs use one worker, zero retries and the full suite. Manual Normal workers accept positive integers or `1%`–`100%`, resolved against the runner's CPU count. Only slots `000`–`996` are eligible; `997` is the existing rejected smoke probe and `998` the smoke account. Every possible slot is checked before any test starts. A staging account outside its server allowlist fails closed rather than receiving new permission.

Retry workers retain their `parallelIndex` account. The safe reporter counts each logical test once, replacing its earlier result when retried, and records attempt counts separately. Retries still execute and reveal recovery, but **any failed, timed-out or interrupted attempt keeps this verification job failed**, even if a retry passes. `RAW_TEST_EXIT_CODE` records Playwright's exit; `EXIT_CODE` records the stricter verification result used by the metadata artifact and job outcome.

All-scope runs, including manual all-scope, set the existing full-verification flag so nonphysical drag/drop and copy/paste checks do not silently revert to CI skips. Focused manual scopes retain their selected files/grep without enabling that full-suite override. Physical-device-only coverage is not claimed.

## Cleanup eligibility

The reporter writes `started=true` only after a real worker begins a test and atomically tracks its parallel slot. Failed preflight, spawn/configuration failure, and an all-skipped suite cannot claim this flag. Cleanup requires that flag plus the runner-created manifest. The manifest binds the run, attempt, test SHA, source pin and exact selection.

The reporter records a sticky failure for any callback or ledger write error. The wrapper requires a final completion record consistent with both attempted tests and the saved account ledger. Missing, partial, mismatched or failed recording cannot produce a successful verification even if Playwright swallows a reporter exception.

Only tracked accounts with a nonempty, matching server-identity session are eligible for cleanup. Missing/empty sessions are skipped; mismatched or malformed sessions fail closed. Cleanup uses each explicit account index with one worker and zero retries. It never scans arbitrary old `0..3` sessions. The source marker is checked before each cleanup and after the cleanup batch. Points smoke performs its existing balance/replay/cleanup-phase assertions itself and never launches app cleanup.

## Public output and diagnostics

All test/cleanup/smoke child stdout and stderr are discarded. The only test output published is validated logical/attempt counts, static allowlisted source coordinates and fixed diagnostic enums. Trace/screenshot/video settings remain runner-local; no raw evidence, API body, browser console, auth state or attachment is uploaded. Public artifacts remain metadata-only.

macOS Normal runs retain resource and transport observations. Resource sampling emits only fixed numeric CPU/memory/load/page/swap/process fields, never process commands or arguments. The existing bounded, credential-free static transport sampler still observes staging and its public control. These observations cannot alter retries or test outcomes and stop when the child finishes.

## Offline verification

`node --test offline-tests/*.test.mjs tests/tools/test-account-index.test.mjs`

`offline-tests/main-safe-execution.test.mjs` exercises the current boundary, including an actual browserless Playwright child with two parallel slots, pass/skip and failure-then-retry-pass. All network/auth/key APIs in these tests are synthetic. It checks that a private canary never reaches the public output and that all-skipped runs never trigger cleanup.

Older shell and immutable-hash contracts use an explicit exact-edit migration adapter. Their fixed historical hashes remain unchanged. Those historical scripts are not executed by CI; current worker/scope/points/retry/cleanup/telemetry behavior is tested directly against the new wrapper and actual workflow.
