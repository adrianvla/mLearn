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
import { replayGrammarRecognition } from '../../shared/grammar/evidence';
import { stripRetractions, type KnowledgeEvent, type KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { evidenceStatusFromEase, effectiveThresholds, type EffectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { sortGrammarLevelsByDifficulty } from '../../shared/languageFeatures';
import { grammarEntityId } from '../../shared/graph/load';

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
 * Classifies every grammar construction found in the journal. Keys ending in
 * `:grammar-recognition` carry capability-scoped evidence; the pattern is
 * recovered from the embedded entity id (same shape the materialization uses).
 */
export function classifyGrammarMeasurements(
  language: string,
  eventLog: KnowledgeEventLog,
  thresholds: EffectiveThresholds = effectiveThresholds(),
): Map<string, GrammarMeasurement> {
  const suffix = ':grammar-recognition';
  const prefix = `${language}:grammar:`;
  const byPattern = new Map<string, KnowledgeEvent[]>();
  for (const key of Object.keys(eventLog)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const entityId = key.slice(prefix.length, key.length - suffix.length);
    if (!entityId.startsWith(prefix)) continue;
    const pattern = entityId.slice(prefix.length);
    if (!pattern) continue;
    const events = byPattern.get(pattern) ?? [];
    events.push(...eventLog[key] ?? []);
    byPattern.set(pattern, events);
  }

  const measurements = new Map<string, GrammarMeasurement>();
  for (const [pattern, events] of byPattern) {
    const active = stripRetractions(events);
    let exposures = 0;
    let failures = 0;
    for (const event of active) {
      exposures += event.timesSeenDelta ?? 0;
      failures += event.grammarFailedDelta ?? 0;
    }
    // Replay the COMPLETE ordered sequence — rating, failure, and encounter
    // rows together — so coverage classification is ledger-exact with the
    // materialized GrammarSelector projection. Filtering delta rows out
    // (the pre-review behavior) let a rating followed by a failure rollup
    // read Known here while the selector read Learning (R01 same-state).
    const projection = replayGrammarRecognition(active);
    const measured = projection?.hasActiveEvidence === true;
    const state: CurriculumTargetState = measured
      ? evidenceStatusFromEase(projection!.ease, thresholds)
      : 'unmeasured';
    measurements.set(pattern, {
      state,
      passiveOnly: !measured,
      exposures,
      failures,
    });
  }
  return measurements;
}

/** Per-level grammar coverage summary for the Level Study surface. */
export function summarizeGrammarCurriculum(
  language: string,
  languageData: LanguageData,
  eventLog: KnowledgeEventLog,
  thresholds: EffectiveThresholds = effectiveThresholds(),
): CurriculumComponentSummary {
  const requirements = grammarCurriculumRequirements(language, languageData);
  const measurements = classifyGrammarMeasurements(language, eventLog, thresholds);
  return summarizeCurriculumComponent(
    'grammar',
    requirements,
    grammarLevelOrder(languageData),
    (requirement) => measurements.get(requirement.label)?.state ?? 'unmeasured',
  );
}
