import https from 'node:https';
import { pathToFileURL } from 'node:url';

// Observational only: no browser/auth imports, retries, redirects, or test decisions.
// GET matches static-resource traffic; stop at response headers without consuming
// or retaining the body. Timings are cumulative offsets from request start;
// missing milestones are null. firstHeadersMs is not body-download time.
// Node HTTPS is not WebKit/CFNetwork or authenticated API health evidence.
export const CONTROL_URL = 'https://raw.githubusercontent.com/github/gitignore/0e5d690153ca3da8a4a1aef2d053406f408f531c/Global/Archives.gitignore';
export const REQUEST_LIMIT = 120;
export const INTERVAL_MS = 60000;
export const REQUEST_TIMEOUT_MS = 5000;

export function stageStaticUrl(baseUrl) {
    if (typeof baseUrl !== 'string' || /[?#]/.test(baseUrl)) throw new Error('invalid_stage_configuration');
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error('invalid_stage_configuration'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
        || parsed.search || parsed.hash || !['/', '/index.html'].includes(parsed.pathname)) {
        throw new Error('invalid_stage_configuration');
    }
    // The reviewed root deployment copies public/misc unchanged. Nested bases
    // are unsupported rather than guessing a different public-resource path.
    return new URL('/misc/favicon.ico', parsed.origin);
}

function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function elapsed(now, started) {
    return finiteNumber(now() - started);
}

const OUTCOMES = new Set(['http', 'timeout', 'dns', 'connect', 'tls', 'reset', 'network', 'cancelled']);
function safeResult(result) {
    return {
        outcome: OUTCOMES.has(result?.outcome) ? result.outcome : 'network',
        status: Number.isInteger(result?.status) && result.status >= 100 && result.status <= 599 ? result.status : null,
        dnsMs: finiteNumber(result?.dnsMs), connectMs: finiteNumber(result?.connectMs),
        tlsMs: finiteNumber(result?.tlsMs), firstHeadersMs: finiteNumber(result?.firstHeadersMs),
        elapsedMs: finiteNumber(result?.elapsedMs)
    };
}

function failureKind(error) {
    const code = error?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    if (code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'connect';
    if (code === 'ECONNRESET' || code === 'EPIPE') return 'reset';
    if (code === 'ETIMEDOUT') return 'timeout';
    if (typeof code === 'string' && (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')
        || ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))) return 'tls';
    return 'network';
}

export function probe(url, signal, {
    request = https.request, now = () => performance.now(),
    setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
    return new Promise(resolve => {
        const started = now();
        const timing = { dnsMs: null, connectMs: null, tlsMs: null, firstHeadersMs: null };
        let req;
        let timer;
        let settled = false;
        const finish = (outcome, status = null) => {
            if (settled) return;
            settled = true;
            clearTimer(timer);
            signal?.removeEventListener('abort', onAbort);
            try { req?.destroy(); } catch { /* Owned diagnostic request only. */ }
            resolve({ outcome, status, ...timing, elapsedMs: elapsed(now, started) });
        };
        const onAbort = () => finish('cancelled');
        if (signal?.aborted) { finish('cancelled'); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimer(() => finish('timeout'), REQUEST_TIMEOUT_MS);
        try {
            req = request(url, { method: 'GET', agent: false }, response => {
                if (!settled) {
                    timing.firstHeadersMs = elapsed(now, started);
                    const status = response.statusCode;
                    finish('http', Number.isInteger(status) && status >= 100 && status <= 599 ? status : null);
                }
                // Never follow Location, read headers, or collect response body bytes.
                response.destroy();
            });
            req.on('error', error => finish(failureKind(error)));
            req.once('socket', socket => {
                for (const [event, field] of [['lookup', 'dnsMs'], ['connect', 'connectMs'], ['secureConnect', 'tlsMs']]) {
                    socket.once(event, () => {
                        if (!settled && timing[field] === null) timing[field] = elapsed(now, started);
                    });
                }
            });
            req.end();
        } catch (error) { finish(failureKind(error)); }
    });
}

export function waitForInterval(signal, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    return new Promise(resolve => {
        let timer;
        const done = () => {
            clearTimer(timer);
            signal?.removeEventListener('abort', done);
            resolve();
        };
        if (signal?.aborted) { resolve(); return; }
        signal?.addEventListener('abort', done, { once: true });
        timer = setTimer(done, INTERVAL_MS);
    });
}

export async function runSampler({
    baseUrl, signal, emit = line => console.log(line), performProbe = probe,
    wait = waitForInterval, wallNow = Date.now
}) {
    let stage;
    try { stage = stageStaticUrl(baseUrl); }
    catch { emit('[TransportSample] {"outcome":"invalid_configuration"}'); return; }
    const targets = [['stage-static', stage], ['github-control', new URL(CONTROL_URL)]];
    let sample = 0;
    // Two sequential requests per round, no overlap; >=60s between rounds.
    // <=120 requests total (60 rounds), then exit even if the test is still running.
    while (sample < REQUEST_LIMIT && !signal?.aborted) {
        for (const [target, url] of targets) {
            if (signal?.aborted) return;
            const at = wallNow();
            const result = await performProbe(url, signal);
            emit('[TransportSample] ' + JSON.stringify({
                target, sample: ++sample,
                atUnixMs: finiteNumber(at),
                ...safeResult(result)
            }));
        }
        if (sample < REQUEST_LIMIT && !signal?.aborted) await wait(signal);
    }
}

async function main() {
    const controller = new AbortController();
    const stop = () => {
        controller.abort();
        // A pending OS DNS operation may outlive request.destroy(). This watchdog
        // bounds shutdown of this owned diagnostic process, never the test process.
        setTimeout(() => process.exit(0), 1000).unref();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try { await runSampler({ baseUrl: process.env.PWAPPY_TEST_BASE_URL, signal: controller.signal }); }
    catch { console.log('[TransportSample] {"outcome":"sampler_failure"}'); }
    finally {
        process.off('SIGTERM', stop);
        process.off('SIGINT', stop);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
