import { expect, type Page, type TestInfo } from '@playwright/test';
// Only fixed-name measures from the application are allowed across the bridge.
export async function attachAppStartupTimings(page: Page, info: TestInfo, round: number) {
  const schema = require('../../scripts/app-startup-timings.cjs');
  // The snapshot lookup may finish after the readiness observer. Keep this
  // bounded wait outside the benchmark's editor_ready step.
  await expect.poll(() => page.evaluate((phases: string[]) => phases.every(
    phase => performance.getEntriesByName('pwappy-startup:' + phase, 'measure').length === 1
  ), [...schema.REQUIRED]), { timeout: 4000, message: 'Wait for fixed startup timings' }).toBe(true);
  const rows = await page.evaluate(({round, phases}) => {

    const rows: {round:number;phase:string;durationMs:number}[] = [];
    for (const phase of phases) {
      const entries = performance.getEntriesByName('pwappy-startup:' + phase, 'measure');
      if (entries.length > 1) throw new Error('Invalid app timing');
      if (!entries.length) continue;
      const duration = entries[0].duration;
      if (!Number.isFinite(duration) || duration < 0 || duration > 120000) throw new Error('Invalid app timing');
      rows.push({round,phase,durationMs:Math.round(duration)});
    }
    return rows;
  }, {round, phases: [...schema.PHASES] as string[]});
  schema.validate(rows);
  for (const phase of schema.REQUIRED) if (!rows.some(row => row.phase === phase)) throw new Error('Incomplete app timing');
  const counters = await page.evaluate((round) => {
    const source = (window as any).__pwappyStartupCounters;
    if (!source || Object.keys(source).join(',') !== 'readback_retries' || !Number.isInteger(source.readback_retries) || source.readback_retries < 0 || source.readback_retries > 4) throw new Error('Invalid startup counter');
    return [{round,phase:'readback_retries',count:source.readback_retries}];
  }, round);
  require('../../scripts/app-startup-counters.cjs').validate(counters);
  await info.attach('pwappy-app-startup-counters', {body:Buffer.from(JSON.stringify(counters)),contentType:'application/json'});
  await info.attach('pwappy-app-startup-scalars', {body:Buffer.from(JSON.stringify(rows)),contentType:'application/json'});
}
