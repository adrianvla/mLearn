import { describe, expect, it } from 'vitest';
import { getProsodyOverlayTextTarget } from './prosodyOverlayTarget';

describe('getProsodyOverlayTextTarget', () => {
  it('targets the surface word for word slots', () => {
    expect(getProsodyOverlayTextTarget('開く', 'ひらく', {
      slot: 'word',
      displayReading: 'ひらく',
    })).toEqual({
      word: '開く',
      reading: 'ひらく',
    });
  });

  it('targets the displayed reading for reading slots', () => {
    expect(getProsodyOverlayTextTarget('開く', 'ひらく', {
      slot: 'reading',
      displayReading: 'ひらく',
    })).toEqual({
      word: 'ひらく',
      reading: 'ひらく',
    });
  });

  it('falls back without assuming a Japanese reading system', () => {
    expect(getProsodyOverlayTextTarget('کتاب', undefined, {
      slot: 'reading',
      displayReading: '',
    })).toEqual({
      word: 'کتاب',
      reading: 'کتاب',
    });
  });
});
