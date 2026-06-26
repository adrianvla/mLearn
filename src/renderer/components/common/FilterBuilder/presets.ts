import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, KNOWLEDGE_SOURCES, WORD_STATUS } from '@shared/constants';
import type { FieldConfig, PaletteItem } from './fieldConfig';
import type { FieldResolver, FilterToken } from './filterExpr';
import { uniqueId } from './filterExpr';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const STATUS_FIELD = 'status';
const LEVEL_FIELD = 'level';
const SOURCE_FIELD = 'source';
const RECENCY_FIELD = 'recency';
const EQ_OPS = ['eq'] as const;

export function buildWordSyncPreset(
  levelNames: Record<string, string>,
  targetLevel: number | null | undefined,
): FilterToken[] {
  if (targetLevel === null || targetLevel === undefined) {
    return [];
  }

  const levels: number[] = [];
  for (let level = 5; level >= targetLevel; level -= 1) {
    if (levelNames[String(level)]) {
      levels.push(level);
    }
  }

  if (levels.length === 0) {
    return [statusUnknownToken()];
  }

  const tokens: FilterToken[] = [
    statusUnknownToken(),
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

export function buildEmptyPreset(): FilterToken[] {
  return [];
}

export function statusResolver<R extends { status: number }>(): FieldResolver<R> {
  return {
    read: (record) => record.status,
    valueLabel: (value) => value,
  };
}

export function levelResolver<R extends { level: number }>(): FieldResolver<R> {
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
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildStatusField(t),
    buildLevelField(levelNames, t),
    buildRecencyField(t),
  ];

  return { fields, paletteItems: buildPaletteItems(fields, t) };
}

export function buildWordDbEditorFields(
  levelNames: Record<string, string>,
  t: Translate,
): { fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] } {
  const fields: FieldConfig<unknown>[] = [
    buildStatusField(t),
    buildLevelField(levelNames, t),
    buildSourceField(t),
  ];

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

function buildStatusField(t: Translate): FieldConfig<unknown> {
  return {
    field: STATUS_FIELD,
    label: t('mlearn.FilterBuilder.Field.Status'),
    allowedOps: [...EQ_OPS],
    values: [
      { value: String(WORD_STATUS.UNKNOWN), label: t('mlearn.FilterBuilder.Status.Unknown') },
      { value: String(WORD_STATUS.LEARNING), label: t('mlearn.FilterBuilder.Status.Learning') },
      { value: String(WORD_STATUS.KNOWN), label: t('mlearn.FilterBuilder.Status.Known') },
    ],
    resolver: propertyResolver('status'),
  };
}

function buildLevelField(levelNames: Record<string, string>, t: Translate): FieldConfig<unknown> {
  const sortedLevels = Object.entries(levelNames).sort(([left], [right]) => Number(right) - Number(left));

  return {
    field: LEVEL_FIELD,
    label: t('mlearn.FilterBuilder.Field.Level'),
    allowedOps: [...EQ_OPS],
    values: [
      ...sortedLevels.map(([value, label]) => ({ value, label })),
      { value: '0', label: t('mlearn.WordDbEditor.LevelNames.Common') },
      { value: '-1', label: t('mlearn.WordDbEditor.LevelNames.Unlisted') },
    ],
    resolver: propertyResolver('level'),
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
