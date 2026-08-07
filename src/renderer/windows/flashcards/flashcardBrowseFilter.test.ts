import { describe, expect, it } from 'vitest';
import type { Flashcard } from '@shared/types';
import {
  buildFlashcardBrowseFields,
  evaluateAst,
  parseTokens,
  validateTokens,
  type FilterToken,
} from '../../components/common';

const t = (key: string) => key;

const LANGUAGE_NAMES: Record<string, string> = {
  ja: 'Japanese',
  de: 'German',
};

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-1',
    content: { type: 'word', front: '言葉', back: 'word' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 0,
    lastReviewed: 0,
    lastUpdated: 0,
    ...overrides,
  };
}

function evaluateTokens(tokens: FilterToken[], card: Flashcard): boolean {
  const validation = validateTokens(tokens);
  expect(validation).toEqual({ ok: true });
  const ast = parseTokens(tokens);
  const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
  const resolvers = Object.fromEntries(fields.map((field) => [field.field, field.resolver]));
  return evaluateAst(ast, card, resolvers);
}

function stateToken(state: string): FilterToken[] {
  return [{ instanceId: 't1', kind: 'operand', field: 'state', op: 'eq', value: state }];
}

function suspendedToken(value: string): FilterToken[] {
  return [{ instanceId: 't2', kind: 'operand', field: 'suspended', op: 'eq', value }];
}

function buriedToken(value: string): FilterToken[] {
  return [{ instanceId: 't3', kind: 'operand', field: 'buried', op: 'eq', value }];
}

function languageToken(value: string): FilterToken[] {
  return [{ instanceId: 't4', kind: 'operand', field: 'language', op: 'eq', value }];
}

function levelToken(value: string): FilterToken[] {
  return [{ instanceId: 't5', kind: 'operand', field: 'level', op: 'eq', value }];
}

const LEVEL_NAMES: Record<string, string> = { 1: 'N5', 2: 'N4', 3: 'N3', 4: 'N2', 5: 'N1' };

function evaluateWithLevel(tokens: FilterToken[], card: Flashcard): boolean {
  const validation = validateTokens(tokens);
  expect(validation).toEqual({ ok: true });
  const ast = parseTokens(tokens);
  const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t, { levelNames: LEVEL_NAMES });
  const resolvers = Object.fromEntries(fields.map((field) => [field.field, field.resolver]));
  return evaluateAst(ast, card, resolvers);
}

describe('buildFlashcardBrowseFields', () => {
  it('exposes state, language, suspended and buried fields', () => {
    const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
    expect(fields.map((field) => field.field)).toEqual(['state', 'language', 'suspended', 'buried']);
  });

  it('lists the four flashcard states as palette values', () => {
    const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
    const stateField = fields.find((field) => field.field === 'state');
    expect(stateField?.values.map((value) => value.value)).toEqual(['new', 'learning', 'relearning', 'review']);
  });

  it('reads the state value from the flashcard record', () => {
    const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
    const stateResolver = fields.find((field) => field.field === 'state')?.resolver;
    expect(stateResolver?.read(makeCard({ state: 'review' }))).toBe('review');
    expect(stateResolver?.read(makeCard({ state: 'learning' }))).toBe('learning');
  });

  it('reads suspended and buried booleans so eq true/false match', () => {
    expect(evaluateTokens(suspendedToken('true'), makeCard({ suspended: true }))).toBe(true);
    expect(evaluateTokens(suspendedToken('false'), makeCard({ suspended: true }))).toBe(false);
    expect(evaluateTokens(suspendedToken('false'), makeCard())).toBe(true);

    expect(evaluateTokens(buriedToken('true'), makeCard({ buried: true }))).toBe(true);
    expect(evaluateTokens(buriedToken('false'), makeCard({ buried: true }))).toBe(false);
    expect(evaluateTokens(buriedToken('false'), makeCard())).toBe(true);
  });

  it('matches language equality against installed language codes', () => {
    expect(evaluateTokens(languageToken('ja'), makeCard({ language: 'ja' }))).toBe(true);
    expect(evaluateTokens(languageToken('de'), makeCard({ language: 'ja' }))).toBe(false);
  });

  it('treats a missing language as an empty string so empty values do not match', () => {
    expect(evaluateTokens(languageToken(''), makeCard())).toBe(true);
    expect(evaluateTokens(languageToken('ja'), makeCard())).toBe(false);
  });

  it('enumerates language palette values from the passed names', () => {
    const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
    const languageField = fields.find((field) => field.field === 'language');
    expect(languageField?.values).toEqual([
      { value: 'ja', label: 'Japanese' },
      { value: 'de', label: 'German' },
    ]);
  });

  it('exposes the level field only when a level context is passed', () => {
    const without = buildFlashcardBrowseFields(LANGUAGE_NAMES, t);
    expect(without.fields.find((field) => field.field === 'level')).toBeUndefined();

    const withLevel = buildFlashcardBrowseFields(LANGUAGE_NAMES, t, { levelNames: LEVEL_NAMES });
    expect(withLevel.fields.find((field) => field.field === 'level')).toBeDefined();
  });

  it('reads the level from the nested flashcard content', () => {
    const card = makeCard({ content: { type: 'word', front: '猫', back: 'cat', level: 2 } });
    expect(evaluateWithLevel(levelToken('2'), card)).toBe(true);
    expect(evaluateWithLevel(levelToken('5'), card)).toBe(false);
  });

  it('matches a missing content level against no level value', () => {
    const card = makeCard();
    expect(evaluateWithLevel(levelToken(''), card)).toBe(true);
    expect(evaluateWithLevel(levelToken('1'), card)).toBe(false);
  });

  it('enumerates level palette values from the passed level names', () => {
    const { fields } = buildFlashcardBrowseFields(LANGUAGE_NAMES, t, { levelNames: LEVEL_NAMES });
    const levelField = fields.find((field) => field.field === 'level');
    expect(levelField?.values.map((value) => value.value)).toEqual(['5', '4', '3', '2', '1']);
  });
});

describe('composed search + filter', () => {
  it('applies the filter expression on top of a text search (AND semantics)', () => {
    const cards = [
      makeCard({ id: 'a', content: { type: 'word', front: '猫', back: 'cat' }, state: 'new', suspended: true }),
      makeCard({ id: 'b', content: { type: 'word', front: '猫', back: 'cat' }, state: 'review' }),
      makeCard({ id: 'c', content: { type: 'word', front: '犬', back: 'dog' }, state: 'review' }),
    ];

    const query = 'cat';
    const tokens = suspendedToken('true');

    const matched = cards.filter((card) => {
      const front = card.content.front?.toLowerCase() || '';
      const back = card.content.back?.toLowerCase() || '';
      if (!front.includes(query) && !back.includes(query)) return false;
      return evaluateTokens(tokens, card);
    });

    expect(matched.map((card) => card.id)).toEqual(['a']);
  });

  it('supports boolean expressions combining state and language fields', () => {
    const cards = [
      makeCard({ id: 'a', state: 'review', language: 'ja' }),
      makeCard({ id: 'b', state: 'new', language: 'ja' }),
      makeCard({ id: 'c', state: 'review', language: 'de' }),
    ];

    const tokens: FilterToken[] = [
      { instanceId: 't1', kind: 'operand', field: 'state', op: 'eq', value: 'review' },
      { instanceId: 't2', kind: 'operator', op: 'AND' },
      { instanceId: 't3', kind: 'operand', field: 'language', op: 'eq', value: 'ja' },
    ];

    const matched = cards.filter((card) => evaluateTokens(tokens, card));
    expect(matched.map((card) => card.id)).toEqual(['a']);
  });
});
