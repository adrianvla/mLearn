import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, KNOWLEDGE_SOURCES, WORD_STATUS } from '@shared/constants';
import { getFrequencyLevelLabel, getFrequencyLevelsAtOrEasierThanTarget, isDisplayableFrequencyLevel, sortFrequencyLevelsForDisplay } from '@shared/languageFeatures';
import type { LanguageData } from '@shared/types';
import type { FieldConfig, PaletteItem } from './fieldConfig';
import type { FieldResolver, FilterToken } from './filterExpr';
import { uniqueId } from './filterExpr';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const STATUS_FIELD = 'status';
const LEVEL_FIELD = 'level';
const SOURCE_FIELD = 'source';
const RECENCY_FIELD = 'recency';
const FLASHCARD_STATE_FIELD = 'state';
const FLASHCARD_LANGUAGE_FIELD = 'language';
const FLASHCARD_SUSPENDED_FIELD = 'suspended';
const FLASHCARD_BURIED_FIELD = 'buried';
const EQ_OPS = ['eq'] as const;
export const WORD_SYNC_STATUS_UNTRACKED = 'untracked';

/**
 * Synthetic level filter values for words without a displayable exam level:
 * NO_LEVEL = not on the frequency list at all; BEYOND_EXAM = on the list but unleveled.
 */
export const LEVEL_VALUE_NO_LEVEL = '__no_level__';
export const LEVEL_VALUE_BEYOND_EXAM = '__beyond_exam__';

function normalizeLevelValue(level: unknown, levelNames: Record<string, string>, languageData?: LanguageData | null): unknown {
  if (typeof level === 'number' && Number.isFinite(level)) {
    return isDisplayableFrequencyLevel(level, levelNames, languageData) ? level : LEVEL_VALUE_BEYOND_EXAM;
  }
  return LEVEL_VALUE_NO_LEVEL;
}

function buildLevelValues(levelNames: Record<string, string>, t: Translate, languageData?: LanguageData | null): { value: string; label: string }[] {
  const sortedLevels = sortFrequencyLevelsForDisplay(
    Object.keys(levelNames).map(Number).filter((level) => isDisplayableFrequencyLevel(level, levelNames, languageData)),
    languageData,
  );
  return [
    ...sortedLevels.map((level) => ({ value: String(level), label: getFrequencyLevelLabel(level, levelNames, languageData) })),
    { value: LEVEL_VALUE_NO_LEVEL, label: t('mlearn.FilterBuilder.Level.NoLevel') },
    { value: LEVEL_VALUE_BEYOND_EXAM, label: t('mlearn.FilterBuilder.Level.BeyondExam') },
  ];
}

export function buildWordSyncPreset(
  levelNames: Record<string, string>,
  targetLevel: number | null | undefined,
  languageData?: LanguageData | null,
): FilterToken[] {
  if (targetLevel === null || targetLevel === undefined) {
    // The default filter was empty without a target level; keep that and
    // add only the not-recently-rated clause.
    return buildNotRecentlyRatedClause();
  }

  const tokens: FilterToken[] = [
    { instanceId: uniqueId(), kind: 'paren', dir: 'open' },
    statusUntrackedToken(),
    { instanceId: uniqueId(), kind: 'operator', op: 'OR' },
    statusUnknownToken(),
    { instanceId: uniqueId(), kind: 'paren', dir: 'close' },
  ];

  const levels = getFrequencyLevelsAtOrEasierThanTarget(levelNames, targetLevel, languageData);

  if (levels.length > 0) {
    tokens.push(...buildLevelRangeClause(levels));
  }

  // Unconditional: the pool default never re-shows words rated within the
  // cooldown window, whether or not an exam level is set.
  return tokens.concat(buildNotRecentlyRatedClause());
}

// Status clause stays meaningful without a target level; wordSync's preset
// returns only its not-recently-rated clause in that case.
export function buildBulkAddDefaultPreset(
  levelNames: Record<string, string>,
  targetLevel: number | null | undefined,
  languageData?: LanguageData | null,
): FilterToken[] {
  const tokens: FilterToken[] = [
    { instanceId: uniqueId(), kind: 'paren', dir: 'open' },
    statusUntrackedToken(),
    { instanceId: uniqueId(), kind: 'operator', op: 'OR' },
    statusUnknownToken(),
    { instanceId: uniqueId(), kind: 'operator', op: 'OR' },
    statusLearningToken(),
    { instanceId: uniqueId(), kind: 'paren', dir: 'close' },
  ];

  if (targetLevel === null || targetLevel === undefined) {
    return tokens;
  }

  const levels = getFrequencyLevelsAtOrEasierThanTarget(levelNames, targetLevel, languageData);
  if (levels.length === 0) {
    return tokens;
  }

  return tokens.concat(buildLevelRangeClause(levels));
}

function buildLevelRangeClause(levels: number[]): FilterToken[] {
  const tokens: FilterToken[] = [
    { instanceId: uniqueId(), kind: 'operator', op: 'AND' },
    { instanceId: uniqueId(), kind: 'paren', dir: 'open' },
  ];

  levels.forEach((level, index) => {
    if (index > 0) {
      tokens.push({ instanceId: uniqueId(), kind: 'operator', op: 'OR' });
    }

    tokens.push({
      instanceId: uniqueId(),
      kind: 'operand',
      field: LEVEL_FIELD,
      op: 'eq',
      value: String(level),
    });
  });

  tokens.push({ instanceId: uniqueId(), kind: 'paren', dir: 'close' });

  return tokens;
}

function buildNotRecentlyRatedClause(): FilterToken[] {
  return [
    { instanceId: uniqueId(), kind: 'operator', op: 'AND' },
    { instanceId: uniqueId(), kind: 'operand', field: RECENCY_FIELD, op: 'eq', value: 'false' },
  ];
}

export function buildEmptyPreset(): FilterToken[] {
  return [];
}

export function statusResolver<R extends { status: number }>(): FieldResolver<R> {
  return {
    read: (record) => record.status,
    valueLabel: (value) => value,
  };
}

export function levelResolver<R extends { level: number | null | undefined }>(): FieldResolver<R> {
  return {
    read: (record) => record.level,
    valueLabel: (value) => value,
  };
}

export function sourceResolver<R extends { knowledgeSource?: string }>(): FieldResolver<R> {
  return {
    read: (record) => record.knowledgeSource ?? 'None',
    valueLabel: (value) => value,
  };
}

export function recencyResolver<R extends { seenRecently: boolean }>(): FieldResolver<R> {
  return {
    read: (record) => record.seenRecently,
    valueLabel: (value) => value,
  };
}

export function buildWordSyncFields(
  levelNames: Record<string, string>,
  t: Translate,
  languageData?: LanguageData | null,
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildStatusField(t, { includeUntracked: true }),
    buildLevelField(levelNames, t, languageData),
    buildRecencyField(t),
  ];

  return { fields, paletteItems: buildPaletteItems(fields, t) };
}

export function buildLevelStudyBulkAddFields(
  levelNames: Record<string, string>,
  t: Translate,
  languageData?: LanguageData | null,
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildStatusField(t, { includeUntracked: true }),
    buildLevelField(levelNames, t, languageData),
  ];

  return { fields, paletteItems: buildPaletteItems(fields, t) };
}

export function buildWordDbEditorFields(
  levelNames: Record<string, string>,
  t: Translate,
  languageData?: LanguageData | null,
  resolverOverrides: Record<string, FieldResolver<unknown>> = {},
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildStatusField(t),
    buildLevelField(levelNames, t, languageData),
    buildSourceField(t),
  ].map((field) => {
    const override = resolverOverrides[field.field];
    return override ? { ...field, resolver: override } : field;
  });

  return { fields, paletteItems: buildPaletteItems(fields, t) };
}

export function buildFlashcardBrowseFields(
  languageNames: Record<string, string>,
  t: Translate,
  levelContext?: { levelNames: Record<string, string>; languageData?: LanguageData | null },
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildFlashcardStateField(t),
    buildFlashcardLanguageField(languageNames, t),
    buildFlashcardSuspendedField(t),
    buildFlashcardBuriedField(t),
  ];

  // The Level field is per-language and only meaningful when the browse is scoped
  // to a single language (its values enumerate that language's level system).
  if (levelContext) {
    fields.push(buildFlashcardLevelField(levelContext.levelNames, t, levelContext.languageData));
  }

  return { fields, paletteItems: buildPaletteItems(fields, t) };
}

function statusUnknownToken(): FilterToken {
  return {
    instanceId: uniqueId(),
    kind: 'operand',
    field: STATUS_FIELD,
    op: 'eq',
    value: String(WORD_STATUS.UNKNOWN),
  };
}

function statusUntrackedToken(): FilterToken {
  return {
    instanceId: uniqueId(),
    kind: 'operand',
    field: STATUS_FIELD,
    op: 'eq',
    value: WORD_SYNC_STATUS_UNTRACKED,
  };
}

function statusLearningToken(): FilterToken {
  return {
    instanceId: uniqueId(),
    kind: 'operand',
    field: STATUS_FIELD,
    op: 'eq',
    value: String(WORD_STATUS.LEARNING),
  };
}

function buildStatusField(t: Translate, options: { includeUntracked?: boolean } = {}): FieldConfig<unknown> {
  return {
    field: STATUS_FIELD,
    label: t('mlearn.FilterBuilder.Field.Status'),
    allowedOps: [...EQ_OPS],
    values: [
      ...(options.includeUntracked
        ? [{ value: WORD_SYNC_STATUS_UNTRACKED, label: t('mlearn.FilterBuilder.Status.Untracked') }]
        : []),
      { value: String(WORD_STATUS.UNKNOWN), label: t('mlearn.FilterBuilder.Status.Unknown') },
      { value: String(WORD_STATUS.LEARNING), label: t('mlearn.FilterBuilder.Status.Learning') },
      { value: String(WORD_STATUS.KNOWN), label: t('mlearn.FilterBuilder.Status.Known') },
    ],
    resolver: propertyResolver('status'),
  };
}

// Reads the per-language frequency level off a flashcard's nested content.
// Missing/non-numeric level resolves to '', which normalizeLevelValue maps to NO_LEVEL.
function flashcardLevelResolver(record: unknown): unknown {
  const content = record && typeof record === 'object' ? (record as { content?: { level?: number } }).content : undefined;
  return typeof content?.level === 'number' ? content.level : '';
}

function buildFlashcardLevelField(
  levelNames: Record<string, string>,
  t: Translate,
  languageData?: LanguageData | null,
): FieldConfig<unknown> {
  return {
    field: LEVEL_FIELD,
    label: t('mlearn.FilterBuilder.Field.Level'),
    allowedOps: [...EQ_OPS],
    values: buildLevelValues(levelNames, t, languageData),
    resolver: {
      read: (record) => normalizeLevelValue(flashcardLevelResolver(record), levelNames, languageData),
      valueLabel: (value) => value,
    },
  };
}

function buildLevelField(levelNames: Record<string, string>, t: Translate, languageData?: LanguageData | null): FieldConfig<unknown> {
  const readRawLevel = propertyResolver('level').read;
  return {
    field: LEVEL_FIELD,
    label: t('mlearn.FilterBuilder.Field.Level'),
    allowedOps: [...EQ_OPS],
    values: buildLevelValues(levelNames, t, languageData),
    resolver: {
      read: (record) => normalizeLevelValue(readRawLevel(record), levelNames, languageData),
      valueLabel: (value) => value,
    },
  };
}

function buildSourceField(t: Translate): FieldConfig<unknown> {
  return {
    field: SOURCE_FIELD,
    label: t('mlearn.FilterBuilder.Field.Source'),
    allowedOps: [...EQ_OPS],
    values: [
      ...KNOWLEDGE_SOURCES.map((source) => {
        const displayName = KNOWLEDGE_SOURCE_DISPLAY_NAMES[source];
        return {
          value: displayName,
          label: t(`mlearn.WordDbEditor.SourceFilter.${displayName}`),
        };
      }),
      { value: 'Manual', label: t('mlearn.WordDbEditor.SourceFilter.Manual') },
      { value: 'None', label: t('mlearn.WordDbEditor.SourceFilter.None') },
    ],
    resolver: propertyResolver('knowledgeSource', 'None'),
  };
}

function buildRecencyField(t: Translate): FieldConfig<unknown> {
  return {
    field: RECENCY_FIELD,
    label: t('mlearn.FilterBuilder.Field.Recency'),
    allowedOps: [...EQ_OPS],
    values: [
      { value: 'true', label: t('mlearn.FilterBuilder.Recency.Recent') },
      { value: 'false', label: t('mlearn.FilterBuilder.Recency.NotRecent') },
    ],
    resolver: propertyResolver('seenRecently'),
  };
}

function buildFlashcardStateField(t: Translate): FieldConfig<unknown> {
  return {
    field: FLASHCARD_STATE_FIELD,
    label: t('mlearn.FilterBuilder.Field.State'),
    allowedOps: [...EQ_OPS],
    values: [
      { value: 'new', label: t('mlearn.Flashcards.State.New') },
      { value: 'learning', label: t('mlearn.Flashcards.State.Learning') },
      { value: 'relearning', label: t('mlearn.Flashcards.State.Relearning') },
      { value: 'review', label: t('mlearn.Flashcards.State.Review') },
    ],
    resolver: propertyResolver('state'),
  };
}

function buildFlashcardLanguageField(languageNames: Record<string, string>, t: Translate): FieldConfig<unknown> {
  return {
    field: FLASHCARD_LANGUAGE_FIELD,
    label: t('mlearn.FilterBuilder.Field.Language'),
    allowedOps: [...EQ_OPS],
    values: Object.entries(languageNames).map(([code, name]) => ({ value: code, label: name })),
    resolver: propertyResolver('language', ''),
  };
}

function buildBooleanValues(t: Translate): { value: string; label: string }[] {
  return [
    { value: 'true', label: t('mlearn.FilterBuilder.Bool.True') },
    { value: 'false', label: t('mlearn.FilterBuilder.Bool.False') },
  ];
}

function buildFlashcardSuspendedField(t: Translate): FieldConfig<unknown> {
  return {
    field: FLASHCARD_SUSPENDED_FIELD,
    label: t('mlearn.FilterBuilder.Field.Suspended'),
    allowedOps: [...EQ_OPS],
    values: buildBooleanValues(t),
    resolver: propertyResolver('suspended', false),
  };
}

function buildFlashcardBuriedField(t: Translate): FieldConfig<unknown> {
  return {
    field: FLASHCARD_BURIED_FIELD,
    label: t('mlearn.FilterBuilder.Field.Buried'),
    allowedOps: [...EQ_OPS],
    values: buildBooleanValues(t),
    resolver: propertyResolver('buried', false),
  };
}

function buildPaletteItems(fields: FieldConfig<unknown>[], t: Translate): PaletteItem[] {
  const operands = fields.flatMap((field) => field.values.flatMap((value) => field.allowedOps.map((op) => ({
    field: field.field,
    op,
    value: value.value,
    label: value.label,
  }))));

  return [
    ...operands,
    { kind: 'operator', op: 'AND', label: t('mlearn.FilterBuilder.Op.And') },
    { kind: 'operator', op: 'OR', label: t('mlearn.FilterBuilder.Op.Or') },
    { kind: 'not', label: t('mlearn.FilterBuilder.Op.Not') },
    { kind: 'paren', dir: 'open', label: t('mlearn.FilterBuilder.Paren.Open') },
    { kind: 'paren', dir: 'close', label: t('mlearn.FilterBuilder.Paren.Close') },
  ];
}

function propertyResolver(property: string, fallback?: unknown): FieldResolver<unknown> {
  return {
    read: (record) => {
      if (typeof record !== 'object' || record === null || !(property in record)) {
        return fallback;
      }

      return (record as Record<string, unknown>)[property] ?? fallback;
    },
    valueLabel: (value) => value,
  };
}
