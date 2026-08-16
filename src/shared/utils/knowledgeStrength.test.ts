import { describe, expect, it } from 'vitest';
import {
  ankiFactorToStrength,
  normalizedStrength,
  srsEaseToStrength,
  statusToStrength,
} from './knowledgeStrength';

describe('knowledge strength', () => {
  it('maps threshold anchors and interpolates linearly', () => {
    expect(normalizedStrength(1300, 1550, 1800, 1300)).toBe(0);
    expect(normalizedStrength(1550, 1550, 1800, 1300)).toBe(0.5);
    expect(normalizedStrength(1800, 1550, 1800, 1300)).toBe(1);
    expect(normalizedStrength(1425, 1550, 1800, 1300)).toBe(0.25);
    expect(normalizedStrength(1675, 1550, 1800, 1300)).toBe(0.75);
  });

  it('clamps strengths outside the configured range', () => {
    expect(normalizedStrength(0, 1550, 1800, 1300)).toBe(0);
    expect(normalizedStrength(3000, 1550, 1800, 1300)).toBe(1);
  });

  it('normalizes Anki factors and SRS ease values against the status thresholds', () => {
    expect(ankiFactorToStrength(1300)).toBe(0);
    expect(ankiFactorToStrength(1550)).toBe(0.5);
    expect(ankiFactorToStrength(1800)).toBe(1);
    expect(srsEaseToStrength(1.3)).toBe(0);
    expect(srsEaseToStrength(1.55)).toBe(0.5);
    expect(srsEaseToStrength(1.8)).toBe(1);
  });

  it('maps statuses to their normalized anchors', () => {
    expect(statusToStrength('unknown')).toBe(0);
    expect(statusToStrength('learning')).toBe(0.5);
    expect(statusToStrength('known')).toBe(1);
  });
});
