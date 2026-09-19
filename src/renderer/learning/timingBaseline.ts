/**
 * Comparable personal timing baselines (R11).
 *
 * These are TASK-RESPONSE latencies for a single modality — the wall of a
 * specific prompt surface (written-word self-assessment here) measured from
 * presentation to the rating activation. They are NOT calibrated retrieval or
 * automaticity times: the single stop boundary includes rating-choice and
 * interface time, and a bucket may blend varied input lengths. Consumers must
 * treat them as supportive, uncertain comparison points for the SAME task,
 * never as a competence/retrieval classifier, and never change a rating from
 * them.
 *
 * Confound rules (R11/G05):
 * - Interrupted samples (blur/tab-away) stay EXCLUDED from the median —
 *   subtraction does not prove attention, so their remaining active time is
 *   not trustworthy as a baseline either. They are counted, not used.
 * - Focus-stalled samples are excluded outright (their active time contains
 *   the flagged gap by construction).
 * - Fewer than MIN_USABLE samples per modality → no baseline ("insufficient
 *   data" is the honest answer, not a small-number average).
 * - Medians (not means) keep single outliers from moving the baseline.
 */

export interface TimingSample {
  latencyMs: number;
  /** False for interrupted or focus-stalled attempts (unusable as baselines). */
  usable: boolean;
}

export interface TimingBaselineSnapshot {
  medianMs: number;
  usableSamples: number;
}

/** Below this a modality has no baseline — insufficient data, not zero. */
export const MIN_USABLE_TIMING_SAMPLES = 3;

/** Bounded window per modality: recent personal performance, not history. */
const MAX_TIMING_SAMPLES = 50;

function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Per-modality personal latency baseline. Modality keys must describe the
 * comparable task shape (e.g. `placement:surface-recognition`), because a
 * typing task and a self-assessment task are not comparable latencies.
 */
export class TimingBaseline {
  private readonly usableByModality = new Map<string, number[]>();

  add(modality: string, sample: TimingSample): void {
    if (!sample.usable || !Number.isFinite(sample.latencyMs) || sample.latencyMs < 0) return;
    const window = this.usableByModality.get(modality) ?? [];
    window.push(sample.latencyMs);
    if (window.length > MAX_TIMING_SAMPLES) window.shift();
    this.usableByModality.set(modality, window);
  }

  /** The modality's clean median, or undefined while data is insufficient. */
  median(modality: string): TimingBaselineSnapshot | undefined {
    const window = this.usableByModality.get(modality);
    if (window === undefined || window.length < MIN_USABLE_TIMING_SAMPLES) return undefined;
    return { medianMs: medianOf([...window].sort((a, b) => a - b)), usableSamples: window.length };
  }
}
