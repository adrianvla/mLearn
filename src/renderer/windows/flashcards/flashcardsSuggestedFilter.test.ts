import { describe, expect, it } from 'vitest';
import type { SuggestedFlashcard } from '@shared/types';
import {
  buildSuggestedFlashcardFields,
  evaluateAst,
  parseTokens,
  validateTokens,
  LEVEL_VALUE_BEYOND_EXAM,
  LEVEL_VALUE_NO_LEVEL,
  type FilterToken,
} from '../../components/common';

const t = (key: string) => key;

const LANGUAGE_NAMES: Record<string, string> = {
  ja: 'Japanese',
  de: 'German',
};

const LEVEL_NAMES: Record<string, string> = { 1: 'N5', 2: 'N4', 3: 'N3', 4: 'N2', 5: 'N1' };

const SOURCE_VALUES = [
  { value: 'anime.mkv', label: 'anime.mkv' },
  { value: 'None', label: 'None' },
];

function makeSuggestion(overrides: Partial<SuggestedFlashcard> = {}): SuggestedFlashcard {
  return {
    id: 's-1',
    word: '言葉',
    language: 'ja',
    level: 1,
    createdAt: 100,
    lastSeen: 200,
    count: 3,
    ...overrides,
  };
}

function evaluateTokens(tokens: FilterToken[], suggestion: SuggestedFlashcard, withLevel = false): boolean {
  const validation = validateTokens(tokens);
  expect(validation).toEqual({ ok: true });
  const ast = parseTokens(tokens);
  const { fields } = withLevel
    ? buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES, { levelNames: LEVEL_NAMES })
    : buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES);
  const resolvers = Object.fromEntries(fields.map((field) => [field.field, field.resolver]));
  return evaluateAst(ast, suggestion, resolvers);
}

function token(field: string, value: string): FilterToken[] {
  return [{ instanceId: 't1', kind: 'operand', field, op: 'eq', value }];
}

describe('buildSuggestedFlashcardFields', () => {
  it('exposes language, source and (with level context) level fields', () => {
    const withoutLevel = buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES);
    expect(withoutLevel.fields.map((f) => f.field)).toEqual(['language', 'source']);

    const withLevel = buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES, { levelNames: LEVEL_NAMES });
    expect(withLevel.fields.map((f) => f.field)).toEqual(['language', 'source', 'level']);
  });

  it('keeps the source field a single valueSelect pill so numerous sources stay compact', () => {
    const { fields, paletteItems } = buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES);
    const sourceField = fields.find((f) => f.field === 'source');
    expect(sourceField?.valueSelect).toBe(true);

    const sourcePills = paletteItems.filter((p) => 'field' in p && p.field === 'source');
    expect(sourcePills).toHaveLength(1);
    expect(sourcePills[0] && 'label' in sourcePills[0] ? sourcePills[0].label : '').toBe('mlearn.FilterBuilder.Field.Source');
  });

  it('pre-selects the first source value on the valueSelect pill', () => {
    const { paletteItems } = buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES);
    const sourcePill = paletteItems.find((p) => 'field' in p && p.field === 'source');
    expect(sourcePill && 'value' in sourcePill ? sourcePill.value : '').toBe('anime.mkv');
  });

  it('filters suggestions by language', () => {
    expect(evaluateTokens(token('language', 'ja'), makeSuggestion())).toBe(true);
    expect(evaluateTokens(token('language', 'de'), makeSuggestion())).toBe(false);
  });

  it('filters suggestions by source, resolving missing source to None', () => {
    expect(evaluateTokens(token('source', 'anime.mkv'), makeSuggestion({ source: 'anime.mkv' }))).toBe(true);
    expect(evaluateTokens(token('source', 'None'), makeSuggestion())).toBe(true);
    expect(evaluateTokens(token('source', 'anime.mkv'), makeSuggestion())).toBe(false);
  });

  it('matches suggestions by stored frequency level', () => {
    expect(evaluateTokens(token('level', '1'), makeSuggestion({ level: 1 }), true)).toBe(true);
    expect(evaluateTokens(token('level', '5'), makeSuggestion({ level: 1 }), true)).toBe(false);
  });

  it('maps missing or non-displayable levels to sentinel values', () => {
    expect(evaluateTokens(token('level', LEVEL_VALUE_NO_LEVEL), makeSuggestion({ level: null }), true)).toBe(true);
    expect(evaluateTokens(token('level', LEVEL_VALUE_NO_LEVEL), makeSuggestion({ level: undefined }), true)).toBe(true);
    expect(evaluateTokens(token('level', LEVEL_VALUE_BEYOND_EXAM), makeSuggestion({ level: -1 }), true)).toBe(true);
    expect(evaluateTokens(token('level', '1'), makeSuggestion({ level: null }), true)).toBe(false);
  });

  it('keeps positive frequency levels matching their own values', () => {
    const result = buildSuggestedFlashcardFields(LANGUAGE_NAMES, t, SOURCE_VALUES, { levelNames: LEVEL_NAMES });
    const ast = parseTokens(token('level', '2'));
    const resolvers = Object.fromEntries(result.fields.map((field) => [field.field, field.resolver]));
    expect(evaluateAst(ast, makeSuggestion({ level: 2 }), resolvers)).toBe(true);
    expect(evaluateAst(ast, makeSuggestion({ level: 5 }), resolvers)).toBe(false);
  });
});
