import type { Page, Request, Response, Frame } from '@playwright/test';

const OFFLINE_FAILURE = 'The Internet connection appears to be offline.';

type RecoveryOptions = {
    // Callers must opt in only for setup that is explicitly expected to be online.
    expectedOnline: boolean;
    // Monotonic deadline shared with the caller's existing dashboard-init window.
    recoveryDeadline: number;
};

/**
 * Recover only a failed, uncommitted initial document GET. This does not retry
 * application initialization, HTTP errors, assertions, or any mutating action.
 */
export async function gotoInitialDashboard(
    page: Page, target: string, options: RecoveryOptions
): Promise<Response | null> {
    const browser = page.context().browser();
    if (!options.expectedOnline || browser?.browserType().name() !== 'webkit' ||
        page.url() !== 'about:blank') {
        return await page.goto(target, { waitUntil: 'domcontentloaded' });
    }

    const mainFrame = page.mainFrame();
    let canonicalTarget = '';
    try { canonicalTarget = new URL(target).href; } catch { /* Preserve native goto errors. */ }
    let documentRequest: Request | undefined;
    let documentCount = 0;
    let failedDocument = false;
    let responseSeen = false;
    let committed = false;
    let nonGetSeen = false;
    let crashed = false;
    let closed = false;
    let disconnected = false;
    const onRequest = (request: Request) => {
        if (request.method() !== 'GET') nonGetSeen = true;
        if (!request.isNavigationRequest() || request.frame() !== mainFrame) return;
        documentCount++;
        if (request.method() === 'GET' && request.resourceType() === 'document' &&
            request.url() === canonicalTarget && request.redirectedFrom() === null) {
            documentRequest = request;
        }
    };
    const onFailed = (request: Request) => {
        if (request === documentRequest &&
            request.failure()?.errorText === OFFLINE_FAILURE) failedDocument = true;
    };
    const onResponse = () => { responseSeen = true; };
    const onCommitted = (frame: Frame) => { if (frame === mainFrame) committed = true; };
    const onCrash = () => { crashed = true; };
    const onClose = () => { closed = true; };
    const onDisconnected = () => { disconnected = true; };
    const remaining = () => options.recoveryDeadline - performance.now();
    const blockedReason = () => {
        if (!failedDocument || documentCount !== 1) return 'unverified_document' as const;
        if (responseSeen || committed || nonGetSeen || page.url() !== 'about:blank') return 'navigation_progressed' as const;
        if (crashed || closed || disconnected || page.isClosed() || !browser.isConnected()) return 'target_unhealthy' as const;
        const available = remaining();
        if (!Number.isFinite(available) || !(available > 0)) return 'budget_exhausted' as const;
        return null;
    };
    const report = (event: 'blocked' | 'eligible' | 'recovered' | 'failed',
        reason: 'offline_precommit' | 'unverified_document' | 'navigation_progressed' |
            'target_unhealthy' | 'budget_exhausted',
        attempt: 1 | 2) => {
        // Fixed enums/booleans only: never URLs, native errors, headers, or bodies.
        console.log('[dashboard-navigation-recovery]', JSON.stringify({
            event, reason, attempt, failedDocument, responseSeen, committed,
            nonGetSeen, crashed, closed, disconnected
        }));
    };
    try {
        page.on('request', onRequest);
        page.on('requestfailed', onFailed);
        page.on('response', onResponse);
        page.on('framenavigated', onCommitted);
        page.on('crash', onCrash);
        page.on('close', onClose);
        browser.on('disconnected', onDisconnected);
        try {
            // The first attempt retains the caller's original navigation timeout.
            return await page.goto(target, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            if (!(error instanceof Error) ||
                error.message.split('\n')[0] !== 'page.goto: ' + OFFLINE_FAILURE) throw error;
            const blocked = blockedReason();
            if (blocked) {
                report('blocked', blocked, 1);
                throw error;
            }
            report('eligible', 'offline_precommit', 1);
            const timeout = remaining();
            if (!Number.isFinite(timeout) || !(timeout > 0)) {
                report('blocked', 'budget_exhausted', 1);
                throw error;
            }
            try {
                const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
                report('recovered', 'offline_precommit', 2);
                return response;
            } catch (retryError) {
                report('failed', 'offline_precommit', 2);
                throw retryError;
            }
        }
    } finally {
        page.off('request', onRequest);
        page.off('requestfailed', onFailed);
        page.off('response', onResponse);
        page.off('framenavigated', onCommitted);
        page.off('crash', onCrash);
        page.off('close', onClose);
        browser.off('disconnected', onDisconnected);
    }
}
