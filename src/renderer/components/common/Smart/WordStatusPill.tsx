import { Component, createEffect, createMemo, createSignal } from 'solid-js';
import { useLanguage, useFlashcards, useLocalization, useSettings } from '../../../context';
import { findAnkiWordMatchInCache, refreshAnkiWordsCache } from '../../../services/ankiWordsCache';
import { ANKI_EASE, type WordKnowledgeSource } from '../../../../shared/constants';
import { useAnki } from '../../../hooks/useAnki';
import { getWordFormCandidates } from '../../../utils/wordForms';
import {
  getAnkiEaseForStatus,
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

const PASSIVE_SOURCES: ReadonlySet<WordKnowledgeSource> = new Set(['PassiveTracking', 'None']);

export interface WordStatusPillProps {
  word: string;
  onStatusChange?: (status: WordStatus) => void;
  onModalOpenChange?: (isOpen: boolean) => void;
  iconOnly?: boolean;
}

export const WordStatusPill: Component<WordStatusPillProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { getCanonicalForm } = useLanguage();
  const { trackWordStatusChange, getComprehensiveWordStatusWithSourceSync, setComprehensiveWordStatus } = useFlashcards();
  const { t } = useLocalization();
  const anki = useAnki();

  const [showStatusSourceWarning, setShowStatusSourceWarning] = createSignal(false);
  const [showAnkiModifyWarning, setShowAnkiModifyWarning] = createSignal(false);
  const [pendingStatus, setPendingStatus] = createSignal<WordStatus | null>(null);
  const [pendingSkipAnki, setPendingSkipAnki] = createSignal(false);

  const wordForms = createMemo(() => getWordFormCandidates(props.word, getCanonicalForm));
  const primaryWord = createMemo(() => wordForms()[0] ?? props.word);
  const matchedAnki = createMemo(() =>
    settings.use_anki ? findAnkiWordMatchInCache(wordForms()) : null
  );
  const matchedAnkiWord = createMemo(() => matchedAnki()?.word ?? null);
  const comprehensiveResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word));
  const effectiveStatus = createMemo(() => comprehensiveResult().status);

  const statusSourceLabel = createMemo(() => {
    const source = comprehensiveResult().source;
    const sourceLabels = source === 'None'
      ? []
      : [t(`mlearn.Settings.KnowledgePriority.Source.${source}`)];

    const timesSeen = comprehensiveResult().timesSeen;
    if (source === 'PassiveTracking' && timesSeen > 0) {
      sourceLabels.push(t('mlearn.WordHover.TimesSeen', { count: String(timesSeen) }));
    }

    return buildWordStatusSourceLabel({
      prefix: t('mlearn.WordHover.StatusSource.Prefix'),
      noneLabel: t('mlearn.WordHover.StatusSource.None'),
      sourceLabels,
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

    setComprehensiveWordStatus(word, nextStatus);
    trackWordStatusChange(word);

    const ankiWord = matchedAnkiWord();
    if (!skipAnki && ankiWord && settings.use_anki && nextStatus !== 'unknown') {
      const ankiEase = getAnkiEaseForStatus(nextStatus, ANKI_EASE.DEFAULT_LEARNING, ANKI_EASE.DEFAULT_KNOWN);
      anki.updateWordCards(ankiWord, ankiEase).then((result) => {
        if (result.updated > 0) {
          void refreshAnkiWordsCache();
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

    const source = comprehensiveResult().source;
    const hasIntentionalSource = !PASSIVE_SOURCES.has(source);

    const action = getWordStatusChangeAction({
      isInAnki: !!matchedAnkiWord() && settings.use_anki,
      hasNonManualSource: hasIntentionalSource,
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
    openStatusChangeFlow(getNextStatus(effectiveStatus()));
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

    const source = comprehensiveResult().source;
    const hasIntentionalSource = !PASSIVE_SOURCES.has(source);

    if (hasIntentionalSource && !settings.skipStatusSourceWarning) {
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

    const source = comprehensiveResult().source;
    const hasIntentionalSource = !PASSIVE_SOURCES.has(source);

    if (hasIntentionalSource && !settings.skipStatusSourceWarning) {
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
      <Tooltip content={statusSourceLabel()}>
        <PillBtn
          variant={statusVariant()}
          icon={statusIcon()}
          label={props.iconOnly ? '' : statusLabel()}
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
