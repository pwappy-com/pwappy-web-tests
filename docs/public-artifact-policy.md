# Public Actions artifact boundary

Actions artifacts are downloadable by signed-in readers of a public repository.
Raw Playwright traces can contain authenticated context storage state even when
trace snapshots are disabled. Screenshots, video, HTML, bodies, attachments and
free-form errors can also contain private data. Filename filtering and regex
redaction do not establish that these formats are safe to publish.

## Containment policy (normal and Premium)

- **Do not upload any test-generated file.** This includes `test-results/`, cleanup
  results, `playwright-report/`, `.auth/`, ZIPs, traces and all media/resources.
- `scripts/artifact-safe-summary.mjs` is a **workflow metadata summary generator**,
  not a trace sanitizer. It never opens any of those inputs, including malformed,
  nested, symlinked, oversized or traversal-containing archives. There is no
  archive parser, decompression, media sanitization or extracted raw-data copy.
- Only fixed schema version/policy constants, validated GitHub run ID/attempt,
  fixed suite/OS/browser enums and the numeric test-process exit code are emitted.
  Missing exit code is `not-recorded`, not success. This says nothing about cleanup
  or overall job success. No test names, URLs, request headers, cookies, context
  storage state, bodies, error messages, console output or environment secrets are
  copied. Secret-valued environment variables are not collected or inspected.
- Create an unpredictable fresh directory under `RUNNER_TEMP`, exclusively write
  `summary.json`, read it back and verify the exact expected schema/bytes before
  publishing outputs. Upload that **one exact file**, not a glob/directory.
- Generation runs with `always()`. Upload requires successful step outcome AND
  explicit verification AND a nonempty output path. Any validation/I/O failure
  emits a constant error and blocks upload; missing upload file is an error.
- No extra HTTP requests, test retries, service mutations or dependency installs.
  Node 24 is already provisioned in both jobs. Test assertions, cleanup, schedule,
  timeouts and operating defaults are unchanged.

## Diagnostic tradeoff and limits

The public artifact intentionally loses trace replay, screenshots/video, action
timings, stack traces and attachment details. Existing Actions test console logs
remain available, but **this policy does not sanitize existing logs, old artifacts,
caches, or revoke already exposed credentials**. Those need separate containment.
Do not restore raw evidence uploads for debugging. Any richer public reporter
requires a separate reviewed scalar-only schema and adversarial tests. A private
evidence channel requires explicit authorization and a retention/access policy.

The boundary assumes trusted checked-out workflow/script and runner processes;
it is not a sandbox against malicious code concurrently modifying the generated
file. It prevents arbitrary test/service data from entering the upload path.

Offline verification: `node --test offline-tests/artifact-safe-summary.test.mjs`.
Fixtures contain synthetic canaries only. No real artifact or credential belongs
in source, fixtures, patches or public comments.
