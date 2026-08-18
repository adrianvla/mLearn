import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import { getAvailableAspects } from '../../../../shared/types';
import type { WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { getWordFormCandidates } from '../../../utils/wordForms';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import { KnowledgeHistoryGraph } from '../KnowledgeHistoryGraph';
import './WordStatusPillKnowledge.css';

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };

const ASPECT_LABEL_KEYS: Record<KnowledgeAspect, string> = {
  meaning: 'mlearn.Knowledge.Aspect.Meaning',
  reading: 'mlearn.Knowledge.Aspect.Reading',
  prosody: 'mlearn.Knowledge.Aspect.Prosody',
  gender: 'mlearn.Knowledge.Aspect.Gender',
};

const STATUS_LABEL_KEYS: Record<WordStatus, string> = {
  unknown: 'mlearn.WordHover.Status.Unknown',
  learning: 'mlearn.WordHover.Status.Learning',
  known: 'mlearn.WordHover.Status.Known',
};

export interface WordStatusPillKnowledgeProps {
  word: string;
  language?: string;
}

interface AspectState {
  status: WordStatus;
  inherited: boolean;
}

export const WordStatusPillKnowledge: Component<WordStatusPillKnowledgeProps> = (props) => {
  const { setAspectStatus, getComprehensiveWordStatusWithSourceSync, getWordKnowledge } = useFlashcards();
  const { settings } = useSettings();
  const {
    langData,
    currentLangData,
    getCanonicalForm,
    getWordVariants,
    getCanonicalFormForLanguage,
    getWordVariantsForLanguage,
  } = useLanguage();
  const { t } = useLocalization();

  const effectiveLanguage = createMemo(() => props.language ?? settings.language);
  const isActiveLanguage = createMemo(() => effectiveLanguage() === settings.language);
  const languageData = createMemo(() => (
    langData[effectiveLanguage()] ?? (isActiveLanguage() ? currentLangData() : null)
  ));
  const availableAspects = createMemo(() => getAvailableAspects(languageData()));

  const forms = createMemo(() => (
    isActiveLanguage()
      ? getWordFormCandidates(props.word, getCanonicalForm, getWordVariants, { languageData: languageData() })
      : getWordFormCandidates(
        props.word,
        (value) => getCanonicalFormForLanguage(effectiveLanguage(), value),
        (value) => getWordVariantsForLanguage(effectiveLanguage(), value),
        { languageData: languageData() },
      )
  ));

  const meaningResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, effectiveLanguage()));

  // Reading/prosody read the aspect record across every surface-form hash
  // (split-hash unification); with no record on any form they inherit the
  // resolved meaning status. Mirrors getAspectStatusSync semantics via the
  // context API (getWordFormsForLanguage is not exposed by the provider).
  const aspectState = (aspect: KnowledgeAspect): AspectState => {
    if (aspect === 'meaning') {
      return { status: meaningResult().status, inherited: false };
    }
    let best: { status: WordStatus; inherited: boolean; rank: number } | null = null;
    for (const form of forms()) {
      const record = getWordKnowledge(`${effectiveLanguage()}:${hashWordSync(form)}`)?.aspects?.[aspect];
      if (!record) continue;
      const rank = STATUS_RANK[record.status];
      if (best === null || rank > best.rank) {
        best = { status: record.status, inherited: record.inherited === true, rank };
      }
    }
    if (best !== null) return { status: best.status, inherited: best.inherited };
    return { status: meaningResult().status, inherited: true };
  };

  const writeAspect = (aspect: KnowledgeAspect, status: 'learning' | 'unknown') => {
    if (aspect === 'meaning') return;
    setAspectStatus(props.word, aspect, status, 'manual', effectiveLanguage());
  };

  const [graphAspect, setGraphAspect] = createSignal<KnowledgeAspect>('meaning');
  const history = useKnowledgeHistory(() => props.word, graphAspect);
  const graphData = createMemo(() => history.replay());

  return (
    <div class="word-status-knowledge">
      <ul class="word-status-knowledge__aspects">
        <For each={availableAspects()}>
          {(aspect) => {
            const state = aspectState(aspect);
            return (
              <li class="word-status-knowledge__aspect">
                <span class="word-status-knowledge__aspect-label">{t(ASPECT_LABEL_KEYS[aspect])}</span>
                <span class={`word-status-knowledge__aspect-status word-status-knowledge__aspect-status--${state.status}`}>
                  {t(STATUS_LABEL_KEYS[state.status])}
                </span>
                <Show when={state.inherited}>
                  <span class="word-status-knowledge__aspect-inherited">{t('mlearn.Knowledge.AspectInherited')}</span>
                </Show>
                <Show when={aspect !== 'meaning'}>
                  <span class="word-status-knowledge__aspect-actions">
                    <Show when={state.status === 'known'}>
                      <button
                        type="button"
                        class="word-status-knowledge__action"
                        onClick={() => writeAspect(aspect, 'learning')}
                      >
                        {t('mlearn.Knowledge.Actions.DowngradeToLearning')}
                      </button>
                    </Show>
                    <Show when={state.status !== 'unknown'}>
                      <button
                        type="button"
                        class="word-status-knowledge__action"
                        onClick={() => writeAspect(aspect, 'unknown')}
                      >
                        {t('mlearn.Knowledge.Actions.MarkUnknown')}
                      </button>
                    </Show>
                  </span>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <KnowledgeHistoryGraph
        points={graphData().points}
        bands={graphData().bands}
        aspect={graphAspect()}
        availableAspects={availableAspects()}
        onAspectChange={setGraphAspect}
        mode="compact"
        now={Date.now()}
      />
    </div>
  );
};
