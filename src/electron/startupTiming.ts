/** Opt-in, monotonic main-process startup timings. Set MLEARN_STARTUP_TIMING=1. */
export const startupTimingEnabled = process.env.MLEARN_STARTUP_TIMING === '1';
const processStart = process.hrtime.bigint() - BigInt(Math.round(process.uptime() * 1_000_000_000));

export function startupTime(): bigint {
  return process.hrtime.bigint();
}

export function startupMark(label: string, started?: bigint): void {
  if (!startupTimingEnabled) return;
  const now = startupTime();
  const sinceStart = Number(now - processStart) / 1_000_000;
  const duration = started === undefined ? '' : ` duration=${(Number(now - started) / 1_000_000).toFixed(3)}ms`;
  console.info(`[startup] +${sinceStart.toFixed(3)}ms ${label}${duration}`);
}

export function startupDuration(label: string, nanoseconds: bigint): void {
  if (!startupTimingEnabled) return;
  const sinceStart = Number(startupTime() - processStart) / 1_000_000;
  console.info(`[startup] +${sinceStart.toFixed(3)}ms ${label} duration=${(Number(nanoseconds) / 1_000_000).toFixed(3)}ms`);
}
