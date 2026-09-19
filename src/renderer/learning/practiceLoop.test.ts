import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { CurriculumGrammarItem } from './candidateSources';
import { selectNextEncounter } from './engine';
import { GRAMMAR_RECOGNIZE_TASK } from './types';
import { classifyGrammarMeasurements, grammarLevelName, summarizeGrammarCurriculum } from '../utils/curriculumCoverage';
import {
  grammarEvidenceKey,
  grammarRecognitionEvidence,
  grammarTarget,
  replayGrammarRecognition,
} from '../../shared/grammar/evidence';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import {
  evidenceStatusFromEase,
  effectiveThresholds,
  type EffectiveThresholds,
} from '../../shared/knowledge/effectiveKnowledge';
import { getDictionaryTargetLanguageForSettings } from '../utils/dictionaryTargetLanguage';
import type { LanguageData } from '../../shared/types';

/**
 * W02 acceptance loop over the REAL language packages (source of truth for
 * packaging: scripts/language-data/source/root-of-app/languages), per
 * first-class curriculum language:
 *
 *   package-declared category → TeachingPolicy selectNextEncounter (CURRICULUM
 *   preset, no cards, no add-card ceremony) → the real grammar-recognize
 *   activity writing through the canonical journal helpers
 *   (grammarRecognitionEvidence — the same helpers the FlashcardContext
 *   writers call) → Progress aggregation (summarizeGrammarCurriculum) →
 *   cross-consumer agreement with the materialized recognition projection.
 *
 * Scale names/direction come FROM the packages (de: CEFR A2→B2, ja: JLPT
 * lower-is-harder, zh: Beginner→Advanced) — the mechanism stays generic.
 * NOTE: these are the packaging SOURCE files; the installed/remote catalog
 * is refreshed only by the (campaign-blocked) publish step.
 */

const REPO = process.cwd();
const packagePath = (language: string): string =>
  path.join(REPO, 'scripts/language-data/source/root-of-app/languages', `${language}.json`);

const PACKAGES = {
  de: JSON.parse(fs.readFileSync(packagePath('de'), 'utf8')) as LanguageData,
  ja: JSON.parse(fs.readFileSync(packagePath('ja'), 'utf8')) as LanguageData,
  zh: JSON.parse(fs.readFileSync(packagePath('zh'), 'utf8')) as LanguageData,
};

const thresholds: EffectiveThresholds = effectiveThresholds({ easeThresholdLearning: 1.5, easeThresholdKnown: 3.0 });

interface Scenario {
  /** Rated well (→ learning under the test thresholds). */
  learning: string;
  /** Rated high (→ known). */
  known: string;
  /** Interactive failure (→ measured unknown). */
  failed: string;
  /** Passive encounter rollup only (→ familiarity, never measured). */
  passive: string;
}

/** Deterministic per-language scenario picks from the real package data. */
function scenarioFor(language: 'de' | 'ja' | 'zh'): Scenario {
  const points = (PACKAGES[language].grammar ?? []).filter((point) => typeof point.level === 'number');
  expect(points.length).toBeGreaterThanOrEqual(4);
  const byPattern = new Map(points.map((point) => [point.pattern, point]));
  const learning = points[0].pattern;
  const known = points.find((point) => point.pattern !== learning && point.level === points[0].level)?.pattern
    ?? points[1].pattern;
  const harder = points.filter((point) => point.pattern !== learning && point.pattern !== known);
  const failed = harder[harder.length - 1].pattern;
  const passive = harder[Math.floor(harder.length / 2)].pattern;
  expect(byPattern.has(learning) && byPattern.has(known) && byPattern.has(failed) && byPattern.has(passive)).toBe(true);
  return { learning, known, failed, passive };
}

const SCENARIOS: Record<'de' | 'ja' | 'zh', Scenario> = {
  de: scenarioFor('de'),
  ja: scenarioFor('ja'),
  zh: scenarioFor('zh'),
};

function keyEvents(entries: Array<{ language: string; pattern: string; event: Omit<KnowledgeEvent, 'source' | 'aspect' | 'targetRef'> }>): KnowledgeEventLog {
  const log: KnowledgeEventLog = {};
  for (const { language, pattern, event } of entries) {
    (log[grammarEvidenceKey(language, pattern, 'grammar-recognition')] ??= [])
      .push(grammarRecognitionEvidence(language, pattern, event));
  }
  return log;
}

function journals(): Record<'de' | 'ja' | 'zh', KnowledgeEventLog> {
  const build = (language: 'de' | 'ja' | 'zh', scenario: Scenario): KnowledgeEventLog => keyEvents([
    { language, pattern: scenario.learning, event: { t: 1_000, kind: 'rating', quality: 'fluent', easeAfter: 2.2, attemptId: `${language}:learning:1` } },
    { language, pattern: scenario.known, event: { t: 1_100, kind: 'rating', quality: 'fluent', easeAfter: 3.2, attemptId: `${language}:known:1` } },
    { language, pattern: scenario.failed, event: { t: 600, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' } },
    { language, pattern: scenario.passive, event: { t: 500, kind: 'rollup', timesSeenDelta: 3 } },
  ]);
  return {
    de: build('de', SCENARIOS.de),
    ja: build('ja', SCENARIOS.ja),
    zh: build('zh', SCENARIOS.zh),
  };
}

const JOURNALS = journals();

function grammarItems(language: 'de' | 'ja' | 'zh', weightByPattern: Record<string, number>): CurriculumGrammarItem[] {
  return (PACKAGES[language].grammar ?? [])
    .filter((point) => typeof point.level === 'number')
    .map((point) => ({
      language,
      pattern: point.pattern,
      level: point.level!,
      weight: weightByPattern[point.pattern] ?? 1,
    }));
}

function patternFromKey(evidenceKey: string): string {
  // Keys are `${language}:grammar:${language}:grammar:${pattern}:${capability}`.
  const withoutCapability = evidenceKey.slice(0, evidenceKey.lastIndexOf(':'));
  const language = withoutCapability.split(':')[0];
  return withoutCapability.slice(`${language}:grammar:${language}:grammar:`.length);
}

describe.each(['de', 'ja', 'zh'] as const)('practice loop on the real %s package', (language) => {
  const data = PACKAGES[language];
  const scenario = SCENARIOS[language];

  it('exposes package grammar on a package-declared scale for the loop', () => {
    const requirements = (data.grammar ?? []).filter((point) => typeof point.level === 'number');
    expect(requirements.length).toBeGreaterThan(0);
    // Every scenario pattern is package-declared; every used level has a
    // package-declared scale name (de: CEFR, ja: JLPT, zh: proficiency bands).
    for (const pattern of [scenario.learning, scenario.known, scenario.failed, scenario.passive]) {
      const point = (data.grammar ?? []).find((candidate) => candidate.pattern === pattern);
      expect(point).toBeDefined();
      expect(grammarLevelName(point!.level!, data)).toBeTruthy();
    }
  });

  it('policy selects the weighted package construction with the grammar task, without any cards', () => {
    const weighted: Record<string, number> = {};
    for (const point of data.grammar ?? []) weighted[point.pattern] = 0;
    weighted[scenario.learning] = 1;

    // CURRICULUM preset with zero lexical study items and zero card inputs:
    // category → Practise works with no add-cards ceremony and no compulsory
    // card creation (dictionary-only users included).
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      levelStudyItems: [],
      curriculumGrammarItems: grammarItems(language, weighted),
      nowMs: 10_000,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('TEACH');
    expect(decision!.candidate.key).toBe(`${language}:grammar:${scenario.learning}`);
    expect(decision!.encounter.task).toBe(GRAMMAR_RECOGNIZE_TASK);
    expect(decision!.encounter.targets).toEqual([
      grammarTarget(language, scenario.learning, 'grammar-recognition'),
    ]);
  });

  it('a fresh journal is unmeasured — never pre-counted as unknown or known', () => {
    const summary = summarizeGrammarCurriculum(language, data, {}, thresholds);
    expect(summary.total).toBe((data.grammar ?? []).length);
    expect(summary.unmeasured).toBe((data.grammar ?? []).length);
    expect(summary.known).toBe(0);
    expect(summary.unknown).toBe(0);
    expect(summary.complete).toBe(false);
  });

  it('recorded practice reaches the Progress/Inspector aggregation with honest states', () => {
    const summary = summarizeGrammarCurriculum(language, data, JOURNALS[language], thresholds);
    // Real packages hold many more constructions than one practice session
    // measures: partial coverage stays honestly partial (never "complete").
    expect(summary.complete).toBe(false);
    expect(summary.known + summary.learning + summary.unknown + summary.unmeasured).toBe(summary.total);
    expect(summary.unmeasured).toBe((data.grammar ?? []).length - 3);

    const measurements = classifyGrammarMeasurements(language, JOURNALS[language], thresholds);
    expect(measurements.get(scenario.learning)).toMatchObject({ state: 'learning', passiveOnly: false });
    expect(measurements.get(scenario.known)).toMatchObject({ state: 'known', passiveOnly: false });
    expect(measurements.get(scenario.failed)).toMatchObject({ state: 'unknown', passiveOnly: false });
    expect(measurements.get(scenario.passive)).toMatchObject({ state: 'unmeasured', passiveOnly: true });
  });

  it('coverage classification agrees with the materialized recognition projection', () => {
    const measurements = classifyGrammarMeasurements(language, JOURNALS[language], thresholds);
    for (const [evidenceKey, events] of Object.entries(JOURNALS[language])) {
      const projection = replayGrammarRecognition(events)!;
      const materialized = projection.hasActiveEvidence
        ? evidenceStatusFromEase(projection.ease, thresholds)
        : 'unmeasured';
      const pattern = patternFromKey(evidenceKey);
      expect(measurements.get(pattern)?.state).toBe(materialized);
    }
  });
});

describe('practice loop invariants across the three languages', () => {
  it('per-language summaries reflect the curated practice outcomes', () => {
    for (const language of ['de', 'ja', 'zh'] as const) {
      const summary = summarizeGrammarCurriculum(language, PACKAGES[language], JOURNALS[language], thresholds);
      expect(summary).toMatchObject({ known: 1, learning: 1, unknown: 1, unmeasured: (PACKAGES[language].grammar ?? []).length - 3 });
    }
  });

  it('retracting the attempt recomputes coverage without deleting unrelated history', () => {
    const scenario = SCENARIOS.de;
    const key = grammarEvidenceKey('de', scenario.learning, 'grammar-recognition');
    const log: KnowledgeEventLog = {
      ...JOURNALS.de,
      [key]: [
        ...JOURNALS.de[key],
        { t: 1_200, kind: 'retraction', source: 'manual', retracts: 'de:learning:1' },
      ],
    };

    const measurements = classifyGrammarMeasurements('de', log, thresholds);
    expect(measurements.get(scenario.learning)).toMatchObject({ state: 'unmeasured', passiveOnly: true });
    // Unrelated history survives the retraction.
    expect(measurements.get(scenario.known)).toMatchObject({ state: 'known' });
  });

  it('G04: an empty CURRICULUM pool yields no decision and writes nothing (dictionary-only path intact)', () => {
    expect(
      selectNextEncounter({ preset: 'CURRICULUM', levelStudyItems: [], curriculumGrammarItems: [], nowMs: 1_000 }),
    ).toBeNull();
  });

  it('zh lexical category candidates derive from the real HSK 3.0 frequency data (lexical/frequency proof only)', () => {
    // Real packaging-source frequency rows: [word, reading, level, domain].
    const freq = JSON.parse(fs.readFileSync(packagePath('zh').replace('zh.json', 'zh.freq.json'), 'utf8')) as Array<[string, string, number, string]>;
    const hsk1Word = freq.find(([word, , level]) => word && level === 1);
    expect(hsk1Word).toBeDefined();

    // The HSK 3.0-labelled scale names that level in production metadata.
    const names = Object.values(PACKAGES.zh.frequencyLevels?.names ?? {});
    expect(names.filter((name) => String(name).startsWith('HSK 3.0')).length).toBeGreaterThanOrEqual(6);
    expect(PACKAGES.zh.frequencyLevels?.names?.['1']).toBe('HSK 3.0 Level 1');

    // A lexical CURRICULUM candidate for that real HSK-1 word is selected
    // cardlessly (metadata-label + generic policy proof — this is NOT the
    // grammar loop and NOT HSK grammar/output acceptance; the zh grammar
    // scale is the package's Beginner→Mastery bands).
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      levelStudyItems: [{ key: `zh:${hsk1Word![0]}`, word: hsk1Word![0], language: 'zh' }],
      nowMs: 10_000,
    });
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('TEACH');
    expect(decision!.encounter.targets[0]).toMatchObject({
      entityId: `zh:surface:${hsk1Word![0]}`,
      capability: 'surface-recognition',
    });
  });

  it('display×learning pairs resolve through the shared per-language override with UI fallback', () => {
    // Spanish UI learning German; Japanese UI learning Russian (no override → UI fallback).
    expect(getDictionaryTargetLanguageForSettings({ language: 'de', uiLanguage: 'es', dictionaryTargetLanguages: {} })).toBe('es');
    expect(getDictionaryTargetLanguageForSettings({ language: 'ru', uiLanguage: 'ja', dictionaryTargetLanguages: {} })).toBe('ja');
    // Explicit per-learning-language override wins over the UI language.
    expect(getDictionaryTargetLanguageForSettings({ language: 'ja', uiLanguage: 'es', dictionaryTargetLanguages: { ja: 'en' } })).toBe('en');
  });
});
