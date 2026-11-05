import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const MiB = 1024 ** 2;
const fields = ['pid', 'timeMs', 'physicalFootprintBytes', 'rssBytes', 'totalBytes',
  'availableBytes', 'pressureLevel', 'swapUsedBytes', 'swapOutBytes'];

export class ResourceMeasurementError extends Error {}

export function evaluateResources(samples, workloadBytes) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 3
    || !Number.isSafeInteger(workloadBytes) || workloadBytes < 0)
    throw new ResourceMeasurementError('Invalid resource assessment');
  for (const sample of samples) {
    if (!sample || fields.some(field => !Number.isSafeInteger(sample[field]) || sample[field] < 0)
      || sample.pid === 0 || sample.timeMs === 0 || sample.totalBytes === 0
      || sample.availableBytes > sample.totalBytes || ![1, 2, 4].includes(sample.pressureLevel))
      throw new ResourceMeasurementError('Incomplete native resource sample');
  }
  const current = samples.at(-1);
  const intervals = samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    if (sample.pid !== previous.pid || sample.totalBytes !== previous.totalBytes
      || sample.timeMs <= previous.timeMs || sample.swapOutBytes < previous.swapOutBytes)
      throw new ResourceMeasurementError('Resource sample identity or clock changed');
    const seconds = (sample.timeMs - previous.timeMs) / 1000;
    return {
      growth: Math.max(0, sample.physicalFootprintBytes - previous.physicalFootprintBytes) / seconds,
      swapGrowth: (sample.swapUsedBytes - previous.swapUsedBytes) / seconds,
      swapOut: (sample.swapOutBytes - previous.swapOutBytes) / seconds,
    };
  });
  // Extrapolate sustained growth, not a single wake-up spike or historical peak.
  const growthBytes = intervals.length === 2 ? Math.ceil(Math.min(...intervals.map(i => i.growth)) * 10) : 0;
  const reserveBytes = Math.ceil(current.totalBytes / 4);
  const projectedHeadroomBytes = current.availableBytes - workloadBytes - growthBytes;
  const reasons = [];
  if (current.pressureLevel !== 1) reasons.push('host_pressure');
  if (projectedHeadroomBytes < reserveBytes) reasons.push('projected_headroom');
  if (intervals.length === 2 && intervals.every(i => i.swapGrowth >= 8 * MiB && i.swapOut >= 16 * MiB))
    reasons.push('sustained_swap_growth');
  return { safe: reasons.length === 0, sampled: samples.length === 3, reasons,
    reserveBytes, projectedHeadroomBytes, growthBytes };
}

async function run() {
  const [pidText, mode, sampler, budgetText] = process.argv.slice(2);
  const pid = Number(pidText);
  const budgetMiB = Number(budgetText);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !['admission', 'guard', 'once'].includes(mode)
    || !sampler || !Number.isSafeInteger(budgetMiB) || budgetMiB < 0)
    throw new ResourceMeasurementError('Usage: resource-guard PID admission|guard|once SAMPLER WORKLOAD_MIB');
  const samples = [];
  let healthy = 0;
  for (;;) {
    const { stdout } = await execute(sampler, [String(pid)], { timeout: 3000, maxBuffer: 4096 });
    const sample = JSON.parse(stdout);
    if (sample.pid !== pid) throw new ResourceMeasurementError('Wrong sampled process');
    samples.push(sample);
    if (samples.length > 3) samples.shift();
    const result = evaluateResources(samples, budgetMiB * MiB);
    console.log(JSON.stringify({ event: 'RESOURCE_SAMPLE', ...sample, workloadBytes: budgetMiB * MiB, ...result }));
    healthy = result.safe ? healthy + 1 : 0;
    if (!result.safe && mode === 'guard') {
      console.log('RESOURCE_GUARD_STOP');
      process.exitCode = 70;
      return;
    }
    if (healthy >= 3 && result.sampled && mode !== 'guard') {
      console.log('RESOURCE_READY consecutive=3');
      return;
    }
    if (samples.length === 3 && mode === 'once') {
      console.log('RESOURCE_ADMISSION_HELD');
      process.exitCode = 70;
      return;
    }
    if (!result.safe) console.log('RESOURCE_ADMISSION_HELD');
    await setTimeout(5000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error('RESOURCE_MEASUREMENT_ERROR', error instanceof Error ? error.message : String(error));
    process.exitCode = 70;
  });
}
