import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import {
  classifyGrammarMeasurements,
  grammarLevelName,
} from '../../utils/curriculumCoverage';
import type { AttemptQuality } from '../../../shared/constants';
import type { LanguageData } from '../../../shared/types';
import type { CurriculumComponentSummary } from '../../../shared/curriculum';
import type { KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import './GrammarCoverage.css';

export interface GrammarCoverageProps {
  language: string;
  languageData: LanguageData;
  /** Capability-scoped journal for the language (already loaded by the tab). */
  eventLog: KnowledgeEventLog;
  summary: CurriculumComponentSummary;
  /** Records a grammar-recognize probe (self-assessed construction recognition). */
  onProbe: (pattern: string, quality: AttemptQuality, level: number) => void;
}

interface ConstructionRow {
  pattern: string;
  meaning?: string;
  state: 'known' | 'learning' | 'unknown' | 'unmeasured';
  passiveOnly: boolean;
  exposures: number;
}

const STATE_LABEL_KEY: Record<ConstructionRow['state'], string> = {
  known: 'mlearn.LevelStudy.Grammar.State.Known',
  learning: 'mlearn.LevelStudy.Grammar.State.Learning',
  unknown: 'mlearn.LevelStudy.Grammar.State.Unknown',
  unmeasured: 'mlearn.LevelStudy.Grammar.State.Unmeasured',
};

/**
 * Grammar curriculum coverage, aggregated over the package's OWN grammar
 * scale — displayed beside (never merged into) the vocabulary frequency
 * levels. A construction is "measured" only through active evidence
 * (probes, anki imports); passive encounter rollups stay familiarity.
 */
export const GrammarCoverage: Component<GrammarCoverageProps> = (props) => {
  const { t } = useLocalization();
  const [expandedLevel, setExpandedLevel] = createSignal<number | null>(null);

  const measurements = createMemo(() => classifyGrammarMeasurements(props.language, props.eventLog));

  const constructionsByLevel = createMemo(() => {
    const byLevel = new Map<number, ConstructionRow[]>();
    const measured = measurements();
    for (const point of props.languageData.grammar ?? []) {
      if (typeof point.level !== 'number') continue;
      const measurement = measured.get(point.pattern);
      const rows = byLevel.get(point.level) ?? [];
      rows.push({
        pattern: point.pattern,
        ...(point.meaning !== undefined ? { meaning: point.meaning } : {}),
        state: measurement?.state ?? 'unmeasured',
        passiveOnly: measurement?.passiveOnly ?? true,
        exposures: measurement?.exposures ?? 0,
      });
      byLevel.set(point.level, rows);
    }
    return byLevel;
  });

  return (
    <section class="grammar-coverage" aria-label={t('mlearn.LevelStudy.Grammar.Title')}>
      <div class="grammar-coverage__header">
        <h3 class="grammar-coverage__title">{t('mlearn.LevelStudy.Grammar.Title')}</h3>
        <span class="grammar-coverage__totals">
          {t('mlearn.LevelStudy.Grammar.Totals', {
            known: props.summary.known,
            total: props.summary.total,
          })}
        </span>
      </div>
      <div class="grammar-coverage__levels">
        <For each={props.summary.buckets.filter((bucket) => bucket.total > 0)}>
          {(bucket) => {
            const level = bucket.level as number;
            const measured = bucket.total - bucket.unmeasured;
            const measuredPct = bucket.total > 0 ? (measured / bucket.total) * 100 : 0;
            const knownPct = bucket.total > 0 ? (bucket.known / bucket.total) * 100 : 0;
            const open = () => expandedLevel() === level;
            return (
              <div class="grammar-coverage__level">
                <button
                  type="button"
                  class="grammar-coverage__level-row"
                  onClick={() => setExpandedLevel(open() ? null : level)}
                  aria-expanded={open()}
                >
                  <span class="grammar-coverage__level-name">{grammarLevelName(level, props.languageData)}</span>
                  <span class="grammar-coverage__level-bar" role="img" aria-label={`${measured}/${bucket.total}`}>
                    <span class="grammar-coverage__bar-known" style={{ width: `${knownPct}%` }} />
                    <span
                      class="grammar-coverage__bar-measured"
                      style={{ width: `${Math.max(0, measuredPct - knownPct)}%` }}
                    />
                  </span>
                  <span class="grammar-coverage__level-counts">
                    {t('mlearn.LevelStudy.Grammar.BucketCounts', {
                      measured,
                      total: bucket.total,
                      unmeasured: bucket.unmeasured,
                    })}
                  </span>
                </button>
                <Show when={open()}>
                  <ul class="grammar-coverage__constructions">
                    <For each={constructionsByLevel().get(level) ?? []}>
                      {(row) => (
                        <li class="grammar-coverage__construction">
                          <span class="grammar-coverage__pattern">{row.pattern}</span>
                          <Show when={row.meaning}>
                            <span class="grammar-coverage__meaning">{row.meaning}</span>
                          </Show>
                          <span class={`grammar-coverage__state grammar-coverage__state--${row.state}`}>
                            {t(STATE_LABEL_KEY[row.state])}
                            <Show when={row.state === 'unmeasured' && row.exposures > 0}>
                              {' '}· {t('mlearn.LevelStudy.Grammar.SeenOnly', { count: row.exposures })}
                            </Show>
                          </span>
                          <span class="grammar-coverage__probe">
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'missed', level)}>
                              {t('mlearn.Rating.Matrix.Missed')}
                            </button>
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'struggled', level)}>
                              {t('mlearn.Rating.Matrix.Struggled')}
                            </button>
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'fluent', level)}>
                              {t('mlearn.Rating.Matrix.Fluent')}
                            </button>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
};

export default GrammarCoverage;
