// Temporary scalar-only timing for the existing four-case profiling scope.
// Inclusive parent phases overlap their children; never sum all phase durations.
// Completion-only observations: a missing line is unknown, never a zero duration.
// No timers, listeners, browser data, error strings, retries or new await boundaries.
const PHASES = new Set([
    'suite-setup', 'suite-cleanup', 'fixture-dashboard', 'fixture-card', 'fixture-use', 'fixture-close',
    'editor-launch-ready', 'editor-domcontentloaded', 'editor-snapshot-check',
    'editor-starter-check', 'editor-final-ready', 'editor-loading-hidden',
    'webkit-popup-target', 'webkit-page-create', 'webkit-page-navigate', 'native-popup',
    'page-menu-click', 'pair-setup', 'property-tab', 'monaco-visible',
    'monaco-write', 'native-monaco-focus'
]);
const noop = () => {};

export function startStylePhase(phase, options = {}) {
    try {
        const {
            scope = process.env.TEST_SCOPE,
            now = () => performance.now(),
            emit = line => console.log(line)
        } = options;
        if (scope !== 'style-ownership-regression' || !PHASES.has(phase)) return noop;
        const started = now();
        if (!Number.isFinite(started)) return noop;
        let completed = false;
        return () => {
            if (completed) return;
            completed = true;
            try {
                const elapsed = now() - started;
                if (!Number.isFinite(elapsed) || elapsed < 0) return;
                emit('[StylePhase] ' + JSON.stringify({
                    phase, outcome: 'returned', elapsedMs: Math.min(600000, Math.round(elapsed)), capped: elapsed > 600000
                }));
            } catch { /* Observations must never replace an operation result. */ }
        };
    } catch { return noop; }
}
