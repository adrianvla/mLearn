import { describe, expect, it } from 'vitest';
import {
  grammarConstructionFromEntity,
  grammarConstructionFromPoint,
  indexGrammarConstructions,
} from './constructions';
import type { GraphEntity } from '../graph/types';
import type { GrammarPoint, LanguageData } from '../types';

const jaData: LanguageData = {
  name: 'Japanese',
  grammarLevels: { names: { '4': 'N4' } },
};

describe('grammar constructions', () => {
  it('derives a construction from package data with difficulty label when named', () => {
    const point: GrammarPoint = {
      pattern: 'ている',
      meaning: 'ongoing action / state',
      level: 4,
      category: 'aspect',
      formation: 'te-form + いる',
      attachments: ['te-form'],
      variants: ['てます'],
      register: 'plain',
    };
    expect(grammarConstructionFromPoint('ja', point, jaData)).toEqual({
      id: 'ja:grammar:ている',
      pattern: 'ている',
      meaning: 'ongoing action / state',
      category: 'aspect',
      formation: 'te-form + いる',
      attachments: ['te-form'],
      variants: ['てます'],
      register: 'plain',
      difficulty: { level: 4, levelLabel: 'N4' },
    });
  });

  it('degrades honestly: absent package fields stay undefined, never fabricated', () => {
    const construction = grammarConstructionFromPoint('ja', { pattern: 'ば', meaning: 'if (conditional)', level: 4 });
    expect(construction).toEqual({
      id: 'ja:grammar:ば',
      pattern: 'ば',
      meaning: 'if (conditional)',
      difficulty: { level: 4 },
    });
    expect(construction.category).toBeUndefined();
    expect(construction.formation).toBeUndefined();
    expect(construction.recognitionRules).toBeUndefined();
    // No named level in the package → no synthesized label.
    expect(construction.difficulty?.levelLabel).toBeUndefined();
  });

  it('derives from graph entities with recognition rules forwarded from the package', () => {
    const entity: GraphEntity = {
      id: 'ja:grammar:てしまう',
      kind: 'grammar-pattern',
      label: 'てしまう',
      grammar: {
        meaning: 'completion / regret',
        level: 3,
        recognitionRules: [{ type: 'text', text: 'てしまう' }],
      },
    };
    expect(grammarConstructionFromEntity(entity)).toMatchObject({
      id: 'ja:grammar:てしまう',
      pattern: 'てしまう',
      meaning: 'completion / regret',
      difficulty: { level: 3 },
      recognitionRules: [{ type: 'text', text: 'てしまう' }],
    });
  });

  it('refuses to build constructions from non-grammar entities', () => {
    expect(grammarConstructionFromEntity({ id: 'ja:lexeme:1', kind: 'lexeme', label: '猫' })).toBeUndefined();
  });

  it('indexes constructions by pattern text like the language-context grammar map', () => {
    const index = indexGrammarConstructions('ja', [
      { pattern: 'ている', meaning: 'ongoing', level: 4 },
      { pattern: 'ば', meaning: 'if (conditional)', level: 4 },
    ]);
    expect([...index.keys()]).toEqual(['ている', 'ば']);
    expect(index.get('ている')?.id).toBe('ja:grammar:ている');
    expect(index.get('ば')?.difficulty?.level).toBe(4);
  });
});