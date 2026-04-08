import { Component, createEffect, createMemo, createSignal } from 'solid-js';
import { useLanguage, useFlashcards, useLocalization, useSettings } from '../../../context';
import { getWordStatus, setWordStatus } from '../../../services/statsService';
import { findAnkiWordMatchInCache } from '../../../services/ankiWordsCache';
import { useAnki } from '../../../hooks/useAnki';
import { getWordFormCandidates } from '../../../utils/wordForms';
import {
  getAnkiEaseForStatus,
  getAnkiWordKnowledgeStatus,
  resolveWordKnowledge,
  numericToWordStatus,
  wordStatusToNumeric,
  WORD_STATUS_VALUES,
  type WordStatus,
} from '../../subtitle/wordHoverHelpers';
import { PillBtn } from '../Button';
import { Tooltip } from '../Tooltip';
import { AnkiModifyWarningModal } from '../../flashcard/AnkiModifyWarningModal';
import { showToast } from '../Feedback/Toast';
import { buildWordStatusSourceLabel, getWordStatusChangeAction } from './wordStatusPillLogic';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

const getNextStatus = (status: WordStatus): WordStatus => {
  const index = WORD_STATUS_VALUES.indexOf(status);
  return WORD_STATUS_VALUES[(index + 1) % WORD_STATUS_VALUES.length];
};

export interface WordStatusPillProps {
  word: string;
  onStatusChange?: (status: WordStatus) => void;
  onModalOpenChange?: (isOpen: boolean) => void;
}

export const WordStatusPill: Component<WordStatusPillProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { getCanonicalForm } = useLanguage();
  const { getCardByWordSync, trackWordStatusChange } = useFlashcards();
  const { t } = useLocalization();
  const anki = useAnki();

  const [showStatusSourceWarning, setShowStatusSourceWarning] = createSignal(false);
  const [showAnkiModifyWarning, setShowAnkiModifyWarning] = createSignal(false);
  const [pendingStatus, setPendingStatus] = createSignal<WordStatus | null>(null);
  const [pendingSkipAnki, setPendingSkipAnki] = createSignal(false);

  const wordForms = createMemo(() => getWordFormCandidates(props.word, getCanonicalForm));
  const primaryWord = createMemo(() => wordForms()[0] ?? props.word);
  const aliasWords = createMemo(() => wordForms().slice(1));
  const currentFlashcard = createMemo(() => getCardByWordSync(props.word));
  const manualStatus = createMemo(() =>
    numericToWordStatus(getWordStatus(primaryWord(), aliasWords()))
  );
  const matchedAnki = createMemo(() =>
    settings.use_anki ? findAnkiWordMatchInCache(wordForms()) : null
  );
  const matchedAnkiWord = createMemo(() => matchedAnki()?.word ?? null);
  const ankiKnowledgeStatus = createMemo(() =>
    getAnkiWordKnowledgeStatus(
      matchedAnki()?.cards,
      settings.ankiLearningThreshold,
      settings.ankiKnownThreshold,
    )
  );
  const wordKnowledge = createMemo(() =>
    resolveWordKnowledge(
      currentFlashcard(), manualStatus(), ankiKnowledgeStatus(),
      settings.knowledgeSourceOrder, settings.knowledgeResolutionMode,
    )
  );
  const effectiveStatus = createMemo(() => wordKnowledge().status);
  const statusSourceLabel = createMemo(() => {
    const sources = wordKnowledge().activeSources.map((source) =>
      t(`mlearn.Settings.KnowledgePriority.Source.${source[0].toUpperCase() + source.slice(1)}`)
    );

    return buildWordStatusSourceLabel({
      prefix: t('mlearn.WordHover.StatusSource.Prefix'),
      noneLabel: t('mlearn.WordHover.StatusSource.None'),
      sourceLabels: sources,
      displayedWord: props.word,
      canonicalWord: primaryWord(),
    });
  });

  createEffect(() => {
    props.word;
    setShowStatusSourceWarning(false);
    setShowAnkiModifyWarning(false);
    setPendingStatus(null);
    setPendingSkipAnki(false);
  });

  createEffect(() => {
    props.onModalOpenChange?.(showStatusSourceWarning() || showAnkiModifyWarning());
  });

  const applyStatusChange = (nextStatus: WordStatus, skipAnki = false) => {
    const word = primaryWord();
    if (!word) return;

    setWordStatus(word, wordStatusToNumeric(nextStatus), aliasWords());
    trackWordStatusChange(word);

    const ankiWord = matchedAnkiWord();
    if (!skipAnki && ankiWord && settings.use_anki && nextStatus !== 'unknown') {
      const ankiEase = getAnkiEaseForStatus(nextStatus, settings.ankiLearningEase, settings.ankiKnownEase);
      anki.updateWordCards(ankiWord, ankiEase).then((result) => {
        if (result.updated > 0) {
          const message = result.repositioned > 0
            ? t('mlearn.WordHover.AnkiUpdateRepositioned', { count: String(result.updated), repositioned: String(result.repositioned) })
            : t('mlearn.WordHover.AnkiUpdateSuccess', { count: String(result.updated) });
          showToast({ message, variant: 'success' });
        }
      }).catch(() => {
        showToast({ message: t('mlearn.WordHover.AnkiUpdateFailed'), variant: 'error' });
      });
    }

    props.onStatusChange?.(nextStatus);
  };

  const openStatusChangeFlow = (nextStatus: WordStatus) => {
    setPendingStatus(nextStatus);

    const action = getWordStatusChangeAction({
      isInAnki: !!matchedAnkiWord() && settings.use_anki,
      hasNonManualSource: wordKnowledge().dataSources.some((source) => source !== 'manual'),
      skipAnkiModifyWarning: settings.skipAnkiModifyWarning,
      skipStatusSourceWarning: settings.skipStatusSourceWarning,
    });

    if (action === 'show-anki-warning') {
      setShowAnkiModifyWarning(true);
      return;
    }

    if (action === 'show-status-source-warning') {
      setShowStatusSourceWarning(true);
      return;
    }

    applyStatusChange(nextStatus);
    setPendingStatus(null);
  };

  const handleStatusChange = (event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    openStatusChangeFlow(getNextStatus(manualStatus()));
  };

  const confirmStatusSourceChange = (dontRemind: boolean) => {
    const nextStatus = pendingStatus();
    const skipAnki = pendingSkipAnki();

    setShowStatusSourceWarning(false);
    setPendingSkipAnki(false);
    setPendingStatus(null);

    if (dontRemind) {
      updateSettings({ skipStatusSourceWarning: true });
    }

    if (nextStatus) {
      applyStatusChange(nextStatus, skipAnki);
    }
  };

  const confirmAnkiModify = (dontRemind: boolean) => {
    const nextStatus = pendingStatus();

    setShowAnkiModifyWarning(false);

    if (dontRemind) {
      updateSettings({ skipAnkiModifyWarning: true });
    }

    if (wordKnowledge().dataSources.some((source) => source !== 'manual') && !settings.skipStatusSourceWarning) {
      setShowStatusSourceWarning(true);
      return;
    }

    setPendingStatus(null);
    if (nextStatus) {
      applyStatusChange(nextStatus);
    }
  };

  const confirmAnkiModifyBuiltInOnly = (dontRemind: boolean) => {
    const nextStatus = pendingStatus();

    setShowAnkiModifyWarning(false);

    if (dontRemind) {
      updateSettings({ skipAnkiModifyWarning: true });
    }

    if (wordKnowledge().dataSources.some((source) => source !== 'manual') && !settings.skipStatusSourceWarning) {
      setPendingSkipAnki(true);
      setShowStatusSourceWarning(true);
      return;
    }

    setPendingStatus(null);
    if (nextStatus) {
      applyStatusChange(nextStatus, true);
    }
  };

  const statusVariant = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });

  const statusIcon = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? ICON_CROSS2 : ICON_CHECK;
  });

  const statusLabel = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown'
      ? t('mlearn.WordHover.Status.Unknown')
      : status === 'learning'
        ? t('mlearn.WordHover.Status.Learning')
        : t('mlearn.WordHover.Status.Known');
  });

  return (
    <>
      <Tooltip content={<span class="tooltip-text">{statusSourceLabel()}</span>}>
        <PillBtn
          variant={statusVariant()}
          icon={statusIcon()}
          label={statusLabel()}
          onClick={handleStatusChange}
        />
      </Tooltip>
      <AnkiModifyWarningModal
        isOpen={showStatusSourceWarning()}
        title={t('mlearn.WordHover.StatusSourceWarning.Title')}
        message={t('mlearn.WordHover.StatusSourceWarning.Message')}
        confirmText={t('mlearn.WordHover.StatusSourceWarning.Confirm')}
        dontRemindLabel={t('mlearn.WordHover.StatusSourceWarning.DontRemind')}
        onConfirm={confirmStatusSourceChange}
        onCancel={() => {
          setShowStatusSourceWarning(false);
          setPendingStatus(null);
          setPendingSkipAnki(false);
        }}
      />
      <AnkiModifyWarningModal
        isOpen={showAnkiModifyWarning()}
        title={t('mlearn.WordHover.AnkiModifyWarning.Title')}
        message={t('mlearn.WordHover.AnkiModifyWarning.Message')}
        confirmText={t('mlearn.WordHover.AnkiModifyWarning.Confirm')}
        onConfirm={confirmAnkiModify}
        onConfirmBuiltInOnly={confirmAnkiModifyBuiltInOnly}
        onCancel={() => {
          setShowAnkiModifyWarning(false);
          setPendingStatus(null);
          setPendingSkipAnki(false);
        }}
      />
    </>
  );
};
