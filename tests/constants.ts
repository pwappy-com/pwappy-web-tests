import path from 'path';
import fs from 'fs';
import { request } from '@playwright/test';

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
    const osCode = getOsCode();
    const suffix = String(workerIndex).padStart(3, '0');
    // 合計7文字
    return `pw${osCode}${browserCode}${suffix}`.slice(0, 7);
};

/**
 * 引数の順番を (workerIndex, browserCode) に合わせます。
 */
export async function ensureAuthenticated(
    workerIndex: string | number = process.env.TEST_WORKER_INDEX || '0',
    browserCode: string = 'x'
): Promise<string> {
    const storageStatePath = getStorageStatePath(workerIndex, browserCode);

    if (fs.existsSync(storageStatePath)) {
        const content = fs.readFileSync(storageStatePath, 'utf-8').trim();
        if (content !== '{}' && content !== '') {
            return storageStatePath;
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
        const body = await response.text();
        await apiContext.dispose();
        throw new Error(`On-demand login failed for Worker ${workerIndex} with status ${response.status()}: ${body}`);
    }

    const result = await response.json();
    console.log(`[OnDemandAuth] Login success for Worker ${workerIndex}:`, result);

    await apiContext.storageState({ path: storageStatePath });
    await apiContext.dispose();

    return storageStatePath;
}