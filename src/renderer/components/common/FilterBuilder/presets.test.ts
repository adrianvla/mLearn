import { describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '@shared/types';
import { makeToken } from './fieldConfig';
import type { FilterToken } from './filterExpr';
import { validateTokens } from './filterExpr';
import { buildEmptyPreset, buildFlashcardBrowseFields, buildWordDbEditorFields, buildWordSyncFields, buildWordSyncPreset, LEVEL_VALUE_BEYOND_EXAM, LEVEL_VALUE_NO_LEVEL } from './presets';

type TokenShape =
  | { kind: 'operand'; field: string; op: string; value: string }
  | { kind: 'operator'; op: string }
  | { kind: 'not' }
  | { kind: 'paren'; dir: string };

const allLevelNames = {
  '5': 'N5',
  '4': 'N4',
  '3': 'N3',
  '2': 'N2',
  '1': 'N1',
};

function shapes(tokens: FilterToken[]): TokenShape[] {
  return tokens.map((token) => {
    if (token.kind === 'operand') {
      return { kind: token.kind, field: token.field, op: token.op, value: token.value };
    }

    if (token.kind === 'operator') {
      return { kind: token.kind, op: token.op };
    }

    if (token.kind === 'paren') {
      return { kind: token.kind, dir: token.dir };
    }

    return { kind: token.kind };
  });
}

function expectUniqueInstanceIds(tokens: FilterToken[]): void {
  const ids = tokens.map(token => token.instanceId);
  expect(new Set(ids).size).toBe(ids.length);
}

function expectWellFormedTokenKinds(tokens: FilterToken[]): void {
  tokens.forEach((token) => {
    if (token.kind === 'operand') {
      expect(token.field).toBeTruthy();
      expect(['eq', 'neq', 'in', 'gte', 'lte']).toContain(token.op);
      expect(token.value).toBeTruthy();
      return;
    }

    if (token.kind === 'operator') {
      expect(['AND', 'OR']).toContain(token.op);
      return;
    }

    if (token.kind === 'paren') {
      expect(['open', 'close']).toContain(token.dir);
      return;
    }

    expect(token.kind).toBe('not');
  });
}

describe('buildWordSyncPreset', () => {
  const ascendingDifficultyLanguage: LanguageData = {
    name: 'Ascending Difficulty Language',
    colour_codes: {},
    settings: { fixed: {} },
    frequencyLevels: {
      difficulty: 'higher-is-harder',
    },
  };

  it('builds (Untracked OR Unknown) AND (N5 OR N4 OR N3 OR N2) for target level 2', () => {
    const tokens = buildWordSyncPreset(allLevelNames, 2);

    expect(shapes(tokens)).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
      { kind: 'operator', op: 'AND' },
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'level', op: 'eq', value: '5' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'level', op: 'eq', value: '4' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'level', op: 'eq', value: '3' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'level', op: 'eq', value: '2' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('builds (Untracked OR Unknown) AND (N5) for target level 5', () => {
    const tokens = buildWordSyncPreset({ '5': 'N5' }, 5);

    expect(shapes(tokens)).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
      { kind: 'operator', op: 'AND' },
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'level', op: 'eq', value: '5' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('builds only Untracked OR Unknown when no requested levels are available', () => {
    expect(shapes(buildWordSyncPreset({}, 2))).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('builds ascending-difficulty presets from easier levels through the target', () => {
    const tokens = buildWordSyncPreset({ '1': 'A1', '2': 'A2', '3': 'B1' }, 2, ascendingDifficultyLanguage);

    expect(shapes(tokens)).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
      { kind: 'operator', op: 'AND' },
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'level', op: 'eq', value: '1' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'level', op: 'eq', value: '2' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('builds zero-based presets when the language declares zero as a real level', () => {
    const zeroBasedLanguage: LanguageData = {
      name: 'Zero Based Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '0': 'Starter', '1': 'A1', '2': 'A2' },
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };
    const tokens = buildWordSyncPreset({ '0': 'Starter', '1': 'A1', '2': 'A2' }, 1, zeroBasedLanguage);

    expect(shapes(tokens)).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
      { kind: 'operator', op: 'AND' },
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'level', op: 'eq', value: '0' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'level', op: 'eq', value: '1' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('does not include sentinel levels in word sync presets', () => {
    const tokens = buildWordSyncPreset({ '-1': 'Unlisted', '5': 'N5' }, 5);

    expect(shapes(tokens)).toEqual([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
      { kind: 'operator', op: 'AND' },
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'level', op: 'eq', value: '5' },
      { kind: 'paren', dir: 'close' },
    ]);
  });

  it('builds an empty preset for null target level', () => {
    expect(buildWordSyncPreset(allLevelNames, null)).toEqual([]);
  });

  it('builds an empty preset for undefined target level', () => {
    expect(buildWordSyncPreset(allLevelNames, undefined)).toEqual([]);
  });

  it('assigns unique instanceIds to all preset tokens', () => {
    expectUniqueInstanceIds(buildWordSyncPreset(allLevelNames, 2));
  });

  it('builds only well-formed token kinds', () => {
    expectWellFormedTokenKinds(buildWordSyncPreset(allLevelNames, 2));
  });

  it('passes validateTokens for the primary target level preset', () => {
    expect(validateTokens(buildWordSyncPreset(allLevelNames, 2))).toEqual({ ok: true });
  });
});

describe('buildEmptyPreset', () => {
  it('builds an empty preset', () => {
    expect(buildEmptyPreset()).toEqual([]);
  });
});

describe('buildWordSyncFields', () => {
  const t = (key: string) => key;

  function levelValues(levelNames: Record<string, string>, languageData?: LanguageData | null): string[] {
    const { fields } = buildWordSyncFields(levelNames, t, languageData);
    const levelField = fields.find((field) => field.field === 'level');
    return levelField?.values.map((value) => value.value) ?? [];
  }

  function statusValues(): string[] {
    const { fields } = buildWordSyncFields({ '5': 'N5' }, t);
    const statusField = fields.find((field) => field.field === 'status');
    return statusField?.values.map((value) => value.value) ?? [];
  }

  it('offers Untracked as a separate word sync status filter', () => {
    expect(statusValues()).toEqual(['untracked', '0', '1', '2']);
  });

  it('keeps declared zero levels in the level palette', () => {
    const languageData: LanguageData = {
      name: 'Zero Based Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '0': 'Starter', '1': 'A1' },
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };

    expect(levelValues({ '0': 'Starter', '1': 'A1' }, languageData)).toEqual(['0', '1', LEVEL_VALUE_NO_LEVEL, LEVEL_VALUE_BEYOND_EXAM]);
  });

  it('omits sentinel level names from the selectable frequency-level palette', () => {
    expect(levelValues({ '-1': 'Unlisted', '5': 'N5' })).toEqual(['5', LEVEL_VALUE_NO_LEVEL, LEVEL_VALUE_BEYOND_EXAM]);
  });
});

describe('level sentinel values', () => {
  const t = (key: string) => key;

  it('appends No level and Beyond exam options with localized labels to the level palette', () => {
    const { fields } = buildWordDbEditorFields({ '5': 'N5' }, t, null);
    const levelField = fields.find((field) => field.field === 'level');

    expect(levelField?.values.map((value) => value.value)).toEqual(['5', LEVEL_VALUE_NO_LEVEL, LEVEL_VALUE_BEYOND_EXAM]);
    expect(levelField?.values.map((value) => value.label)).toEqual([
      'N5',
      'mlearn.FilterBuilder.Level.NoLevel',
      'mlearn.FilterBuilder.Level.BeyondExam',
    ]);
  });

  it('normalizes word row levels to sentinel values', () => {
    const { fields } = buildWordDbEditorFields({ '5': 'N5' }, t, null);
    const levelField = fields.find((field) => field.field === 'level');
    const read = (record: Record<string, unknown>) => levelField?.resolver.read(record as never);

    expect(read({ level: 5 })).toBe(5);
    expect(read({ level: -1 })).toBe(LEVEL_VALUE_BEYOND_EXAM);
    expect(read({ level: null })).toBe(LEVEL_VALUE_NO_LEVEL);
    expect(read({})).toBe(LEVEL_VALUE_NO_LEVEL);
  });

  it('normalizes flashcard content levels to sentinel values', () => {
    const { fields } = buildFlashcardBrowseFields({}, t, { levelNames: { '5': 'N5' }, languageData: null });
    const levelField = fields.find((field) => field.field === 'level');
    const read = (record: Record<string, unknown>) => levelField?.resolver.read(record as never);

    expect(read({ content: { level: 5 } })).toBe(5);
    expect(read({ content: { level: -1 } })).toBe(LEVEL_VALUE_BEYOND_EXAM);
    expect(read({ content: {} })).toBe(LEVEL_VALUE_NO_LEVEL);
    expect(read({})).toBe(LEVEL_VALUE_NO_LEVEL);
  });
});

describe('buildWordDbEditorFields', () => {
  const t = (key: string) => key;

  it('applies resolver overrides to the matching fields only', () => {
    const liveStatus = vi.fn(() => 2);
    const { fields } = buildWordDbEditorFields({ '5': 'N5' }, t, null, {
      status: { read: liveStatus, valueLabel: (value) => value },
    });

    const statusField = fields.find((field) => field.field === 'status');
    const sourceField = fields.find((field) => field.field === 'source');

    expect(statusField?.resolver.read({ word: '赤い' })).toBe(2);
    expect(liveStatus).toHaveBeenCalledWith({ word: '赤い' });
    expect(sourceField?.resolver.read({ knowledgeSource: 'Anki' })).toBe('Anki');
  });
});

describe('makeToken', () => {
  it('creates a FilterToken for each palette item kind', () => {
    expect(makeToken({ field: 'status', op: 'eq', value: '0', label: 'Unknown' }).kind).toBe('operand');
    expect(makeToken({ kind: 'operator', op: 'AND', label: 'AND' }).kind).toBe('operator');
    expect(makeToken({ kind: 'not', label: 'NOT' }).kind).toBe('not');
    expect(makeToken({ kind: 'paren', dir: 'open', label: '(' }).kind).toBe('paren');
    expect(makeToken({ kind: 'paren', dir: 'close', label: ')' }).kind).toBe('paren');
  });
});
