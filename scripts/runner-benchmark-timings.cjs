'use strict';
const { readFileSync, lstatSync } = require('node:fs');
const PHASES = Object.freeze(['auth_cache_points', 'dashboard', 'create_app', 'editor_ready', 'editor_close', 'delete_app']);
function validate(rows) {
  if (!Array.isArray(rows) || rows.length > 18) throw new Error('Invalid benchmark timing');
  const seen = new Set();
  for (const row of rows) {
    if (!row || Object.keys(row).sort().join(',') !== 'durationMs,phase,round,status'
      || !Number.isInteger(row.round) || row.round < 1 || row.round > 3
      || !PHASES.includes(row.phase) || !['passed', 'failed'].includes(row.status)
      || !Number.isInteger(row.durationMs) || row.durationMs < 0 || row.durationMs > 120000
      || seen.has(`${row.round}/${row.phase}`)) throw new Error('Invalid benchmark timing');
    seen.add(`${row.round}/${row.phase}`);
  }
  return rows;
}
function stepTiming(test, step) {
  if (!test?.location?.file?.replaceAll('\\', '/').endsWith('/tests/tools/runner-benchmark.spec.ts')
    || step?.category !== 'test.step') return null;
  const round = /^Runner benchmark round ([1-3])$/.exec(test.title);
  const phase = /^runner-benchmark:([a-z_]+)$/.exec(step.title);
  if (!round || !phase || !PHASES.includes(phase[1])) return null;
  const row = { round: Number(round[1]), phase: phase[1], durationMs: step.duration, status: step.error ? 'failed' : 'passed' };
  validate([row]); return row;
}
function read(path, requireComplete) {
  const stat=lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid benchmark timing');
  const rows=validate(JSON.parse(readFileSync(path, 'utf8')));
  if (requireComplete && (rows.length !== 18 || rows.some(row=>row.status !== 'passed'))) throw new Error('Incomplete benchmark timing');
  return rows;
}
module.exports={PHASES, validate, stepTiming, read};
