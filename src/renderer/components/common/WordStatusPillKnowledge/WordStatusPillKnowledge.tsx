import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import { getAvailableAspects } from '../../../../shared/types';
import { KNOWLEDGE_ASPECT_LABEL_KEYS, type WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import { KnowledgeHistoryGraph } from '../KnowledgeHistoryGraph';
import './WordStatusPillKnowledge.css';

const ASPECT_LABEL_KEYS = KNOWLEDGE_ASPECT_LABEL_KEYS;

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
  untracked: boolean;
}

export const WordStatusPillKnowledge: Component<WordStatusPillKnowledgeProps> = (props) => {
  const { setAspectStatus, getComprehensiveWordStatusWithSourceSync, getAspectStatus } = useFlashcards();
  const { settings } = useSettings();
  const {
    langData,
    currentLangData,
  } = useLanguage();
  const { t } = useLocalization();

  const effectiveLanguage = createMemo(() => props.language ?? settings.language);
  const isActiveLanguage = createMemo(() => effectiveLanguage() === settings.language);
  const languageData = createMemo(() => (
    langData[effectiveLanguage()] ?? (isActiveLanguage() ? currentLangData() : null)
  ));
  const availableAspects = createMemo(() => getAvailableAspects(languageData()));

  const meaningResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, effectiveLanguage()));

  const aspectState = (aspect: KnowledgeAspect): AspectState => {
    if (aspect === 'meaning') {
      return { status: meaningResult().status, inherited: false, untracked: false };
    }
    // Canonical resolution (chain inheritance, orthogonal untracked) — never a local copy.
    const resolved = getAspectStatus(props.word, aspect, effectiveLanguage());
    return { status: resolved.status, inherited: resolved.inherited, untracked: resolved.untracked === true };
  };

  // Interim applicability rule: orthogonal aspects with no record stay hidden
  // (rows and history tabs alike) until evidence exists.
  const visibleAspects = createMemo(() => availableAspects().filter((aspect) => !aspectState(aspect).untracked));

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
        <For each={visibleAspects()}>
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
                <Show when={aspect !== 'meaning' && !state.untracked}>
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
        availableAspects={visibleAspects()}
        onAspectChange={setGraphAspect}
        mode="compact"
        now={Date.now()}
      />
    </div>
  );
};
