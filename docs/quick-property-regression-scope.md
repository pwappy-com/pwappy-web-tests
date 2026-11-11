# Focused quick-property regression scope

Manual `test_scope=quick-property-regression` selects the entire existing
`tests/specs/normal/editor-quick-property-editor.spec.ts` file. It does not add a
grep filter, skip an assertion, or modify the scenarios or helpers.

The file currently contains seven scenarios covering property editing and cancel,
color rollback, Flex/FlexItem availability, metadata autosave and duplicate-ID
validation, deletion guards, border edits, and selection fallback. The metadata
autosave scenario includes the explanation-input behavior under investigation.

Use the existing OS/browser selection, workers, matrix parallelism, retries,
point preparation and trace controls to record reproducible staging runs. The
same normal-suite authentication and post-run cleanup apply. This scope is not a
full normal-suite pass and says nothing about Premium. Do not compare counts as
though it were the full suite.

Scheduled and omitted/default scope remains `all`; the existing editor regression
and points-smoke paths remain available. Unknown normal scope values fail rather
than silently running the full suite.

Offline argument-selection checks:

```sh
node --test offline-tests/quick-property-scope.test.mjs
```

These checks execute only the workflow argument selector in local Bash. They do
not execute Playwright or prove staging behavior. Verify the exact published
workflow revision and live test/cleanup results separately.
