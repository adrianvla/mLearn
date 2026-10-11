import { describe, expect, it } from 'vitest';
import { lapseRateDisplay } from './lapseRateDisplay';

describe('lapseRateDisplay', () => {
  it('renders an em-dash when there are no review samples', () => {
    expect(lapseRateDisplay(0, 0)).toEqual({ text: '—' });
  });

  it('formats lapse incidence without asserting a quality threshold', () => {
    expect(lapseRateDisplay(20, 5).text).toBe('20.0%');
    expect(lapseRateDisplay(0, 5).text).toBe('0.0%');
  });
});
