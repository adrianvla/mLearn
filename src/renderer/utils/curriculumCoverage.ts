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
import { easeToStatus } from '../../shared/utils/knowledgeStrength';
import { sortGrammarLevelsByDifficulty } from '../../shared/languageFeatures';
import { grammarEntityId } from '../../shared/graph/load';

export interface GrammarMeasurement {
  state: CurriculumTargetState;
  /** Encounter rollups only — the construction was seen, never measured. */
  passiveOnly: boolean;
  exposures: number;
  failures: number;
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
export function classifyGrammarMeasurements(language: string, eventLog: KnowledgeEventLog): Map<string, GrammarMeasurement> {
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
    const rated: KnowledgeEvent[] = [];
    for (const event of active) {
      exposures += event.timesSeenDelta ?? 0;
      failures += event.grammarFailedDelta ?? 0;
      // Active measurement: interactive ratings, anki imports, and legacy
      // migration rollups with an explicit ease outcome. Pure delta rollups
      // are exposure.
      if (event.kind === 'rating' || event.easeAfter !== undefined) rated.push(event);
    }
    let state: CurriculumTargetState = 'unmeasured';
    if (rated.length > 0) {
      const projection = replayGrammarRecognition(rated);
      if (projection) state = easeToStatus(projection.ease);
      else state = failures > 0 ? 'unknown' : 'learning';
    } else if (failures > 0) {
      state = 'unknown';
    }
    measurements.set(pattern, {
      state,
      passiveOnly: rated.length === 0 && failures === 0,
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
): CurriculumComponentSummary {
  const requirements = grammarCurriculumRequirements(language, languageData);
  const measurements = classifyGrammarMeasurements(language, eventLog);
  return summarizeCurriculumComponent(
    'grammar',
    requirements,
    grammarLevelOrder(languageData),
    (requirement) => measurements.get(requirement.label)?.state ?? 'unmeasured',
  );
}
