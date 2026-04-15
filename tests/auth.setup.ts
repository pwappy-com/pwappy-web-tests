import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { STORAGE_STATE } from './constants';

setup('authenticate', async ({ request }) => {
    const loginUrl = process.env.PWAPPY_TEST_LOGIN_ENDPOINT;
    const passcode = process.env.PWAPPY_TEST_LOGIN_PASSCODE;

    if (!loginUrl || !passcode) {
        throw new Error('PWAPPY_TEST_LOGIN_ENDPOINT or PWAPPY_TEST_LOGIN_PASSCODE is not set');
    }

    // ログインリクエスト
    const response = await request.post(loginUrl, {
        data: {
            passcode: passcode
        }
    });

    // レスポンスチェック
    if (response.status() !== 200) {
        const body = await response.text();
        console.error(`Login failed with status ${response.status()}: ${body}`);
        throw new Error('Login failed');
    }

    const result = await response.json();
    console.log('Login response:', result);
    expect(result.status).toBe('success');

    // .auth ディレクトリがない場合は作成
    const authDir = path.dirname(STORAGE_STATE);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    // 取得したCookie情報などをファイルに保存
    await request.storageState({ path: STORAGE_STATE });
});