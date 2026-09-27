export interface TtsRepairResult {
  attempted: number;
  attempts: number;
  succeeded: number;
  failed: number;
}

export async function runTtsRepairJobs<T>(
  jobs: readonly T[],
  generate: (job: T) => Promise<boolean>,
  onProgress: (completed: number, total: number) => void,
  maxRetries: number,
  abortOnError?: (error: unknown) => boolean,
): Promise<TtsRepairResult> {
  let pending = [...jobs];
  let attempts = 0;
  let succeeded = 0;
  for (let round = 0; round < maxRetries && pending.length > 0; round++) {
    const failedThisRound: T[] = [];
    for (const job of pending) {
      attempts++;
      try {
        if (await generate(job)) succeeded++;
        else failedThisRound.push(job);
      } catch (error) {
        if (abortOnError?.(error)) throw error;
        failedThisRound.push(job);
      }
      onProgress(succeeded + (round === maxRetries - 1 ? failedThisRound.length : 0), jobs.length);
    }
    pending = failedThisRound;
  }
  return { attempted: jobs.length, attempts, succeeded, failed: pending.length };
}
