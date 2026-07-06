export interface ScheduledAudioChunk {
  startAt: number;
  nextStartTime: number;
}

export function scheduleAudioChunk(
  currentTime: number,
  nextStartTime: number | null,
  duration: number,
  prebufferSeconds = 0.02,
): ScheduledAudioChunk {
  const earliestStart = currentTime + prebufferSeconds;
  const startAt = Math.max(earliestStart, nextStartTime ?? earliestStart);
  return {
    startAt,
    nextStartTime: startAt + duration,
  };
}
