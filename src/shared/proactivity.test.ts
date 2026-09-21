import { describe, expect, it } from 'vitest';
import { isInQuietHours } from './proactivity';

describe('isInQuietHours', () => {
  const midday = new Date(2026, 0, 1, 12, 0).getTime();
  const late = new Date(2026, 0, 1, 23, 0).getTime();

  it('supports daytime and overnight local-time windows', () => {
    expect(isInQuietHours({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '11:00', proactiveQuietHoursEnd: '13:00' }, midday)).toBe(true);
    expect(isInQuietHours({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '22:00', proactiveQuietHoursEnd: '08:00' }, late)).toBe(true);
    expect(isInQuietHours({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '22:00', proactiveQuietHoursEnd: '08:00' }, midday)).toBe(false);
  });

  it('fails open for disabled or invalid windows', () => {
    expect(isInQuietHours({ proactiveQuietHoursEnabled: false, proactiveQuietHoursStart: '00:00', proactiveQuietHoursEnd: '23:59' }, midday)).toBe(false);
    expect(isInQuietHours({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '25:00', proactiveQuietHoursEnd: '08:00' }, midday)).toBe(false);
  });
});
