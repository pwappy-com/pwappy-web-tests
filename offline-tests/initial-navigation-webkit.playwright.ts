// Real WebKit fail-closed proof, not a reproduction of the hosted outage.
// Offline emulation emits a DIFFERENT native error; positive retry is unit-tested only.
// Only this standalone test fixture toggles emulated offline state.
import { test as base, expect, type Page, type Request } from '@playwright/test';
import { createServer } from 'node:http';
import { gotoInitialDashboard } from '../tests/tools/initial-dashboard-navigation';

type LoopbackApp = { url: string; documents: number; posts: number; status: number };
const test = base.extend<{ app: LoopbackApp }>({
    app: async ({}, use) => {
        const app = { url: '', documents: 0, posts: 0, status: 200 };
        const server = createServer((request, response) => {
            if (request.method === 'GET' && request.url === '/dashboard') {
                app.documents++;
                response.writeHead(app.status, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
                response.end(app.status === 200
                    ? '<!doctype html><div id="ready">loading</div><script>fetch("/daily-report",{method:"POST"}).then(()=>{document.querySelector("#ready").textContent="ready";});</script>'
                    : '<!doctype html><div id="status">server error</div>');
            } else if (request.method === 'POST' && request.url === '/daily-report') {
                app.posts++;
                response.writeHead(204);
                response.end();
            } else {
                response.writeHead(404);
                response.end();
            }
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Loopback listener unavailable');
        app.url = 'http://127.0.0.1:' + address.port + '/dashboard';
        try { await use(app); }
        finally {
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                // Failed WebKit navigation can leave an unclosed loopback socket.
                server.closeAllConnections();
            });
        }
    },
});

function observeNativeGoto(page: Page, healFirstFailure = false) {
    const state = { attempts: 0, active: false, errors: [] as unknown[], failedDocuments: 0, commits: 0 };
    const requestFailed = (request: Request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) state.failedDocuments++;
    };
    // The native request/frame events remain untouched; only forward the public goto call.
    page.on('requestfailed', requestFailed);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) state.commits++; });
    const forwardingPage = new Proxy(page, {
        get(target, property) {
            if (property === 'goto') return async (...args: Parameters<Page['goto']>) => {
                expect(state.active).toBe(false);
                state.active = true;
                state.attempts++;
                try { return await page.goto(...args); }
                catch (error) {
                    state.errors.push(error);
                    if (state.attempts === 1 && healFirstFailure) {
                        // Test-only restoration AFTER real first goto rejects, BEFORE forwarding
                        // the same rejection. Production recovery never changes network state.
                        await page.context().setOffline(false);
                    }
                    throw error;
                } finally { state.active = false; }
            };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    return { page: forwardingPage, state };
}

const recovery = () => ({ expectedOnline: true, recoveryDeadline: performance.now() + 15000 });
const firstLine = (error: unknown) => error instanceof Error ? error.message.split('\n')[0] : '';

test('ordinary online setup performs one document GET and one POST', async ({ page, app }) => {
    expect(page.url()).toBe('about:blank');
    const observed = observeNativeGoto(page);
    const response = await gotoInitialDashboard(observed.page, app.url, recovery());
    expect(response?.status()).toBe(200);
    await expect(page.locator('#ready')).toHaveText('ready');
    expect(observed.state.attempts).toBe(1);
    expect(observed.state.failedDocuments).toBe(0);
    expect(observed.state.errors).toHaveLength(0);
    expect(app.documents).toBe(1);
    expect(app.posts).toBe(1);
});

test('unmatched emulated-offline error is preserved even if fixture restores transport', async ({ page, context, app }) => {
    const observed = observeNativeGoto(page, true);
    await context.setOffline(true);
    let caught: unknown;
    try { await gotoInitialDashboard(observed.page, app.url, recovery()); } catch (error) { caught = error; }
    expect(observed.state.attempts).toBe(1);
    expect(observed.state.errors).toHaveLength(1);
    expect(caught).toBe(observed.state.errors[0]);
    expect(firstLine(caught)).toBe('page.goto: WebKit encountered an internal error');
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    expect(app.documents).toBe(0);
    expect(app.posts).toBe(0);
});

test('persistent emulated offline fails closed without changing network state', async ({ page, context, app }) => {
    const observed = observeNativeGoto(page);
    await context.setOffline(true);
    let caught: unknown;
    try { await gotoInitialDashboard(observed.page, app.url, recovery()); } catch (error) { caught = error; }
    expect(observed.state.attempts).toBe(1);
    expect(observed.state.errors).toHaveLength(1);
    expect(caught).toBe(observed.state.errors[0]);
    expect(firstLine(caught)).toBe('page.goto: WebKit encountered an internal error');
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(app.documents).toBe(0);
    expect(app.posts).toBe(0);
});

test('intentional offline caller never opts into recovery or resets state', async ({ page, context, app }) => {
    const observed = observeNativeGoto(page);
    await context.setOffline(true);
    let caught: unknown;
    try { await gotoInitialDashboard(observed.page, app.url, { ...recovery(), expectedOnline: false }); }
    catch (error) { caught = error; }
    expect(observed.state.attempts).toBe(1);
    expect(observed.state.errors).toHaveLength(1);
    expect(caught).toBe(observed.state.errors[0]);
    expect(firstLine(caught)).toBe('page.goto: WebKit encountered an internal error');
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(app.documents).toBe(0);
    expect(app.posts).toBe(0);
});

test('committed HTTP 500 response is returned, never retried', async ({ page, app }) => {
    app.status = 500;
    const observed = observeNativeGoto(page);
    const response = await gotoInitialDashboard(observed.page, app.url, recovery());
    expect(response?.status()).toBe(500);
    expect(observed.state.attempts).toBe(1);
    expect(observed.state.commits).toBe(1);
    expect(app.documents).toBe(1);
    expect(app.posts).toBe(0);
});
