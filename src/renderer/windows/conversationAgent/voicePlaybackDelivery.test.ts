import { describe, expect, it } from 'vitest';
import { VoicePlaybackDelivery } from './voicePlaybackDelivery';

describe('local voice playback observations', () => {
  it('does not count scheduled future phrases as played or invent a first character before audio starts', () => {
    const ledger = new VoicePlaybackDelivery(['First.', 'Second.']);
    ledger.schedule(0, 10, 2); ledger.finishGeneration(0, false);
    ledger.schedule(1, 12, 2); ledger.finishGeneration(1, false);
    expect(ledger.snapshot(0)).toEqual({ spokenText: '', confirmedText: '', basis: 'unavailable', complete: false });
    expect(ledger.snapshot(11)).toEqual({ spokenText: 'Fir', confirmedText: '', basis: 'playback-estimate', complete: false });
  });

  it('requires every chunk and completed generation before confirming a whole phrase', () => {
    const ledger = new VoicePlaybackDelivery(['First.', 'Second.']);
    const end1 = ledger.schedule(0, 0, 1), end2 = ledger.schedule(0, 1, 1);
    end1(); end2();
    expect(ledger.snapshot(2).confirmedText).toBe('');
    ledger.finishGeneration(0, false);
    expect(ledger.snapshot(2)).toMatchObject({ spokenText: 'First.', confirmedText: 'First.', complete: false });
    const end3 = ledger.schedule(1, 2, 1); ledger.finishGeneration(1, false); end3();
    expect(ledger.snapshot(3)).toMatchObject({ spokenText: 'First. Second.', confirmedText: 'First. Second.', complete: true });
  });

  it('makes no partial claim for system speech or an unfinished streamed phrase', () => {
    const ledger = new VoicePlaybackDelivery(['System.']);
    expect(ledger.snapshot(100).spokenText).toBe('');
    ledger.finishGeneration(0, true);
    expect(ledger.snapshot(100)).toMatchObject({ confirmedText: 'System.', basis: 'system-complete', complete: true });
    const streamed = new VoicePlaybackDelivery(['Streaming.']);
    streamed.schedule(0, 0, 1);
    expect(streamed.snapshot(0.9).spokenText).toBe('');
  });
});
