import { describe, expect, it } from 'vitest';
import { scheduleAudioChunk } from './ttsScheduling';

describe('scheduleAudioChunk', () => {
  it('starts the first chunk with a small prebuffer from current audio time', () => {
    expect(scheduleAudioChunk(10, null, 0.32)).toEqual({
      startAt: 10.02,
      nextStartTime: 10.34,
    });
  });

  it('schedules consecutive chunks at the prior end time without inserting a gap', () => {
    expect(scheduleAudioChunk(10.1, 10.34, 0.32)).toEqual({
      startAt: 10.34,
      nextStartTime: 10.66,
    });
  });

  it('catches up to current audio time when generation falls behind playback', () => {
    expect(scheduleAudioChunk(11, 10.34, 0.32)).toEqual({
      startAt: 11.02,
      nextStartTime: 11.34,
    });
  });
});
