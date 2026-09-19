import { describe, expect, it } from 'vitest';
import { MIN_USABLE_TIMING_SAMPLES, TimingBaseline } from './timingBaseline';

describe('TimingBaseline', () => {
  it('returns no baseline below the usable-sample floor (insufficient data)', () => {
    const baseline = new TimingBaseline();
    baseline.add('placement', { latencyMs: 900, usable: true });
    baseline.add('placement', { latencyMs: 1000, usable: true });
    expect(baseline.median('placement')).toBeUndefined();
    baseline.add('placement', { latencyMs: 1100, usable: true });
    expect(baseline.median('placement')).toEqual({ medianMs: 1000, usableSamples: 3 });
  });

  it('never lets interrupted or stalled attempts into the median', () => {
    const baseline = new TimingBaseline();
    for (const latency of [800, 900, 1000]) baseline.add('placement', { latencyMs: latency, usable: true });
    // An alt-tab "four minute retrieval" and a focus-stalled row must not move the baseline.
    baseline.add('placement', { latencyMs: 240_000, usable: false });
    baseline.add('placement', { latencyMs: 400_000, usable: false });
    expect(baseline.median('placement')).toEqual({ medianMs: 900, usableSamples: 3 });
  });

  it('is outlier-robust: one huge clean sample cannot drag the median', () => {
    const baseline = new TimingBaseline();
    for (const latency of [800, 900, 1000, 1100, 60_000]) baseline.add('placement', { latencyMs: latency, usable: true });
    expect(baseline.median('placement')?.medianMs).toBe(1000);
  });

  it('keeps modalities separate: a self-assessment baseline never blends into typing', () => {
    const baseline = new TimingBaseline();
    for (const latency of [700, 800, 900]) baseline.add('self-assessment', { latencyMs: latency, usable: true });
    for (const latency of [3000, 3500, 4000]) baseline.add('typed-answer', { latencyMs: latency, usable: true });
    expect(baseline.median('self-assessment')?.medianMs).toBe(800);
    expect(baseline.median('typed-answer')?.medianMs).toBe(3500);
    expect(baseline.median('other')).toBeUndefined();
  });

  it('keeps a bounded window of recent samples', () => {
    const baseline = new TimingBaseline();
    for (let i = 0; i < 60; i += 1) baseline.add('placement', { latencyMs: 1000 + i, usable: true });
    const snapshot = baseline.median('placement')!;
    expect(snapshot.usableSamples).toBeLessThanOrEqual(50);
    expect(snapshot.medianMs).toBeGreaterThanOrEqual(1000 + (60 - 50));
  });

  it('rejects non-finite and negative latencies even when marked usable', () => {
    const baseline = new TimingBaseline();
    baseline.add('placement', { latencyMs: Number.NaN, usable: true });
    baseline.add('placement', { latencyMs: -5, usable: true });
    baseline.add('placement', { latencyMs: 1000, usable: true });
    expect(baseline.median('placement')).toBeUndefined();
    expect(MIN_USABLE_TIMING_SAMPLES).toBe(3);
  });
});
