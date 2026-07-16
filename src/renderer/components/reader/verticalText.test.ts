import { describe, expect, it } from 'vitest';
import { groupVerticalPunctuationRuns, splitVerticalPunctuationRuns } from './verticalText';

describe('groupVerticalPunctuationRuns', () => {
  it('combines an adjacent punctuation run into one upright vertical cell', () => {
    expect(groupVerticalPunctuationRuns(['word', '!', '?', '!', 'next'], (text) => text)).toEqual([
      { items: ['word'], combineUpright: false },
      { items: ['!', '?', '!'], combineUpright: true },
      { items: ['next'], combineUpright: false },
    ]);
  });

  it('keeps a single punctuation token as a normal token', () => {
    expect(groupVerticalPunctuationRuns(['word', '!', 'next'], (text) => text)).toEqual([
      { items: ['word'], combineUpright: false },
      { items: ['!'], combineUpright: false },
      { items: ['next'], combineUpright: false },
    ]);
  });
});

describe('splitVerticalPunctuationRuns', () => {
  it('collates mixed punctuation characters into one upright vertical cell', () => {
    expect(splitVerticalPunctuationRuns('why?!...')).toEqual([
      { text: 'why', combineUpright: false },
      { text: '?!...', combineUpright: true },
    ]);
  });

  it('recognizes non-ASCII punctuation without language-specific rules', () => {
    expect(splitVerticalPunctuationRuns('！！')).toEqual([
      { text: '！！', combineUpright: true },
    ]);
  });
});
