# Branch-only staging verification

This workflow is preparation for `feat/webmcp-authoring`, not proof of a successful
live run. It does not enable, disable, dispatch, or edit the existing main workflow.
No source is merged or deployed by this workflow.

## Temporarily blocked Firefox scope

The branch-only plan in `scripts/branch-verification-plan.mjs` retains the six
requested browser/OS pairs, but records Ubuntu Firefox normal and Premium as
**blocked, not run**. Staging account preparation rejected `pwuf000` with HTTP 403;
the current backend authorization does not include the Firefox account family.
This is an account authorization blocker, not evidence of a Firefox feature failure.
Do not alias Firefox to another account or broaden backend authorization to bypass it.

The preflight publishes both blocked records in its job summary and warnings,
and schedules the ten existing normal/Premium combinations. Fail-fast is disabled
only in this branch workflow so one failure does not cancel unrelated coverage;
execution remains serial and source/authorization guards remain mandatory.
The final aggregate fails while blocked coverage remains, even if all ten runnable
suites pass. Missing blocked-count output also fails closed. Direct branch runner
Firefox tests and cleanup reject locally before any network request or login.
There is no input/environment override for the blocked pair or arbitrary selection.
Removing this blocker or changing the requested scope requires a separate reviewed
change; isolated local Firefox checks do not satisfy the missing staging suites.

## Exact source and intentional trigger

1. Commit and deploy the reviewed **pwappy-web** source to staging. Check its exact
   remote SHA and independently verify the public deployment marker and deployed
   assets using the source repository's staging deployment procedure.
2. Set `.github/webmcp-verification.json` to that full source SHA. This is the web
   application SHA, not the web-tests SHA. Commit this pin with all test repairs.
3. Only when those checks and the requested account operations are authorized,
   push the web-tests branch with `[verify-webmcp]` in the **tip commit** message.
   Unmarked pushes create no verification jobs. There is no schedule, PR, main
   push, or workflow-dispatch entry point in this additional workflow.
4. The workflow checks the exact triggering tests SHA and branch, rejects forced
   or deleted push events, and requests only the fixed public root marker
   `https://dev.pwappy-dev.com/staging-deployment.json` before authentication.
   The marker must have the pinned source commit and valid deployment run fields.
   Redirects, other origins, malformed/oversized JSON and mismatched pins fail.
   An optional `PWAPPY_WEBMCP_SOURCE_SHA` must match the file; it cannot override it.

`PWAPPY_TEST_BASE_URL` may be the verified staging origin, `/editor`, or `/editor/`.
Query strings, fragments, embedded credentials and other paths/origins are rejected.
The login endpoint must be exactly
`https://dev.pwappy-dev.com/pwappy-api/rest/v1/test-login`.
The points read URL must be unset or exactly the corresponding
`/pwappy-api/read/v1/pwappy-points` URL. Inconsistent secret configuration stops
before the passcode is supplied to the test process, without printing its value.

## Normal and Premium are distinct permissions

Normal can proceed independently of the Premium authorization. It creates,
saves and deletes synthetic apps in dedicated staging test accounts and prepares
those accounts' test points using the existing API. It never selects Premium
specs. The workflow uses one worker, zero retries, serial matrix execution, the
existing global staging-account lock, and the existing per-OS/browser lock.
A stable account index `0` prevents failed-worker replacement from leaving other
accounts behind. Cleanup rechecks the stage before touching only that same account and again after
the cleanup process finishes.
It is not the removal of arbitrary personal apps or production content.

Premium fails **before login and browser installation** unless repository variable
`PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA` equals the pinned application SHA.
Set it only after authorization of that concrete live verification scope, including
public test publication/takedown, backend moderation, test-point consumption and
synthetic account cleanup. Changing the source pin invalidates old authorization.
This variable is an execution gate, not permission by itself; it must not be set
merely to make CI green. The final aggregate fails if Premium is blocked or skipped.
The operator must confirm that authorization before changing the variable.

A preexisting nonempty/symlinked authentication cache for the selected account
blocks Premium rather than being reused, deleted or overwritten. Fresh checkouts
(or the empty `{}` files created by Playwright configuration) remain eligible.
This prevents the later test process from reusing a different cached identity than
the account checked below.

Before any Premium test or app mutation, a fresh in-memory request context logs
into the exact dedicated OS/browser/index-0 account using the normal fixed
`test-login` endpoint. Before reading settings it inspects storage state only in
memory, without a file path, and requires exactly one service-issued
`pwappy_ident_key` cookie (the checked-in `.env.base` copied by backend deployment)
or the explicit CookieService fallback `pwappy_ident`, matching the requested
account. Exactly one cookie across both allowed names is required. The live
staging cookie name has not been observed; other names fail closed. The cookie must be secure,
HttpOnly, unexpired, path `/`, and apply to the fixed staging host. Host-scoped
`dev.pwappy-dev.com` and Domain-scoped `.dev.pwappy-dev.com`/`.pwappy-dev.com` are
accepted according to the PHP CookieService contract. Missing, mismatched or
duplicate identity cookies block the run before the settings request. JWT/token
values are not inspected or decoded as identity evidence. It then makes only a GET to
`https://dev.pwappy-dev.com/pwappy-api/rest/v1/user-setting`. The response must have
HTTP 200, API code 200, and
`details.userSetting.isUserGeminiApiKeyRegistered === false`. A registered key,
missing/malformed flag, unavailable login/settings or a redirect blocks the suite
before `started=true`, so the workflow does not run its app cleanup either. No
actual-key endpoint is requested, no response body or cookie is logged/saved, and
the context is disposed on success and failure. Both requests reject redirects
and use fixed HTTPS destinations; no cached authentication or dotenv is loaded.
The account must remain reserved during verification; this read is a point-in-time
check, not a server-side lock against someone registering a key afterward.

No real Gemini key is read or passed. Registration/settings cases receive the
obviously synthetic `AIza_TEST_ONLY_WEBMCP`; model-generation cases already mock
their API. The reviewed backend main implementation uses OpenAI's free
`/v1/moderations` endpoint with `omni-moderation-latest`, not paid generation,
for publication moderation. The user's all-tests request covers synthetic test
publication and takedown. The deployed backend SHA/runtime configuration has not
been established by this workflow, so this does not claim that other generation
paths are free. The source-bound authorization gate remains in place.

## Coverage and skips

The requested Normal and Premium scope is the prior five CI combinations plus Linux Firefox. The current runnable plan excludes the explicitly blocked Firefox pair described above:

- Linux Chromium, mobile Chrome emulation, and Firefox.
- Windows Chromium.
- macOS WebKit and mobile Safari emulation. Normal keeps the existing
  `macos-26-intel` selection (the existing workflow documents ARM memory/swap
  pressure); Premium keeps its existing `macos-latest` selection.

Firefox is an existing configured project and has its own account code `f`.
It is explicitly tracked as blocked until the authorized staging account rollout and standalone Firefox trial succeed. Mobile rows are browser
emulation, not actual Android/iOS device, installation, push or OS-integration proof.
Other OS/browser Cartesian combinations were not previously configured in CI and
are not claimed here. Node 24 offline contracts, credential-free discovery and
isolated-runner guard checks precede the live matrix.

Two old blanket CI skips are opt-in runnable through
`PWAPPY_FULL_BRANCH_VERIFICATION=true`, set only by this guarded branch runner:

- Normal `editor-ui-basic`: coordinate drag-and-drop ordering.
- Premium `agent-flow`: manual prompt copy/paste UI.

The normal workflow/local defaults are unchanged. These cases may reveal genuine
headless/browser limitations and must pass or have an explicitly documented
nonphysical supplement; do not classify them as physical-only to hide failures.
Existing platform applicability skips remain: desktop-only mouse/keyboard tests,
mobile-only touch/panels, and the coupon suite restricted to Linux desktop Chromium
to avoid coupon locking. Numeric skipped counts are reported alongside passed and
failed counts, not treated as extra passed tests.

The separate 88-case isolated WebMCP suite, PHP persistence/generated-PWA checks,
and any genuine physical-device checks are **not** run by this live workflow.
The dedicated self-hosted isolated workflow needs a registered eligible runner;
local VMware evidence and this live CI evidence must be reported separately.
Never transfer private application/plugin source or credentials to GitHub-hosted
runners as an unapproved workaround.

## Evidence boundary and failures

The branch config disables trace, screenshot, video and HTML report recording.
The wrapper suppresses arbitrary test stdout/stderr and reads an exact
five-integer count schema from its new temporary directory. Failures also report
up to 256 static, explicitly allowlisted source-relative definition/stack locations
with bounded line numbers and fixed status/kind enums. New source files require
an explicit update to `scripts/branch-safe-sources.json` for location diagnostics.
A separate bounded diagnostics file adds fixed error-class, Playwright-operation
and matcher enums. Only exact schemas from the known `HttpFailure`,
`dashboard-navigation-recovery`, and `EditorStartupFailure` helpers are accepted.
The parent validates these again before printing. Startup evidence contains only
booleans, nullable booleans and fixed save/error states, never store contents.
Unknown native errors stay `unknown`; they are not inferred from arbitrary text.

Public logs contain these validated enums/booleans, coordinates, counts and process
exit code, never exception text, test titles, service bodies, credentials, URLs or
storage state. Raw logs/traces remain prohibited. Offline hostile-input tests and
actual isolated Playwright reporter checks verify this boundary.

Only the existing verified metadata-only `summary.json` is uploaded. It reports
the child process result, not cleanup or overall job success. The aggregate job
requires every matrix job and cleanup to succeed. Blocked tests remain
`not-recorded`, never passed. If the deployed marker changes mid-run, the next test
or cleanup process stops; investigate and restore the intended deployment before
retrying. A GET marker is a point-in-time check, not an infrastructure deployment
lock, so no other deployment may run concurrently during this verification.

Offline check: `node --test offline-tests/branch-verification.test.mjs`.
All guard tests use fabricated events/responses, disposable local files and child
process doubles. They do not authenticate, make network requests or run live tests.


## Native tree regression repairs

The normal reorder test now targets the parent-owned sibling insertion gap and
requires its selected marker before releasing the pointer. It then asserts exact
direct-child order and the total button count, preventing accidental nesting from
passing on flattened descendant order. This is a correction to the test's native
drop coordinates, not a drag/drop skip or relaxed assertion.

The web source contains a separate actual-component regression for pending CSS
commits during native mouse down/up. Source-side browser evidence and the staged
full-suite result must be reported separately; local reproduction does not prove
that every historical CI failure had the same cause.
