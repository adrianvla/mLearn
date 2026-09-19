import { describe, expect, it } from 'vitest';
import {
  applyGrammarEncounter,
  applyGrammarFailure,
  classifyGrammarStatus,
  initialGrammarEase,
} from './grammarPolicy';
import { evidenceStatusFromEase, effectiveThresholds } from '../knowledge/effectiveKnowledge';
import { grammarRecognitionEvidence, replayGrammarRecognition } from '../grammar/evidence';

const THRESHOLDS = { learning: 1.55, known: 1.8 };

describe('grammarPolicy', () => {
  it('classifies with the same anchors as word projection', () => {
    expect(classifyGrammarStatus(1.3, THRESHOLDS)).toBe('unknown');
    expect(classifyGrammarStatus(1.55, THRESHOLDS)).toBe('learning');
    expect(classifyGrammarStatus(1.8, THRESHOLDS)).toBe('known');
  });

  it('matches the canonical word classifier for every configured threshold set', () => {
    const configurations = [
      effectiveThresholds(), // shipped defaults: easeThresholdLearning/Known
      effectiveThresholds({ easeThresholdLearning: 2.0, easeThresholdKnown: 3.0 }),
      effectiveThresholds({ srsLearningThreshold: 1500, known_ease_threshold: 2500 }), // legacy milli fallback
    ];
    const eases = [0, 1.3, 1.54, 1.55, 1.79, 1.8, 2.6, 3.0, 5];
    for (const thresholds of configurations) {
      for (const ease of eases) {
        expect(classifyGrammarStatus(ease, thresholds)).toBe(evidenceStatusFromEase(ease, thresholds));
      }
    }
  });

  it('classifies replayed journal evidence for non-English patterns identically to the word projection', () => {
    // Same evidence shape, three languages: a configured known threshold of
    // 3.0 must classify the grammar projection EXACTLY like every word
    // surface classifies the same ease (R01 parity across surfaces).
    const thresholds = effectiveThresholds({ easeThresholdLearning: 2.0, easeThresholdKnown: 3.0 });
    const patterns = [
      { language: 'de', pattern: 'seit + Dativ' },
      { language: 'ja', pattern: 'ている' },
      { language: 'zh', pattern: '了' },
    ];
    for (const { language, pattern } of patterns) {
      const events = [
        grammarRecognitionEvidence(language, pattern, { t: 1, kind: 'rollup', timesSeenDelta: 30, origin: 'grammar-encounter' }),
        grammarRecognitionEvidence(language, pattern, { t: 2, kind: 'rating', easeAfter: 2.6 }),
      ];
      const projection = replayGrammarRecognition(events);
      expect(projection).not.toBeNull();
      expect(classifyGrammarStatus(projection!.ease, thresholds)).toBe(evidenceStatusFromEase(projection!.ease, thresholds));
      // 2.6 is a genuine Learning under 3.0 but would be a false Known under
      // hardcoded anchors (>= 1.8) — the cross-surface disagreement this pins.
      expect(projection!.ease).toBe(2.6);
      expect(classifyGrammarStatus(projection!.ease, thresholds)).toBe('learning');
      expect(classifyGrammarStatus(projection!.ease, { learning: 1.55, known: 1.8 })).toBe('known');

      // Encounter-only evidence (no explicit outcome recorded) must reach the
      // same parity through journal replay alone.
      const encounterOnly = replayGrammarRecognition([
        grammarRecognitionEvidence(language, pattern, { t: 1, kind: 'rollup', timesSeenDelta: 30, origin: 'grammar-encounter' }),
      ]);
      expect(encounterOnly).not.toBeNull();
      expect(encounterOnly!.timesFailed).toBe(0);
      expect(classifyGrammarStatus(encounterOnly!.ease, thresholds)).toBe(evidenceStatusFromEase(encounterOnly!.ease, thresholds));
      expect(classifyGrammarStatus(encounterOnly!.ease, thresholds)).not.toBe('known');
    }
  });

  it('keeps exposure-only encounter bumps below Known under default and raised thresholds', () => {
    // 30 passive encounters move ease 1.3 → 1.6: Learning under the default
    // anchors, but NEVER Known — in both the grammar and word classifiers.
    let eased = initialGrammarEase();
    for (let i = 0; i < 30; i++) eased = applyGrammarEncounter(eased);
    expect(eased).toBeCloseTo(1.6, 10);
    for (const thresholds of [effectiveThresholds(), effectiveThresholds({ easeThresholdKnown: 2.5 })]) {
      expect(classifyGrammarStatus(eased, thresholds)).toBe('learning');
      expect(classifyGrammarStatus(eased, thresholds)).not.toBe('known');
      expect(evidenceStatusFromEase(eased, thresholds)).toBe('learning');
      expect(evidenceStatusFromEase(eased, thresholds)).not.toBe('known');
    }
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
