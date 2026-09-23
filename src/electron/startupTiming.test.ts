import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('startup timings', () => {
  it('stays silent unless explicitly enabled', async () => {
    vi.stubEnv('MLEARN_STARTUP_TIMING', '0');
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { startupMark } = await import('./startupTiming');
    startupMark('app ready');
    expect(output).not.toHaveBeenCalled();
  });

  it('reports monotonic time and elapsed phase duration', async () => {
    vi.stubEnv('MLEARN_STARTUP_TIMING', '1');
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { startupDuration, startupMark, startupTime } = await import('./startupTiming');
    startupMark('database ready', startupTime() - 10_000_000n);
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/^\[startup\] \+\d+\.\d{3}ms database ready duration=\d+\.\d{3}ms$/));
    startupDuration('directory enumeration', 1_250_000n);
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/^\[startup\] \+\d+\.\d{3}ms directory enumeration duration=1\.250ms$/));
  });
});
