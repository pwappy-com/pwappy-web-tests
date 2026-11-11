# External MCP lifecycle fixture

`tests/specs/webmcp/external-authoring-lifecycle.spec.ts` uses a separate Node MCP stdio client and Chrome's native CDP WebMCP API. It does not execute tools through page JavaScript. Every application API request is fulfilled by a synthetic in-memory fixture, never an existing account/backend.

Flow: discover dashboard tools → create app → create version → get editor URL → validate/navigate that URL → reject the old dashboard client → reconnect to editor tools → edit a fixed script → save and verify PUT/GET → return to dashboard → reject the old editor client → reconnect → archive → restore → delete the test version → delete the empty test app.

Navigation is performed by the browser/client. `pwappy_get_editor_url` only returns a URL, and WebMCP registrations are document-bound. A real client must handle navigation, rediscovery and authorization itself. No specific AI product is configured by this test, and no production deployment is performed.

The mutation-capable client is **test-only**: `stdio-lifecycle-fixture-client.cjs` requires an exact loopback debugging port, one of two exact fixture URLs, a random per-run marker and matching fresh Playwright browser command-line capability. It allows only the fixed synthetic app/version, script and necessary operations. Old-page clients fail closed. The original `stdio-cdp-client.cjs` remains read-only.

Permanent-delete acknowledgement parameters do not grant user permission. Only disposable test records are removed here. For real targets, the calling agent must obtain action-time confirmation of the concrete app/version and irreversible deletion; app deletion also requires the expected current version list. Archive/restore fee and recurring-cost acknowledgements are distinct.

Run sequentially from this separate project after building the source into `/tmp/pwappy-webmcp-build`:

```sh
npx playwright test -c playwright.webmcp.config.ts external-authoring-lifecycle.spec.ts --headed
```

The dedicated browser uses port 19231 during the test. Do not run concurrent copies or attach it to personal browser profiles. Evidence is saved in the test's output directory. Build logs and source tests are separate from this intercepted browser workflow.


The final fixture starts with only the existing application root, no navigator or page. The actual starter chooser is asserted visible before construction and after verified save; it is never dismissed. External native MCP adds a navigator, an independent page with content, sets its initial-page reference and page attribute, creates a script, validates structure and saves. The saved gzip has one root, one page and one navigator. The chooser remains a visible overlay but does not block these WebMCP operations. No extra client UI click is used to construct or dismiss it.

This blank fixture matches the editor's default root structure, not a claim that the real backend's initial files/authentication were tested. All create/version/save/archive/restore/delete API changes still run only in memory. Returned URL navigation and page reconnection are client operations.
