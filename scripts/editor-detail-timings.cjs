'use strict';
// Supplemental fixed-enum output only. Never serialize the Playwright step,
// attachment, title, error or URL. Must be wired to the existing protected
// reporter/artifact validator before CI use; not a replacement for assertions.
const { lstatSync, readFileSync } = require('node:fs');
const PHASES = Object.freeze(['editor_preconditions','editor_popup','editor_domcontentloaded',
  'editor_overlay_setup','editor_snapshot','editor_starter','editor_final_assertions',
  'popup_interception','popup_trigger','popup_create','popup_navigation']);
function validate(rows) {
  if (!Array.isArray(rows) || rows.length > 33) throw new Error('Invalid editor timing');
  const seen = new Set();
  for (const row of rows) {
    if (!row || Object.keys(row).sort().join(',') !== 'durationMs,phase,round,status' ||
        !Number.isInteger(row.round) || row.round < 1 || row.round > 3 ||
        !PHASES.includes(row.phase) || !['passed','failed'].includes(row.status) ||
        !Number.isInteger(row.durationMs) || row.durationMs < 0 || row.durationMs > 120000 ||
        seen.has(row.round + '/' + row.phase)) throw new Error('Invalid editor timing');
    seen.add(row.round + '/' + row.phase);
  }
  return rows;
}
function stepTiming(test, step) {
  if (!test?.location?.file?.replaceAll('\\','/').endsWith('/tests/tools/runner-benchmark.spec.ts') ||
      step?.category !== 'test.step') return null;
  const round = /^Runner benchmark round ([1-3])$/.exec(test.title);
  const phase = /^runner-editor-detail:([a-z_]+)$/.exec(step.title);
  if (!round || !phase || !PHASES.includes(phase[1])) return null;
  const row = {round:Number(round[1]),phase:phase[1],durationMs:step.duration,status:step.error?'failed':'passed'};
  validate([row]); return row;
}
function read(file, requireComplete = false, browser) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid editor timing');
  const rows = validate(JSON.parse(readFileSync(file,'utf8')));
  if (requireComplete) {
    if (!['chromium', 'webkit'].includes(browser)) throw new Error('Invalid editor timing');
    const expected = browser === 'webkit' ? PHASES : PHASES.filter(phase => !['popup_interception','popup_create','popup_navigation'].includes(phase));
    if (rows.length !== expected.length * 3 || rows.some(row => row.status !== 'passed' || !expected.includes(row.phase))) throw new Error('Incomplete editor timing');
    for (let round = 1; round <= 3; round++) for (const phase of expected) {
      if (!rows.some(row => row.round === round && row.phase === phase)) throw new Error('Incomplete editor timing');
    }
  }
  return rows;
}
module.exports = {PHASES, validate, stepTiming, read};
