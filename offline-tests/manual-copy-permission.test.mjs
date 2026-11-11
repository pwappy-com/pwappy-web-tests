// Keep the permission boundary and direct-run guard in normal offline CI.
// This import runs only contract checks, never the browser harness.
import './manual-copy/permission-scope.check.cjs';
