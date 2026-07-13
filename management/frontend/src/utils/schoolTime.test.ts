import { expect, it } from 'vitest';
import { schoolDateInput, schoolDayStart, schoolNextDayStart } from './schoolTime';

it('uses the school calendar day through the Europe/Paris DST boundary', () => {
  const start = schoolDayStart('2026-03-29', 'Europe/Paris');
  const next = schoolNextDayStart('2026-03-29', 'Europe/Paris');
  expect(start).not.toBeNull();
  expect(next).not.toBeNull();
  expect(next! - start!).toBe(23 * 60 * 60 * 1000);
  expect(schoolDateInput(start!, 'Europe/Paris')).toBe('2026-03-29');
});
