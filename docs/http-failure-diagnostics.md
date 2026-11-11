# Passive HTTP 5xx evidence (snapshot-independent)

`tests/tools/http-failure-diagnostics.ts` records `[HttpFailure]` JSON to normal
Playwright/Actions output, including when trace snapshots are disabled. This is
operator evidence, **not a fix, retry, or proof of the cause** of HTTP 503/507.

- Installed before `gotoDashboard` navigation, before `openEditor`, and when an
  `EditorHelper` is constructed. One context-level response listener (WeakSet
  deduplicated) includes existing and future pages/popups in that context.
- Only exact HTTP(S) origins configured by `PWAPPY_TEST_BASE_URL` and
  `PWAPPY_TEST_LOGIN_ENDPOINT` are eligible. Invalid/missing configuration
  fails closed. These settings must continue to target staging; the helper
  cannot independently establish a host's deployment tier.
- Only status 500–599; maximum 20 records per context, then listeners removed.
  Context close also removes listeners. No browser-global patching, routes,
  request interception, extra network calls, response body reads, timers,
  retries, or changes to existing assertions/failure propagation.
- Reads synchronous, already-available `response.headers()` metadata, not
  `allHeaders()`, `headerValue()`, `body()` or `text()`. Metadata/logging errors
  are swallowed. Missing/suppressed browser headers remain unknown.
- Output is only status, allowlisted method/resource type, coarse path kind,
  server family enum, content-type family, and Retry-After classification.
  Numeric Retry-After is capped at 86,400 seconds; `capped: true` marks
  truncation and `capped: false` marks an exact numeric value; a strict valid IMF-fixdate is classified as `date` without
  emitting its value. Unknown/invalid values are not reproduced.
- No raw URLs, origins, queries, paths, account/app IDs, cookies, authorization,
  raw server/version, Via, request IDs or arbitrary headers/bodies are emitted.

## Coverage gaps and interpretation

This is not universal network capture. Contexts that never pass the hooks,
responses before installation, standalone APIRequestContext authentication and
point preparation, external/generated-page origins not in the configured
origin set, requests that fail before HTTP response headers, and records beyond
the per-context cap are not covered. Separate new browser contexts require their
own hook; no monkeypatch is used to force coverage. EditorHelper construction
cannot recover earlier editor navigation responses unless another hook already
ran. Output absence is **not** proof of absence of server failures.

Do not identify WordPress maintenance solely from a 503 or Retry-After value.
Current b240 authentication code reads status only; this change deliberately does
not add a body fetch or change authentication errors. The prior main-run body
`wp_die` / `Briefly unavailable for scheduled maintenance. Check back in a minute.`
was separate observed evidence. Provider/server family does not identify the
updater, host responsible, resource limit, or underlying failure cause.

Offline verification: `node --test offline-tests/http-failure-diagnostics.test.mjs`.
Doubles test privacy, exact-origin filtering, no active request/body operations,
listener deduplication/cleanup/cap, and fail-safe metadata/output handling. These
checks do not substitute for real-browser CI validation of event delivery.
