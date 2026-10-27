import type { BrowserContext, Page, Response } from '@playwright/test';

// Passive, bounded evidence only. Never fetch bodies/allHeaders, intercept, or retry.
const observed = new WeakSet<BrowserContext>();
export const HTTP_FAILURE_RECORD_LIMIT = 20;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const RESOURCES = new Set(['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'websocket', 'eventsource']);

export function configuredOrigins(env: Record<string, string | undefined>): Set<string> {
    const origins = new Set<string>();
    for (const value of [env.PWAPPY_TEST_BASE_URL, env.PWAPPY_TEST_LOGIN_ENDPOINT]) {
        try {
            if (!value) continue;
            const url = new URL(value);
            if (url.protocol === 'https:' || url.protocol === 'http:') origins.add(url.origin);
        } catch { /* Invalid configuration gives no observation, never a fallback origin. */ }
    }
    return origins;
}

export function retryAfterKind(value: string | undefined): { kind: string; seconds?: number; capped?: boolean } {
    if (value === undefined) return { kind: 'absent' };
    if (/^\d{1,9}$/.test(value)) return { kind: 'seconds', seconds: Math.min(Number(value), 86400), capped: Number(value) > 86400 };
    // Recognize strict IMF-fixdate only; do not output attacker-controlled dates.
    if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toUTCString() === value) return { kind: 'date' };
    return { kind: 'invalid' };
}

export function classifyHttpFailure(response: Response, origins: ReadonlySet<string>) {
    const status = response.status();
    if (!Number.isInteger(status) || status < 500 || status > 599) return null;
    const url = new URL(response.url());
    if (!origins.has(url.origin)) return null;
    const request = response.request();
    const method = request.method();
    const resource = request.resourceType();
    // headers() reads the already available Playwright event snapshot, not the wire.
    const headers = response.headers();
    const server = headers['server'] || '';
    const serverFamily = /^(?:nginx)(?:\/|$)/i.test(server) ? 'nginx'
        : /^apache(?:\/|$)/i.test(server) ? 'apache'
        : /^cloudflare$/i.test(server) ? 'cloudflare'
        : /^Microsoft-IIS(?:\/|$)/i.test(server) ? 'iis'
        : /^LiteSpeed$/i.test(server) ? 'litespeed' : 'unknown';
    const mime = (headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    const contentType = mime === 'application/json' || /^application\/[a-z0-9.-]+\+json$/.test(mime) ? 'json'
        : mime === 'text/html' ? 'html' : mime === 'text/plain' ? 'text'
        : mime === '' ? 'absent' : 'other';
    const pathKind = /^\/pwappy-api\/(?:read|rest)\/v1\/editor-json(?:\/|$)/.test(url.pathname) ? 'editor-json'
        : /^\/pwappy-api\/(?:read|rest)\/v1\/publish-list(?:\/|$)/.test(url.pathname) ? 'publish-list'
        : url.pathname.startsWith('/pwappy-api/') ? 'pwappy-api'
        : url.pathname.startsWith('/wp-json/') ? 'wordpress-api'
        : resource === 'document' ? 'document' : 'other';
    return { status, method: METHODS.has(method) ? method : 'other', resource: RESOURCES.has(resource) ? resource : 'other',
        pathKind, serverFamily, retryAfter: retryAfterKind(headers['retry-after']), contentType };
}

/** Install before navigation; includes future pages in this context, not future contexts. */
export function observeHttpFailures(context: BrowserContext, env = process.env,
    emit: (line: string) => void = line => console.log(line)): void {
    try {
        if (observed.has(context)) return;
        const origins = configuredOrigins(env);
        if (!origins.size) return;
        observed.add(context);
        let records = 0;
        const cleanup = () => {
            try { context.off('response', onResponse); } catch { /* Diagnostic only. */ }
            try { context.off('close', cleanup); } catch { /* Diagnostic only. */ }
        };
        const onResponse = (response: Response) => {
            try {
                if (records >= HTTP_FAILURE_RECORD_LIMIT) return;
                const record = classifyHttpFailure(response, origins);
                if (!record) return;
                records++;
                if (records === HTTP_FAILURE_RECORD_LIMIT) cleanup();
                emit('[HttpFailure] ' + JSON.stringify(record));
            } catch { /* Never replace the original application/test failure. */ }
        };
        try {
            context.on('close', cleanup);
            context.on('response', onResponse);
        } catch { cleanup(); }
    } catch { /* Closed contexts / invalid doubles must not change test behavior. */ }
}

/** Keep even context lookup failure diagnostic-only. */
export function observePageHttpFailures(page: Page): void {
    try { observeHttpFailures(page.context()); } catch { /* Diagnostic only. */ }
}
