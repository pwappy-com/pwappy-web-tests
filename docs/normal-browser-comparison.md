# Normal-browser-only diagnostic selection

`normal_browser` is a manual choice: `all` (default), `webkit`, or
`mobile-safari`. It filters the existing OS-selected **normal** matrix, not the
Playwright binary. For example, `os=macos-latest` plus
`normal_browser=mobile-safari` retains only the Mobile Safari entry. Its OS,
browser, binary, runner mapping (`macos-26-intel`), account/concurrency labels,
and other entry properties remain unchanged. There are now nine manual inputs.

- `test_suite=normal`: filter normal jobs.
- `test_suite=all`: filter normal jobs; premium retains its original OS-selected
  matrix. An invalid/empty normal selection fails preparation before either
  service-facing job can start.
- `test_suite=premium`: ignore `normal_browser`, including unsupported values;
  premium behavior and its original matrix are unchanged.
- Scheduled runs ignore this selector. Missing/empty manual values mean `all`.
- `webkit` or `mobile-safari` with Ubuntu/Windows selects no normal jobs and
  fails preparation rather than silently skipping the requested test. Unknown
  OS values with a normal request also fail before service calls.

Only the new selector is environment-transported and enum-validated here; this
change does not claim to harden unrelated existing workflow inputs. Validation
runs within `prepare-matrix` after the existing matrix and suite flags, without
checkout, dependency installation, credentials, or application calls. Normal
uses a new `normal_matrix` output; premium continues using the original `matrix`.

## Possible controlled comparison (not dispatched)

After the current run and cleanup finish, a separately authorized diagnostic
could compare Mobile Safari `workers=2` versus `workers=1`, with
`test_suite=normal`, `os=macos-latest`, `normal_browser=mobile-safari`, and the
same test code, test scope, retries, trace setting, account/data scope and service
state. Keep the matrix-parallelism setting and every other input fixed. Record
native input failure evidence, HTTP failures, duration and runner resource
samples. Do not infer a cause from a single pass. This selector alone neither
runs tests nor changes workers, assertions, cleanup, permissions or secrets.

The previous inputs cannot isolate Mobile Safari: `os=macos-latest` selects both
Safari projects, while `matrix_parallelism=1` merely serializes both jobs.

## Offline verification

Run `node --test offline-tests/normal-browser-matrix.test.mjs`.
It executes the actual extracted preparation/filter scripts using synthetic
inputs in isolated temporary directories. It covers all suite/OS/browser
combinations, scheduled and missing inputs, invalid selectors and shell-like
strings, empty intersections, and preservation of matrix properties.
Structural checks verify separate normal/premium wiring and nine inputs.
A reverse-diff SHA-256 assertion proves all workflow content outside the four
selector additions is byte-identical to the verified remote baseline:
`8ff119000d9441cc75dd68183487fc4d192e29c7`, workflow Git blob
`ea7505e6ed6bca117ecee897ded7f6a5a3ea84ac`.

These checks do not execute GitHub's expression engine or run browser/service
E2E tests, and do not establish whether lower worker concurrency helps.
