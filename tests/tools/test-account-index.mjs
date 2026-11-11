/** Keep an account stable when Playwright replaces a failed worker. */
export function resolveAccountIndex(fallback = '0', env = process.env) {
    const value = env.PWAPPY_TEST_ACCOUNT_INDEX ?? env.TEST_PARALLEL_INDEX ?? fallback;
    if (!/^(0|[1-9][0-9]{0,2})$/.test(String(value))) throw new Error('Invalid test account index');
    return String(value);
}
