import path from 'path';
import fs from 'fs';
import { resolveAccountIndex } from './tools/test-account-index.mjs';
import { request } from '@playwright/test';
import { prepareTestPoints } from './tools/test-point-preparation';

const getOsCode = (): string => {
    const suffix = (process.env.TEST_RUN_SUFFIX || '').toLowerCase();
    if (suffix.includes('ubuntu')) return 'u';
    if (suffix.includes('win')) return 'w';
    if (suffix.includes('macos')) return 'm';
    return 'l'; // ローカル環境 (local)
};

/**
 * 第1引数を workerIndex に戻し、第2引数を browserCode にします。
 * これにより、テストファイル側の getStorageStatePath(workerIndex) は修正不要になります。
 */
export const getStorageStatePath = (
    workerIndex: string | number = process.env.TEST_WORKER_INDEX || '0',
    browserCode: string = 'x'
): string => {
    workerIndex = resolveAccountIndex(workerIndex);
    const osCode = getOsCode();
    // 例: .auth/user-u-c-0.json
    const storageStatePath = path.join(process.cwd(), `.auth/user-${osCode}-${browserCode}-${workerIndex}.json`);

    const authDir = path.dirname(storageStatePath);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }
    if (!fs.existsSync(storageStatePath)) {
        fs.writeFileSync(storageStatePath, '{}', 'utf-8');
    }

    return storageStatePath;
};

/**
 * 引数の順番を (workerIndex, browserCode) に合わせます。
 */
export const generateIdentKey = (
    workerIndex: string | number = process.env.TEST_WORKER_INDEX || '0',
    browserCode: string = 'x'
): string => {
    workerIndex = resolveAccountIndex(workerIndex);
    const osCode = getOsCode();
    const suffix = String(workerIndex).padStart(3, '0');
    // 合計7文字
    return `pw${osCode}${browserCode}${suffix}`.slice(0, 7);
};

/**
 * 引数の順番を (workerIndex, browserCode) に合わせます。
 */
async function authenticateSession(
    workerIndex: string | number = process.env.TEST_WORKER_INDEX || '0',
    browserCode: string = 'x'
): Promise<string> {
    workerIndex = resolveAccountIndex(workerIndex);
    const storageStatePath = getStorageStatePath(workerIndex, browserCode);

    if (fs.existsSync(storageStatePath)) {
        const content = fs.readFileSync(storageStatePath, 'utf-8').trim();
        if (content !== '{}' && content !== '') {
            // A non-empty storage file can contain an expired authentication token.
            // Decode only to decide whether to refresh; the server still verifies it.
            try {
                const state = JSON.parse(content);
                const cookieName = process.env.PWAPPY_TEST_AUTH_COOKIE_NAME || 'pwappy_auth';
                const authCookie = state.cookies?.find((cookie: { name: string }) => cookie.name === cookieName);
                const parts = authCookie?.value?.split('.');
                const payload = parts?.length === 3
                    ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
                    : null;
                const nowSeconds = Date.now() / 1000;
                if (Number.isSafeInteger(payload?.exp) && payload.exp > nowSeconds + 60
                    && (authCookie.expires === -1 || authCookie.expires > nowSeconds + 60)) {
                    return storageStatePath;
                }
            } catch {
                // Invalid cached state is replaced by a normal authenticated login.
            }
        }
    }

    const loginUrl = process.env.PWAPPY_TEST_LOGIN_ENDPOINT;
    const passcode = process.env.PWAPPY_TEST_LOGIN_PASSCODE;

    if (!loginUrl || !passcode) {
        throw new Error('PWAPPY_TEST_LOGIN_ENDPOINT or PWAPPY_TEST_LOGIN_PASSCODE is not set');
    }

    const identKey = generateIdentKey(workerIndex, browserCode);
    console.log(`[OnDemandAuth] Valid session not found. Logging in for Worker ${workerIndex} (identkey: ${identKey})...`);

    const apiContext = await request.newContext();
    const response = await apiContext.post(loginUrl, {
        data: {
            passcode: passcode,
            identkey: identKey
        }
    });

    if (response.status() !== 200) {
        await apiContext.dispose();
        throw new Error(`On-demand login failed for Worker ${workerIndex} with status ${response.status()}`);
    }

    console.log(`[OnDemandAuth] Login success for Worker ${workerIndex}`);

    await apiContext.storageState({ path: storageStatePath });
    await apiContext.dispose();

    return storageStatePath;
}
// One preparation per account/process/phase, including cached authentication sessions.
const preparations = new Map<string, Promise<void>>();
export async function ensureAuthenticated(
    workerIndex: string | number = process.env.TEST_WORKER_INDEX || '0',
    browserCode: string = 'x'
): Promise<string> {
    workerIndex = resolveAccountIndex(workerIndex);
    const storageStatePath = await authenticateSession(workerIndex, browserCode);
    if (process.env.PWAPPY_TEST_POINTS_ENABLED !== 'true') return storageStatePath;
    const identKey = generateIdentKey(workerIndex, browserCode);
    const key = [process.env.PWAPPY_TEST_RUN_ID, identKey, process.env.PWAPPY_TEST_POINTS_PHASE || 'tests'].join(':');
    if (!preparations.has(key)) {
        preparations.set(key, (async () => {
            const api = await request.newContext({ storageState: storageStatePath });
            try { await prepareTestPoints(api, process.env, identKey); }
            finally { await api.dispose(); }
        })());
    }
    await preparations.get(key);
    return storageStatePath;
}

