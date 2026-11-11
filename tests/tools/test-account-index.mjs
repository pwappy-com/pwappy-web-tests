/** Keep an account stable when Playwright replaces a failed worker. */
export function resolveAccountIndex(fallback = '0', env = process.env) {
    const value = env.PWAPPY_TEST_ACCOUNT_INDEX ?? env.TEST_PARALLEL_INDEX ?? fallback;
    if (!/^(0|[1-9][0-9]{0,2})$/.test(String(value))) throw new Error('Invalid test account index');
    // Main public CI preflights exactly these parallel slots before any tests start.
    if (env.PWAPPY_MAIN_WORKERS !== undefined && env.PWAPPY_TEST_POINTS_PHASE !== 'cleanup'
        && (!/^[1-9][0-9]{0,2}$/.test(env.PWAPPY_MAIN_WORKERS)
            || Number(env.PWAPPY_MAIN_WORKERS) > 997 || Number(value) >= Number(env.PWAPPY_MAIN_WORKERS))) {
        throw new Error('Test account is outside the preflighted worker range');
    }
    return String(value);
}
