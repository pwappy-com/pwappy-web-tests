import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getStorageStatePath, generateIdentKey } from './constants';

setup('authenticate', async ({ request }) => {
    const loginUrl = process.env.PWAPPY_TEST_LOGIN_ENDPOINT;
    const passcode = process.env.PWAPPY_TEST_LOGIN_PASSCODE;

    // 現在のワーカーのインデックスを取得
    const workerIndex = process.env.TEST_WORKER_INDEX || '0';
    const identKey = generateIdentKey(workerIndex);
    const storageStatePath = getStorageStatePath(workerIndex);

    if (!loginUrl || !passcode) {
        throw new Error('PWAPPY_TEST_LOGIN_ENDPOINT or PWAPPY_TEST_LOGIN_PASSCODE is not set');
    }

    console.log(`[AuthSetup] Worker ${workerIndex} logging in with identkey: ${identKey}`);

    // ログインリクエスト（identKeyを含める）
    const response = await request.post(loginUrl, {
        data: {
            passcode: passcode,
            identKey: identKey
        }
    });

    // レスポンスチェック
    if (response.status() !== 200) {
        const body = await response.text();
        console.error(`Login failed with status ${response.status()}: ${body}`);
        throw new Error('Login failed');
    }

    const result = await response.json();
    console.log(`Login response for Worker ${workerIndex}:`, result);
    expect(result.status).toBe('success');

    // .auth ディレクトリがない場合は作成
    const authDir = path.dirname(storageStatePath);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    // 取得したCookie情報をワーカー固有のファイルに保存
    await request.storageState({ path: storageStatePath });
});