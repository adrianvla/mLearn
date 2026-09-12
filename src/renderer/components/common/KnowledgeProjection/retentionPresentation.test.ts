import { describe, it, expect } from 'vitest';
import { retentionPresentation } from './retentionPresentation';
describe('retentionPresentation', () => {
  const now = Date.UTC(2026, 8, 12);
  it('renders a century-long zero-pressure schedule as distant without changing the record', () => {
    const retention = { pressure: 0, dueAt: Date.UTC(2126, 8, 12) };
    expect(retentionPresentation(retention, now).key).toContain('RetentionDistant');
    expect(retention.dueAt).toBe(Date.UTC(2126, 8, 12));
  });
  it('keeps ordinary dates and overdue pressure visible', () => {
    expect(retentionPresentation({ pressure: 1.25, dueAt: now - 86400000 }, now).params.pressure).toBe('1.25');
    expect(retentionPresentation({ pressure: 0, dueAt: now + 86400000 }, now).key).toBe('mlearn.Knowledge.Projection.Retention');
  });
  it('does not show Invalid Date', () => {
    expect(retentionPresentation({ pressure: 0, dueAt: NaN }, now).key).toContain('Unavailable');
  });
});
