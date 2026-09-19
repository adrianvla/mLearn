import { describe, expect, it } from 'vitest';
import {
  curriculumGrammarCandidates,
} from './candidateSources';

const item = { language: 'ja', pattern: '〜わけではない', level: 6 };

describe('curriculumGrammarCandidates', () => {
  it('emits first-class curriculum candidates whose task measures grammar-recognition', () => {
    const candidates = curriculumGrammarCandidates([item]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'ja:grammar:〜わけではない',
      language: 'ja',
      origin: 'curriculum',
      task: {
        taskTemplateId: 'grammar-recognize',
        requested: ['grammar-recognition'],
        ratingMode: 'dominant',
      },
      targets: [{ entityId: 'ja:grammar:〜わけではない', capability: 'grammar-recognition' }],
      meta: { pattern: '〜わけではない', level: 6 },
    });
    expect(candidates[0]!.scores['curriculum-relevance']).toBe(1);
  });

  it('honors package-defined weights as curriculum relevance', () => {
    const candidates = curriculumGrammarCandidates([{ ...item, weight: 0.5 }, { ...item, pattern: 'ば', weight: 2 }]);
    expect(candidates[0]!.scores['curriculum-relevance']).toBe(0.5);
    expect(candidates[1]!.scores['curriculum-relevance']).toBe(1); // clamped
  });

  it('carries the package content version in meta for trace provenance (R20)', () => {
    const [versioned] = curriculumGrammarCandidates([{ ...item, contentVersion: 'grammar-data@7' }]);
    expect(versioned.meta).toEqual({ pattern: '〜わけではない', level: 6, contentVersion: 'grammar-data@7' });

    // Absent version omits the field: the legacy meta shape is unchanged.
    const [legacy] = curriculumGrammarCandidates([item]);
    expect(legacy.meta).toEqual({ pattern: '〜わけではない', level: 6 });
  });
});
