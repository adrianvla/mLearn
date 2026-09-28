/**
 * Curriculum coverage aggregation for the Level Study surface.
 *
 * Grammar coverage aggregates over the language package's OWN grammar scale
 * (`grammarLevels` names, `GrammarPoint.level`) — never merged with the
 * frequency scale by numeric equality. Measurement classification reads the
 * capability-scoped journal directly: active rating evidence (interactive
 * probes, anki imports, legacy ease outcomes) measures the construction;
 * passive encounter rollups are familiarity only and never become progress.
 */

import type { LanguageData } from '../../shared/types';
import {
  summarizeCurriculumComponent,
  type CurriculumComponentSummary,
  type CurriculumRequirement,
  type CurriculumTargetState,
} from '../../shared/curriculum';
import { grammarPatternFromEvidenceKey } from '../../shared/grammar/evidence';
import { evidenceStatusFromEase, effectiveThresholds, type EffectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { sortGrammarLevelsByDifficulty } from '../../shared/languageFeatures';
import { grammarEntityId } from '../../shared/graph/load';
import type { GrammarProjectionMap } from '../../shared/knowledge/historyQueries';

export interface GrammarMeasurement {
  state: CurriculumTargetState;
  /** Encounter rollups only — the construction was seen, never measured. */
  passiveOnly: boolean;
  exposures: number;
  failures: number;
}

/**
 * Category-bottleneck pressure (R07): mean insecurity of ACTIVELY
 * measured constructions per package-declared category, in [0, 1]. A
 * category whose measured constructions stay insecure is a bottleneck (unknown = full
 * deficit, learning = half); its constructions gain curriculum-relevance in
 * the teaching policy's SAME weighted pick (no separate scheduler). Bounded
 * labelled heuristic — a selection signal only, never evidence, and
 * categories without ACTIVELY measured constructions stay absent (passive
 * exposure and empty journals invent no pressure).
 */
export function grammarCategoryPressure(
  items: ReadonlyArray<{ pattern: string; category?: string }>,
  measurements: ReadonlyMap<string, GrammarMeasurement>,
): Record<string, number> {
  const totals = new Map<string, { deficit: number; measured: number }>();
  for (const item of items) {
    if (!item.category) continue;
    const measurement = measurements.get(item.pattern);
    // Active evidence only: passive encounter rollups are familiarity, not
    // measured attempts, and never invent pressure.
    if (!measurement || measurement.passiveOnly) continue;
    const total = totals.get(item.category) ?? { deficit: 0, measured: 0 };
    total.measured += 1;
    total.deficit += measurement.state === 'unknown' ? 1 : measurement.state === 'learning' ? 0.5 : 0;
    totals.set(item.category, total);
  }
  const pressure: Record<string, number> = {};
  for (const [category, total] of totals) {
    // Mean insecurity of the category's measured constructions: every
    // pattern unknown → 1, every pattern known → 0.
    if (total.measured > 0) pressure[category] = Math.min(1, total.deficit / total.measured);
  }
  return pressure;
}

/** One requirement per package-declared grammar construction with a curriculum level. */
export function grammarCurriculumRequirements(language: string, languageData: LanguageData): CurriculumRequirement[] {
  return (languageData.grammar ?? [])
    .filter((point) => typeof point.level === 'number')
    .map((point) => ({
      component: 'grammar',
      level: point.level!,
      label: point.pattern,
      target: { entityId: grammarEntityId(language, point.pattern), capability: 'grammar-recognition' as const },
    }));
}

/** Grammar levels of the package's own scale, easiest first. */
export function grammarLevelOrder(languageData: LanguageData): number[] {
  const levels = [...new Set((languageData.grammar ?? [])
    .map((point) => point.level)
    .filter((level): level is number => typeof level === 'number'))];
  return sortGrammarLevelsByDifficulty(levels, languageData);
}

/** Bucket label from the package's grammar scale names; falls back to the raw level. */
export function grammarLevelName(level: number, languageData: LanguageData): string {
  return languageData.grammarLevels?.names?.[String(level)] ?? String(level);
}

/**
 * Classifies every grammar construction in the recognition read model.
 *
 * The `GrammarProjectionMap` is the ONLY input: the journal-side fold that
 * produces it is the same algorithm on every platform (SQLite beside the
 * rows, array replay on mobile), so a second journal-scanning classifier
 * could only ever disagree with it.
 */
export function classifyGrammarMeasurements(
  language: string,
  projections: GrammarProjectionMap,
  thresholds: EffectiveThresholds = effectiveThresholds(),
): Map<string, GrammarMeasurement> {
  const measurements = new Map<string, GrammarMeasurement>();
  for (const [key, projection] of Object.entries(projections)) {
    const pattern = grammarPatternFromEvidenceKey(language, key);
    if (pattern === null) continue;
    const measured = projection.hasActiveEvidence;
    measurements.set(pattern, {
      state: measured ? evidenceStatusFromEase(projection.ease, thresholds) : 'unmeasured',
      passiveOnly: !measured,
      exposures: projection.timesEncountered,
      failures: projection.timesFailed,
    });
  }
  return measurements;
}

/** Per-level grammar coverage summary for the Level Study surface. */
export function summarizeGrammarCurriculum(
  language: string,
  languageData: LanguageData,
  projections: GrammarProjectionMap,
  thresholds: EffectiveThresholds = effectiveThresholds(),
): CurriculumComponentSummary {
  return summarizeCurriculumComponent(
    'grammar',
    grammarCurriculumRequirements(language, languageData),
    grammarLevelOrder(languageData),
    (requirement) => classifyGrammarMeasurements(language, projections, thresholds).get(requirement.label)?.state ?? 'unmeasured',
  );
}

