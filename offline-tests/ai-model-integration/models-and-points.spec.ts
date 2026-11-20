import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-argon', 'gemini-4-neon'];
const balancePath = '/read/v1/pwappy-points';
const historyPath = '/read/v1/point-history';
const apiPaths = new Set([
    balancePath, historyPath,
    '/rest/v1/ai-script-coding', '/read/v1/ai-script-coding',
    '/rest/v1/ai-agent', '/read/v1/ai-agent-status',
]);
const assetTypes = new Map([['/', 'text/html'], ['/components.js', 'text/javascript'], ['/empty.css', 'text/css']]);
const safeOrigin = () => {
    const url = new URL(process.env.PWAPPY_LOCAL_PLUGIN_URL || 'http://127.0.0.1:18779');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' ||
        url.username || url.password || url.port === '') throw new Error('Local integration requires an explicit 127.0.0.1 port');
    return url.origin;
};
function requestPayload(raw: unknown) {
    const encoded = (raw as {payload: string}).payload;
    return JSON.parse(gunzipSync(Buffer.from(decodeURIComponent(encoded), 'base64')).toString());
}

async function openFixture(context: BrowserContext, page: Page) {
    const origin = safeOrigin();
    page.setDefaultTimeout(12000);
    const dist = process.env.PWAPPY_LOCAL_WEB_DIST;
    if (!dist) throw new Error('Set PWAPPY_LOCAL_WEB_DIST to the fixture build output directory');
    const fixtureCookie = process.env.PWAPPY_LOCAL_COOKIE_FILE;
    if (!fixtureCookie) throw new Error('Set PWAPPY_LOCAL_COOKIE_FILE to synthetic local login JSON');
    const cookies = JSON.parse(await fs.readFile(fixtureCookie, 'utf8')) as Record<string, string>;
    await context.addCookies(['pwappy_login', 'pwappy_auth', 'pwappy_ident'].map(name => {
        if (typeof cookies[name] !== 'string' || cookies[name] === '') throw new Error('Invalid fixture cookie: ' + name);
        return {name, value: cookies[name], url: origin};
    }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    if (process.env.PWAPPY_LOCAL_DEBUG) {
        page.on('console', message => console.log(message.type(), message.text().slice(0, 600)));
        page.on('pageerror', error => console.error(error.message));
    }

    // Assets are local fixture files. All allowlisted application requests reach the
    // real local Plugin; no page fixture responds on its behalf.
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort('blockedbyclient');
        const contentType = assetTypes.get(url.pathname);
        if (contentType) {
            const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
            return route.fulfill({body: await fs.readFile(path.join(dist, file)), contentType});
        }
        if (!apiPaths.has(url.pathname)) return route.abort('blockedbyclient');
        if (url.pathname.startsWith('/read/')) {
            // The local WP fixture exposes the same handlers under /rest/.
            return route.continue({ url: origin + url.pathname.replace(/^\/read\//, '/rest/') + url.search });
        }
        return route.continue();
    });
    await page.addInitScript(() => {
        if (localStorage.getItem('pwappy_ai_config_v1')) return;
        localStorage.setItem('pwappy_ai_config_v1', JSON.stringify({
            coder: {model: 'gemini-2.5-flash', temperature: '0.7', useOnsenUI: false},
            agent: {architectModel: 'gemini-2.5-pro', documentationModel: 'gemini-2.5-pro', executionMode: 'auto'},
        }));
    });

    await page.goto(origin + '/?identKey=' + encodeURIComponent(cookies.pwappy_ident) + '&appKey=fixtureapp&version=1');
    const read = async (endpoint: string) => {
        const response = await page.evaluate(async p => {
            const res = await fetch(p, {credentials: 'include'});
            const text = await res.text();
            return {code: res.status, body: text ? JSON.parse(text) : null};
        }, endpoint);
        expect(response.code, endpoint + ': ' + (response.body?.status || 'no response body')).toBe(200);
        expect(response.body.code).toBe(200);
        return response.body.details;
    };
    const balance = async () => Number((await read(balancePath)).pwappyPoints);
    const ledger = async () => ((await read(historyPath + '?page=1&limit=20')).histories as
        {points: number; transactionType: string}[]).filter(e => e.transactionType === 'Use_by_AI_Coding');
    await expect.poll(balance).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    return { origin, balance, ledger, errors };
}

async function expectHistoryUI(page: Page, closing: number, count: number, delta: number) {
    await page.getByRole('button', {name: 'Points', exact: true}).click();
    const points = page.locator('dashboard-point');
    await expect(points.locator('.pp-point-text-container')).toContainText(closing.toLocaleString('ja-JP'));
    await points.getByTitle('ポイント履歴').click();
    const rows = points.locator('.history-item').filter({hasText: 'AIコーディング'});
    await expect(rows).toHaveCount(count);
    const value = await rows.first().locator('.history-points').textContent();
    expect(Number(value?.trim().replaceAll(',', ''))).toBe(delta);
}

test('Coding keeps the selected model after reload and records the actual points used', async ({context, page}) => {
    const {origin, balance, ledger, errors} = await openFixture(context, page);
    const start = await balance();
    const before = (await ledger()).length;
    await page.getByRole('button', {name: 'Coding', exact: true}).click();
    expect(errors).toEqual([]);
    const coder = page.locator('ai-coder-window');
    await coder.locator('#setting-btn').click();
    const select = coder.locator('#setting-window select.modern-select');
    await expect(select.locator('option')).toHaveCount(models.length);
    expect(await select.locator('option').evaluateAll(items => items.map(i => (i as HTMLOptionElement).value))).toEqual(models);
    await expect(select).toHaveValue(models[1]);
    await expect(coder.locator('#setting-window input[type="range"]')).toHaveCount(0);
    await select.selectOption(models[3]);
    await coder.getByRole('button', {name: '設定を適用して戻る'}).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pwappy_ai_config_v1')!).coder.model)).toBe(models[3]);
    await page.reload();
    await page.getByRole('button', {name: 'Coding', exact: true}).click();
    await coder.locator('#setting-btn').click();
    await expect(select).toHaveValue(models[3]);
    await coder.getByRole('button', {name: '設定を適用して戻る'}).click();
    await coder.locator('#user-input').fill('Return a local deterministic script');
    const codingPost = page.waitForResponse(r => r.url() === origin + '/rest/v1/ai-script-coding' && r.request().method() === 'POST');
    await coder.locator('#send-btn').click();
    const coding = await codingPost;
    expect(coding.status(), await coding.text()).toBe(200);
    const codingPayload = requestPayload(coding.request().postDataJSON());
    expect(codingPayload.aiModel).toBe(models[3]);
    expect(codingPayload).not.toHaveProperty('temperature');
    await expect.poll(async () => (await ledger()).length, {timeout: 25000}).toBe(before + 1);
    await expect(coder.locator('code-display')).toHaveCount(1);
    await expect(coder.locator('code-display').getByText('pwappyFixtureResult', {exact: false}).first()).toBeVisible();
    const afterCoding = await balance();
    expect(start - afterCoding).toBe(233);
    expect(Number((await ledger())[0].points)).toBe(afterCoding - start);

    await expectHistoryUI(page, afterCoding, before + 1, -233);
    expect(errors).toEqual([]);
});

test('Agent sends the selected model and records the actual points used', async ({context, page}) => {
    const {origin, balance, ledger, errors} = await openFixture(context, page);
    const start = await balance();
    const before = (await ledger()).length;
    await page.getByRole('button', {name: 'Agent', exact: true}).click();
    const agent = page.locator('agent-chat-window');
    await agent.locator('.settings-btn').click();
    const agentSelect = agent.locator('#agent-model-select');
    expect(await agentSelect.locator('option').evaluateAll(items => items.map(i => (i as HTMLOptionElement).value))).toEqual(models);
    await expect(agentSelect).toHaveValue(models[0]);
    await agentSelect.selectOption(models[2]);
    await agent.getByRole('button', {name: '設定を保存'}).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pwappy_ai_config_v1')!).agent.architectModel)).toBe(models[2]);
    await agent.locator('.user-input').fill('Create a simple local sample app');
    const agentPost = page.waitForResponse(r => r.url() === origin + '/rest/v1/ai-agent' && r.request().method() === 'POST');
    await agent.locator('#send-button').click();
    const sent = await agentPost;
    expect(sent.status(), await sent.text()).toBe(200);
    const agentPayload = requestPayload(sent.request().postDataJSON());
    expect(agentPayload.model).toBe(models[2]);
    expect(agentPayload.config).not.toHaveProperty('temperature');
    await expect.poll(async () => (await ledger()).length, {timeout: 25000}).toBe(before + 1);
    await expect(agent.getByText('ローカル検証用のホーム画面を作ります。', {exact: false}).first()).toBeVisible();
    await expect(agent.getByText('FIXTURE_THOUGHT_SHOULD_NOT_APPEAR', {exact: false})).toHaveCount(0);
    await expect.poll(() => agent.evaluate(el =>
        (el as HTMLElement & {agentState: {status: string}}).agentState.status)).toBe('idle');
    expect((await ledger()).length).toBe(before + 1);
    const afterAgent = await balance();
    expect(start - afterAgent).toBe(310);
    expect(Number((await ledger())[0].points)).toBe(afterAgent - start);
    await expectHistoryUI(page, afterAgent, before + 1, -310);
    expect(errors).toEqual([]);
});
