import { describe, expect, it } from 'vitest';
import {
  applyGrammarEncounter,
  applyGrammarFailure,
  classifyGrammarStatus,
  initialGrammarEase,
} from './grammarPolicy';

const THRESHOLDS = { learning: 1.55, known: 1.8 };

describe('grammarPolicy', () => {
  it('classifies with the same anchors as word projection', () => {
    expect(classifyGrammarStatus(1.3, THRESHOLDS)).toBe('unknown');
    expect(classifyGrammarStatus(1.55, THRESHOLDS)).toBe('learning');
    expect(classifyGrammarStatus(1.8, THRESHOLDS)).toBe('known');
  });

  it('bumps encounters and floors failures at the historical bounds', () => {
    expect(applyGrammarEncounter(1.3)).toBeCloseTo(1.31, 10);
    expect(applyGrammarEncounter(5)).toBe(5);
    expect(applyGrammarFailure(1.3)).toBeCloseTo(1.15, 10);
    expect(applyGrammarFailure(0.05)).toBe(0);
  });

  it('starts new patterns at the SRS minimum ease', () => {
    expect(initialGrammarEase()).toBe(1.3);
  });
});
