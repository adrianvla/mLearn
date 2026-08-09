import { describe, expect, it } from 'vitest';
import { retentionDisplay } from './retentionDisplay';

describe('retentionDisplay', () => {
  it('renders an em-dash with default color when there are no reviews', () => {
    expect(retentionDisplay(0, 0)).toEqual({ text: '—', color: 'default' });
  });

  it('colors rate >= 90 as success', () => {
    expect(retentionDisplay(90, 10).color).toBe('success');
    expect(retentionDisplay(95.5, 3).color).toBe('success');
  });

  it('colors 80 <= rate < 90 as warning', () => {
    expect(retentionDisplay(80, 10).color).toBe('warning');
    expect(retentionDisplay(89.9, 10).color).toBe('warning');
  });

  it('colors rate < 80 as error', () => {
    expect(retentionDisplay(79.9, 10).color).toBe('error');
    expect(retentionDisplay(0, 5).color).toBe('error');
  });

  it('formats the rate to one decimal with a percent sign', () => {
    expect(retentionDisplay(92.46, 7).text).toBe('92.5%');
  });
});
