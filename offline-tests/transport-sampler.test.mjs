import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    CONTROL_URL, REQUEST_LIMIT, INTERVAL_MS, REQUEST_TIMEOUT_MS,
    stageStaticUrl, probe, waitForInterval, runSampler
} from '../scripts/transport-sampler.mjs';

// Actual module import above performs no I/O. Every request and timer below is
// injected; these offline contracts never contact stage or the public control.
const SECRET = 'do-not-log-secret-url-cookie-body';
const validBase = 'https://stage.invalid/index.html';
const target = stageStaticUrl(validBase);

function fakeTimers() {
    const pending = new Map();
    let id = 0;
    return {
        pending,
        setTimer(fn, ms) { const key = ++id; pending.set(key, { fn, ms }); return key; },
        clearTimer(key) { pending.delete(key); },
        fire() {
            const [key, entry] = pending.entries().next().value;
            pending.delete(key);
            entry.fn();
        }
    };
}

function harness() {
    const timers = fakeTimers();
    const controller = new AbortController();
    const req = new EventEmitter();
    const socket = new EventEmitter();
    const calls = [];
    let callback;
    let tick = 100;
    let destroyed = 0;
    let ended = 0;
    req.destroy = () => { destroyed++; };
    req.end = () => { ended++; };
    const deps = {
        ...timers, now: () => tick,
        request(url, options, cb) { calls.push({ url, options }); callback = cb; return req; }
    };
    const promise = probe(target, controller.signal, deps);
    return {
        timers, controller, req, socket, calls, promise,
        tick(value) { tick = value; },
        get destroyed() { return destroyed; },
        get ended() { return ended; },
        response(statusCode) {
            let destroyedResponse = 0;
            const response = {
                statusCode, destroy() { destroyedResponse++; },
                get headers() { throw new Error(SECRET); },
                get rawHeaders() { throw new Error(SECRET); },
                get on() { throw new Error(SECRET); }
            };
            callback(response);
            return destroyedResponse;
        }
    };
}

test('only normalized HTTPS origin plus fixed static path is used', () => {
    assert.equal(stageStaticUrl('https://STAGE.invalid:443/index.html').href, 'https://stage.invalid/misc/favicon.ico');
    assert.equal(stageStaticUrl('https://stage.invalid:8443/').href, 'https://stage.invalid:8443/misc/favicon.ico');
    assert.equal(CONTROL_URL, 'https://raw.githubusercontent.com/github/gitignore/0e5d690153ca3da8a4a1aef2d053406f408f531c/Global/Archives.gitignore');
    assert.equal(REQUEST_LIMIT, 120);
    assert.equal(INTERVAL_MS, 60000);
    assert.equal(REQUEST_TIMEOUT_MS, 5000);
});
for (const invalid of [undefined, '', SECRET, 'http://stage.invalid', 'file:///tmp/x',
    'https://user:secret@stage.invalid', 'https://stage.invalid/?secret=x',
    'https://stage.invalid/#secret', 'https://stage.invalid/?', 'https://stage.invalid/#',
    'https://stage.invalid/nested/index.html']) {
    test('invalid configuration fails closed: ' + String(invalid).split(':')[0], () => {
        assert.throws(() => stageStaticUrl(invalid), error => error.message === 'invalid_stage_configuration');
    });
}

test('one fresh GET records cumulative milestones and destroys at headers without reading body or headers', async () => {
    const h = harness();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].options, { method: 'GET', agent: false });
    assert.equal(h.ended, 1);
    assert.equal(h.timers.pending.values().next().value.ms, 5000);
    h.req.emit('socket', h.socket);
    h.tick(105); h.socket.emit('lookup', null, SECRET, 4, SECRET);
    h.tick(112); h.socket.emit('connect');
    h.tick(121); h.socket.emit('secureConnect');
    h.tick(135);
    assert.equal(h.response(200), 1);
    assert.deepEqual(await h.promise, {
        outcome: 'http', status: 200, dnsMs: 5, connectMs: 12,
        tlsMs: 21, firstHeadersMs: 35, elapsedMs: 35
    });
    assert.equal(h.destroyed, 1);
    assert.equal(h.timers.pending.size, 0);
    assert.equal(getEventListeners(h.controller.signal, 'abort').length, 0);
});

for (const status of [301, 302, 404, 500, 503]) {
    test('HTTP ' + status + ' is evidence only, with no redirect or retry', async () => {
        const h = harness();
        h.response(status);
        const result = await h.promise;
        assert.equal(result.outcome, 'http');
        assert.equal(result.status, status);
        assert.equal(result.dnsMs, null);
        assert.equal(result.connectMs, null);
        assert.equal(result.tlsMs, null);
        assert.equal(h.calls.length, 1);
    });
}

for (const [code, kind] of [
    ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['ECONNREFUSED', 'connect'],
    ['ENETUNREACH', 'connect'], ['EHOSTUNREACH', 'connect'], ['ECONNRESET', 'reset'],
    ['EPIPE', 'reset'], ['ETIMEDOUT', 'timeout'], ['CERT_HAS_EXPIRED', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls'],
    [SECRET, 'network']
]) {
    test('network errors become fixed enum only: ' + kind + ' ' + code, async () => {
        const h = harness();
        h.tick(145);
        h.req.emit('error', Object.assign(new Error(SECRET), { code, address: SECRET, hostname: SECRET }));
        const result = await h.promise;
        assert.equal(result.outcome, kind);
        assert.equal(result.elapsedMs, 45);
        assert.equal(result.status, null);
        assert.equal(result.firstHeadersMs, null);
        assert.equal(JSON.stringify(result).includes(SECRET), false);
        assert.equal(h.destroyed, 1);
        assert.equal(h.timers.pending.size, 0);
        assert.equal(getEventListeners(h.controller.signal, 'abort').length, 0);
    });
}

test('total 5s deadline settles once and ignores late response/error without replay', async () => {
    const h = harness();
    h.tick(5100); h.timers.fire();
    const result = await h.promise;
    assert.equal(result.outcome, 'timeout');
    assert.equal(result.elapsedMs, 5000);
    h.tick(5200); h.response(200);
    h.req.emit('error', new Error(SECRET));
    assert.equal(result.firstHeadersMs, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.destroyed, 1);
    assert.equal(getEventListeners(h.controller.signal, 'abort').length, 0);
});

test('abort before request makes no request or timer', async () => {
    const controller = new AbortController();
    controller.abort();
    const timers = fakeTimers();
    const result = await probe(target, controller.signal, {
        ...timers, now: () => 1, request() { assert.fail('must not send'); }
    });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(timers.pending.size, 0);
});

test('abort during request destroys it and releases timer/listener', async () => {
    const h = harness();
    h.controller.abort();
    assert.equal((await h.promise).outcome, 'cancelled');
    assert.equal(h.destroyed, 1);
    assert.equal(h.timers.pending.size, 0);
    assert.equal(getEventListeners(h.controller.signal, 'abort').length, 0);
});

test('synchronous request creation error is normalized without leaking raw values', async () => {
    const timers = fakeTimers();
    const result = await probe(target, undefined, {
        ...timers, now: () => 1, request() { throw new Error(SECRET); }
    });
    assert.equal(result.outcome, 'network');
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(timers.pending.size, 0);
});

test('invalid clocks and invalid HTTP statuses are null rather than invented durations', async () => {
    const h = harness();
    h.tick(NaN); h.response(SECRET);
    const result = await h.promise;
    assert.equal(result.status, null);
    assert.equal(result.firstHeadersMs, null);
    assert.equal(result.elapsedMs, null);
});

test('60s wait is abortable and removes its timer/listener', async () => {
    const controller = new AbortController();
    const timers = fakeTimers();
    const pending = waitForInterval(controller.signal, timers);
    assert.equal(timers.pending.values().next().value.ms, 60000);
    controller.abort();
    await pending;
    assert.equal(timers.pending.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('normal interval completion removes listener; already-aborted interval schedules nothing', async () => {
    const controller = new AbortController();
    const timers = fakeTimers();
    const pending = waitForInterval(controller.signal, timers);
    timers.fire(); await pending;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    controller.abort();
    await waitForInterval(controller.signal, timers);
    assert.equal(timers.pending.size, 0);
});

const result = { outcome: 'http', status: 200, dnsMs: 1, connectMs: 2, tlsMs: 3, firstHeadersMs: 4, elapsedMs: 4 };
test('sampler caps at120 sequential requests and59 waits, emits only labels/numbers/null', async () => {
    const urls = [], lines = [];
    let waits = 0, active = 0;
    await runSampler({
        baseUrl: validBase, emit: line => lines.push(line), wallNow: () => 12345,
        performProbe: async url => {
            assert.equal(active++, 0);
            urls.push(url.href);
            await Promise.resolve();
            active--;
            return result;
        },
        wait: async () => { assert.equal(active, 0); waits++; }
    });
    assert.equal(urls.length, 120);
    assert.equal(waits, 59);
    assert.equal(urls.filter(url => url === target.href).length, 60);
    assert.equal(urls.filter(url => url === CONTROL_URL).length, 60);
    for (let i = 0; i < lines.length; i++) {
        assert.equal(lines[i].includes('https:'), false);
        const record = JSON.parse(lines[i].slice('[TransportSample] '.length));
        assert.equal(record.sample, i + 1);
        assert.equal(record.atUnixMs, 12345);
        assert.equal(record.target, i % 2 === 0 ? 'stage-static' : 'github-control');
        assert.deepEqual(Object.keys(record).sort(), [
            'target', 'sample', 'atUnixMs', 'outcome', 'status', 'dnsMs',
            'connectMs', 'tlsMs', 'firstHeadersMs', 'elapsedMs'
        ].sort());
    }
});

test('sampler stops between pair members when aborted, without a control request or wait', async () => {
    const controller = new AbortController();
    let calls = 0;
    await runSampler({
        baseUrl: validBase, signal: controller.signal, emit() {},
        performProbe: async () => { calls++; controller.abort(); return result; },
        wait() { assert.fail('must not wait'); }
    });
    assert.equal(calls, 1);
});

test('sampler invalid configuration prints only fixed enum and performs no requests', async () => {
    const lines = [];
    await runSampler({
        baseUrl: 'https://user:' + SECRET + '@stage.invalid', emit: line => lines.push(line),
        performProbe() { assert.fail('must not send'); }
    });
    assert.deepEqual(lines, ['[TransportSample] {"outcome":"invalid_configuration"}']);
});

test('workflow changes only the Mac diagnostic trap; all test inputs/commands/budgets remain byte-identical', () => {
    const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
    const oldTrap = "            trap 'e2e_status=$?; kill \"$E2E_MONITOR_PID\" 2>/dev/null || true; wait \"$E2E_MONITOR_PID\" 2>/dev/null || true; echo \"::group::macOS runner resource samples\"; cat \"$E2E_RESOURCE_LOG\"; echo \"::endgroup::\"; exit \"$e2e_status\"' EXIT";
    const newTrap = "            # Credential-free static GET timings only; no test/retry decisions.\n            E2E_TRANSPORT_LOG=\"$RUNNER_TEMP/e2e-transport.log\"\n            node scripts/transport-sampler.mjs > \"$E2E_TRANSPORT_LOG\" 2>/dev/null &\n            E2E_TRANSPORT_PID=$!\n            finish_e2e_diagnostics() {\n              e2e_status=$?\n              trap - EXIT\n              kill \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              if jobs -pr | grep -Fxq -- \"$E2E_TRANSPORT_PID\"; then\n                kill \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              fi\n              wait \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              wait \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              echo \"::group::macOS runner resource samples\"\n              cat \"$E2E_RESOURCE_LOG\" || true\n              echo \"::endgroup::\"\n              echo \"::group::macOS static transport samples\"\n              cat \"$E2E_TRANSPORT_LOG\" || true\n              echo \"::endgroup::\"\n              exit \"$e2e_status\"\n            }\n            trap finish_e2e_diagnostics EXIT";
    assert.equal(workflow.split(newTrap).length, 2);
    const restored = workflow.replace(newTrap, oldTrap);
    assert.equal(createHash('sha256').update(restored).digest('hex'), 'ed71e781aabf971a7bbdc8dc2ad8ee1a689c260edcf48be01f1368a967841bbb');
    const macGuard = workflow.indexOf('if [ "$(uname -s)" = "Darwin" ]');
    assert.notEqual(macGuard, -1);
    assert.ok(macGuard < workflow.indexOf(newTrap));
    assert.ok(newTrap.includes('node scripts/transport-sampler.mjs > "$E2E_TRANSPORT_LOG" 2>/dev/null &'));
    assert.ok(newTrap.includes('wait "$E2E_TRANSPORT_PID" 2>/dev/null || true'));
    assert.ok(newTrap.includes('exit "$e2e_status"'));
});

test('emission rejects hostile extra fields, unknown enums, and nonnumeric timing values', async () => {
    const controller = new AbortController();
    const lines = [];
    await runSampler({
        baseUrl: validBase, signal: controller.signal, emit: line => lines.push(line), wallNow: () => Infinity,
        performProbe: async () => {
            controller.abort();
            return {
                outcome: SECRET, status: '200', dnsMs: SECRET, connectMs: -1,
                tlsMs: Infinity, firstHeadersMs: NaN, elapsedMs: null,
                url: SECRET, headers: SECRET, body: SECRET, error: SECRET,
                get rawHeaders() { throw new Error(SECRET); }
            };
        }
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes(SECRET), false);
    assert.deepEqual(JSON.parse(lines[0].slice('[TransportSample] '.length)), {
        target: 'stage-static', sample: 1, atUnixMs: null,
        outcome: 'network', status: null, dnsMs: null, connectMs: null,
        tlsMs: null, firstHeadersMs: null, elapsedMs: null
    });
});

test('legacy workflow hash adapter appends only the exact diagnostic edit, retaining immutable prior mappings', () => {
    const approved = JSON.parse(readFileSync(new URL('./normal-defaults-approved.json', import.meta.url), 'utf8'));
    const pair = approved.pop();
    assert.deepEqual(pair, { before: "            trap 'e2e_status=$?; kill \"$E2E_MONITOR_PID\" 2>/dev/null || true; wait \"$E2E_MONITOR_PID\" 2>/dev/null || true; echo \"::group::macOS runner resource samples\"; cat \"$E2E_RESOURCE_LOG\"; echo \"::endgroup::\"; exit \"$e2e_status\"' EXIT", after: "            # Credential-free static GET timings only; no test/retry decisions.\n            E2E_TRANSPORT_LOG=\"$RUNNER_TEMP/e2e-transport.log\"\n            node scripts/transport-sampler.mjs > \"$E2E_TRANSPORT_LOG\" 2>/dev/null &\n            E2E_TRANSPORT_PID=$!\n            finish_e2e_diagnostics() {\n              e2e_status=$?\n              trap - EXIT\n              kill \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              if jobs -pr | grep -Fxq -- \"$E2E_TRANSPORT_PID\"; then\n                kill \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              fi\n              wait \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              wait \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              echo \"::group::macOS runner resource samples\"\n              cat \"$E2E_RESOURCE_LOG\" || true\n              echo \"::endgroup::\"\n              echo \"::group::macOS static transport samples\"\n              cat \"$E2E_TRANSPORT_LOG\" || true\n              echo \"::endgroup::\"\n              exit \"$e2e_status\"\n            }\n            trap finish_e2e_diagnostics EXIT" });
    assert.equal(createHash('sha256').update(JSON.stringify(approved, null, 2) + '\n').digest('hex'),
        'a9cf02907c8ffc5a2d9118dd0c803baae2868def8472e2b38c5ecd61b50ce394');
});

test('actual CLI rejects invalid configuration without network, credentials, or raw stderr', () => {
    const execution = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/transport-sampler.mjs', import.meta.url))], {
        env: { PATH: process.env.PATH, PWAPPY_TEST_BASE_URL: 'https://user:' + SECRET + '@stage.invalid' },
        encoding: 'utf8', timeout: 5000
    });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0);
    assert.equal(execution.stderr, '');
    assert.equal(execution.stdout, '[TransportSample] {"outcome":"invalid_configuration"}\n');
});

for (const exitCode of [0, 37]) for (const samplerState of ['running', 'exited']) {
    test('actual Bash diagnostic trap reaps ' + samplerState + ' child and preserves E2E exit ' + exitCode, () => {
        const root = mkdtempSync(join(tmpdir(), 'transport-trap-'));
        try {
            const block = "            # Credential-free static GET timings only; no test/retry decisions.\n            E2E_TRANSPORT_LOG=\"$RUNNER_TEMP/e2e-transport.log\"\n            node scripts/transport-sampler.mjs > \"$E2E_TRANSPORT_LOG\" 2>/dev/null &\n            E2E_TRANSPORT_PID=$!\n            finish_e2e_diagnostics() {\n              e2e_status=$?\n              trap - EXIT\n              kill \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              if jobs -pr | grep -Fxq -- \"$E2E_TRANSPORT_PID\"; then\n                kill \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              fi\n              wait \"$E2E_MONITOR_PID\" 2>/dev/null || true\n              wait \"$E2E_TRANSPORT_PID\" 2>/dev/null || true\n              echo \"::group::macOS runner resource samples\"\n              cat \"$E2E_RESOURCE_LOG\" || true\n              echo \"::endgroup::\"\n              echo \"::group::macOS static transport samples\"\n              cat \"$E2E_TRANSPORT_LOG\" || true\n              echo \"::endgroup::\"\n              exit \"$e2e_status\"\n            }\n            trap finish_e2e_diagnostics EXIT";
            const script = [
                'sleep 60 &', 'E2E_MONITOR_PID=$!',
                'E2E_RESOURCE_LOG="$RUNNER_TEMP/resource.log"',
                'printf "synthetic resource sample\\n" > "$E2E_RESOURCE_LOG"',
                block.replace(/^            /gm, ''),
                ...(samplerState === 'exited' ? ['wait "$E2E_TRANSPORT_PID"'] : []),
                'exit ' + exitCode
            ].join('\n');
            const execution = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
                cwd: fileURLToPath(new URL('../', import.meta.url)),
                env: { PATH: process.env.PATH, RUNNER_TEMP: root, PWAPPY_TEST_BASE_URL: '' },
                encoding: 'utf8', timeout: 5000
            });
            assert.ifError(execution.error);
            assert.equal(execution.status, exitCode);
            assert.match(execution.stdout, /macOS runner resource samples/);
            assert.match(execution.stdout, /macOS static transport samples/);
            assert.equal(execution.stdout.includes(SECRET), false);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}

test('sampler abort during a pending actual probe stops before another target', async () => {
    const h = harness();
    let calls = 0;
    const running = runSampler({
        baseUrl: validBase, signal: h.controller.signal, emit() {},
        performProbe: () => { calls++; return h.promise; },
        wait() { assert.fail('must not wait'); }
    });
    assert.equal(calls, 1);
    h.controller.abort();
    await running;
    assert.equal(calls, 1);
    assert.equal(h.destroyed, 1);
    assert.equal(h.timers.pending.size, 0);
});

test('sampler abort during its real interval helper prevents another round', async () => {
    const controller = new AbortController();
    const timers = fakeTimers();
    let calls = 0;
    let notifyWaiting;
    const waiting = new Promise(resolve => { notifyWaiting = resolve; });
    const running = runSampler({
        baseUrl: validBase, signal: controller.signal, emit() {},
        performProbe: async () => { calls++; return result; },
        wait: signal => {
            const pending = waitForInterval(signal, timers);
            notifyWaiting();
            return pending;
        }
    });
    await waiting;
    assert.equal(calls, 2);
    assert.equal(timers.pending.size, 1);
    controller.abort();
    await running;
    assert.equal(calls, 2);
    assert.equal(timers.pending.size, 0);
});
