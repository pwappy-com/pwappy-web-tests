/** No browser actions here: this runs once per account at a preparation boundary. */
export async function prepareTestPoints(api: any, env: NodeJS.ProcessEnv, identKey: string): Promise<void> {
    const login = new URL(env.PWAPPY_TEST_LOGIN_ENDPOINT || '');
    const read = new URL(env.PWAPPY_TEST_POINTS_READ_ENDPOINT || '');
    if (login.protocol !== 'https:' || read.origin !== login.origin) throw new Error('Invalid test points endpoint configuration');
    const endpoint = new URL(login);
    if (!endpoint.pathname.endsWith('/test-login')) throw new Error('Unexpected test login endpoint');
    endpoint.pathname = endpoint.pathname.replace(/test-login$/, 'test-prepare-points');
    const runId = env.PWAPPY_TEST_RUN_ID;
    const phase = env.PWAPPY_TEST_POINTS_PHASE || 'tests';
    if (!runId || !/^[A-Za-z0-9_-]{1,80}$/.test(runId) || !['tests', 'cleanup'].includes(phase)
        || !env.PWAPPY_TEST_LOGIN_PASSCODE) throw new Error('Missing test points preparation configuration');
    const response = await api.post(endpoint.href, { data: {
        passcode: env.PWAPPY_TEST_LOGIN_PASSCODE, identKey, runId, phase
    }, timeout: 30000 });
    if (!response.ok()) throw new Error(`Test points preparation HTTP ${response.status()}`);
    const result = await response.json();
    if (result?.code !== 200 || result?.status !== 'test_points_prepared'
        || !Number.isSafeInteger(result.target) || result.target < 100
        || !Number.isSafeInteger(result.balance) || result.balance < result.target) {
        throw new Error('Invalid test points preparation result');
    }
    // Use the same authenticated read endpoint as the application, not just the write response.
    const check = await api.get(read.href, { timeout: 30000 });
    if (!check.ok()) throw new Error(`Test points verification HTTP ${check.status()}`);
    const body = await check.json();
    const balance = body?.details?.pwappyPoints;
    if (body?.code !== 200 || !Number.isSafeInteger(balance) || balance < result.target) {
        throw new Error('Test points readback is below the preparation target');
    }
    console.log(`[TestPoints] ${identKey} ${phase}: balance=${balance}, target=${result.target}`);
}
