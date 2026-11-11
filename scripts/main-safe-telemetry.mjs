// Retain macOS pressure/transport observations without publishing process names, arguments or raw OS output.
import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runSampler } from './transport-sampler.mjs';
import { STAGING_ORIGIN } from './branch-verification-guard.mjs';
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
export function resourceSnapshot(dependencies = {}) {
  const exec = dependencies.exec || execFileSync;
  const read = command => {
    try { return exec(command, command === 'ps' ? ['-axo', 'pid,ppid,%cpu,rss'] : [], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000, maxBuffer: 65536,
    }); } catch { return ''; }
  };
  const vm = read('vm_stat');
  const pages = {};
  for (const field of ['Pages free', 'Pages active', 'Pages inactive', 'Pages wired down', 'Pages occupied by compressor', 'Swapins', 'Swapouts']) {
    const match = vm.match(new RegExp('^' + field + ':\\s+([0-9]+)\\.$', 'm'));
    pages[field] = match ? numeric(Number(match[1])) : null;
  }
  const processes = read('ps').split('\n').map(line => line.trim().match(/^([0-9]+)\s+([0-9]+)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+)$/))
    .filter(Boolean).map(match => ({ pid: numeric(Number(match[1])), parentPid: numeric(Number(match[2])), cpuPercent: numeric(Number(match[3])), rssKiB: numeric(Number(match[4])) }))
    .filter(item => Object.values(item).every(value => value !== null)).sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 12);
  return { atUnixMs: numeric((dependencies.now || Date.now)()),
    cpus: numeric((dependencies.cpus || cpus)().length), totalMemoryBytes: numeric((dependencies.totalmem || totalmem)()),
    freeMemoryBytes: numeric((dependencies.freemem || freemem)()), load: (dependencies.loadavg || loadavg)().slice(0, 3).map(numeric), pages, processes };
}
export function startMainDiagnostics(dependencies = {}) {
  const output = dependencies.output || console;
  const controller = new AbortController();
  let samples = 0;
  const sample = () => {
    if (samples++ >= 240) return;
    try { output.log('Main resource: ' + JSON.stringify(resourceSnapshot(dependencies))); }
    catch { output.log('Main resource: unavailable'); }
  };
  sample();
  const timer = (dependencies.setInterval || setInterval)(sample, 30000);
  const sampler = (dependencies.runSampler || runSampler)({ baseUrl: STAGING_ORIGIN, signal: controller.signal,
    emit: line => output.log(line) }).catch(() => output.log('[TransportSample] {"outcome":"sampler_failure"}'));
  return async () => {
    (dependencies.clearInterval || clearInterval)(timer);
    controller.abort();
    await sampler;
  };
}
