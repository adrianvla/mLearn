import { Component, createEffect, createMemo, createSignal } from 'solid-js';
import { useLanguage, useFlashcards, useLocalization, useSettings } from '../../../context';
import { ankiCacheVersion, findAnkiWordMatchInCache, refreshAnkiWordsCache } from '../../../services/ankiWordsCache';
import { ANKI_EASE } from '../../../../shared/constants';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import { useAnki } from '../../../hooks/useAnki';
import { getWordFormCandidates } from '../../../utils/wordForms';
import {
  getAnkiEaseForStatus,
  type WordStatus,
} from '../../subtitle/wordHoverHelpers';
import { PillBtn } from '../Button';
import { Tooltip } from '../Tooltip';
import { AnkiModifyWarningModal } from '../../flashcard/AnkiModifyWarningModal';
import { showToast } from '../Feedback/Toast';
import { buildWordStatusSourceLabel, getWordStatusChangeAction } from './wordStatusPillLogic';
import { isUntrackedKnowledge, knowledgeStatusLabelKey } from '../WordStatusPillKnowledge/knowledgeSummary';
import { WordStatusPillKnowledge } from '../WordStatusPillKnowledge';
import { KnowledgeGate } from '../KnowledgeGate';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';
// An "intentional" current state — worth a confirm dialog before the user
// overrides it — is an explicit claim or non-passive evidence (SRS, Anki,
// migration import). Pure passive exposure and unmeasured need no warning.
const hasIntentionalBasis = (result: ComprehensiveWordStatusResult): boolean => (
  result.basis === 'claim' || (result.basis === 'evidence' && result.source !== 'PassiveTracking')
);

export interface WordStatusPillProps {
  word: string;
  language?: string;
  onStatusChange?: (status: WordStatus) => void;
  onModalOpenChange?: (isOpen: boolean) => void;
  iconOnly?: boolean;
}

export const WordStatusPill: Component<WordStatusPillProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const {
    langData,
    getCanonicalForm,
    getWordVariants,
    getCanonicalFormForLanguage,
    getWordVariantsForLanguage,
    currentLangData,
  } = useLanguage();
  const { getComprehensiveWordStatusWithSourceSync, setWordClaim } = useFlashcards();
  const { t } = useLocalization();
  const anki = useAnki();

  const [showStatusSourceWarning, setShowStatusSourceWarning] = createSignal(false);
  const [showAnkiModifyWarning, setShowAnkiModifyWarning] = createSignal(false);
  const [pendingStatus, setPendingStatus] = createSignal<WordStatus | null>(null);
  const [pendingSkipAnki, setPendingSkipAnki] = createSignal(false);
  // The knowledge tooltip is interactive (Portal-mounted) — while open it counts
  // as an internal modal so hover-popover parents don't close mid-interaction.
  const [knowledgeTooltipOpen, setKnowledgeTooltipOpen] = createSignal(false);
  const [knowledgePinned, setKnowledgePinned] = createSignal(false);

  const targetLanguage = createMemo(() => props.language ?? settings.language);
  const isActiveLanguage = createMemo(() => targetLanguage() === settings.language);
  const targetLanguageData = createMemo(() => (
    langData[targetLanguage()] ?? (isActiveLanguage() ? currentLangData() : null)
  ));
  const wordForms = createMemo(() => (
    isActiveLanguage()
      ? getWordFormCandidates(props.word, getCanonicalForm, getWordVariants, { languageData: targetLanguageData(), language: targetLanguage() })
      : getWordFormCandidates(
        props.word,
        (value) => getCanonicalFormForLanguage(targetLanguage(), value),
        (value) => getWordVariantsForLanguage(targetLanguage(), value),
        { languageData: targetLanguageData(), language: targetLanguage() },
      )
  ));
  const ankiCacheOptions = createMemo(() => ({
    language: targetLanguage(),
    languageData: targetLanguageData(),
  }));
  const primaryWord = createMemo(() => wordForms()[0] ?? props.word);
  const matchedAnki = createMemo(() => {
    ankiCacheVersion();
    return settings.use_anki ? findAnkiWordMatchInCache(wordForms(), ankiCacheOptions()) : null;
  });
  const matchedAnkiWord = createMemo(() => matchedAnki()?.word ?? null);
  const comprehensiveResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, targetLanguage()));
  const effectiveStatus = createMemo(() => comprehensiveResult().status);

  const statusSourceLabel = createMemo(() => {
    const result = comprehensiveResult();
    const basisLabels: Record<typeof result.basis, string> = {
      claim: t('mlearn.Knowledge.Basis.Claim'),
      evidence: t('mlearn.Knowledge.Basis.Evidence'),
      unmeasured: t('mlearn.Knowledge.Basis.Unmeasured'),
    };
    const sourceLabels = result.basis === 'unmeasured'
      ? []
      : [basisLabels[result.basis]];

    if (result.timesSeen > 0) {
      sourceLabels.push(t('mlearn.WordHover.TimesSeen', { count: String(result.timesSeen) }));
    }

    return buildWordStatusSourceLabel({
      prefix: t('mlearn.Knowledge.EvidenceSource.Prefix'),
      noneLabel: t('mlearn.Knowledge.EvidenceSource.None'),
      sourceLabels,
      displayedWord: props.word,
      canonicalWord: result.matchedWord ?? primaryWord(),
    });
  });

  createEffect(() => {
    props.word;
    setShowStatusSourceWarning(false);
    setShowAnkiModifyWarning(false);
    setPendingStatus(null);
    setPendingSkipAnki(false);
    setKnowledgePinned(false);
  });

  createEffect(() => {
    props.onModalOpenChange?.(showStatusSourceWarning() || showAnkiModifyWarning() || knowledgeTooltipOpen());
  });

  const applyStatusChange = (nextStatus: WordStatus, skipAnki = false) => {
    const word = primaryWord();
    if (!word) return;

    setWordClaim(word, nextStatus, targetLanguage());

    const ankiWord = matchedAnkiWord();
    if (!skipAnki && ankiWord && settings.use_anki && nextStatus !== 'unknown') {
      const ankiEase = getAnkiEaseForStatus(nextStatus, ANKI_EASE.DEFAULT_LEARNING, ANKI_EASE.DEFAULT_KNOWN);
      anki.updateWordCards(ankiWord, ankiEase).then((result) => {
        if (result.updated > 0) {
          void refreshAnkiWordsCache(ankiCacheOptions());
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

    const hasIntentionalSource = hasIntentionalBasis(comprehensiveResult());

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

  // The compact pill is one deliberate gesture: "I know this." Untracked words
  // are claimed Known immediately; an existing contradictory intentional state
  // (claim / active evidence) still gets the override warning. Unknown and
  // Learning stay deliberate edits — they live in the inspector, never on the
  // fast path (Learning and Unknown carry real epistemic weight in Tier 2).
  const handleStatusChange = (event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (effectiveStatus() === 'known') return;
    openStatusChangeFlow('known');
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

    const hasIntentionalSource = hasIntentionalBasis(comprehensiveResult());

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

    const hasIntentionalSource = hasIntentionalBasis(comprehensiveResult());

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
    // Untracked is the honest "no claim, no evidence" state — muted, never
    // danger red; red is reserved for an actual negative epistemic state.
    if (isUntrackedKnowledge(effectiveStatus(), comprehensiveResult().basis)) return 'gray';
    const status = effectiveStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });

  const statusIcon = createMemo(() => {
    if (isUntrackedKnowledge(effectiveStatus(), comprehensiveResult().basis)) return undefined;
    return effectiveStatus() === 'unknown' ? ICON_CROSS2 : ICON_CHECK;
  });

  const statusLabel = createMemo(() => (
    t(knowledgeStatusLabelKey(effectiveStatus(), comprehensiveResult().basis))
  ));

  return (
    <>
      {/* Unresolved ≠ Untracked: before the learner projection hydrates the
          pill shows a neutral loading placeholder — claiming Known or reading
          a status from a half-loaded store would present false semantics. */}
      <KnowledgeGate variant="pill">
        <Tooltip
          interactive
          pinned={knowledgePinned() || undefined}
          onRequestClose={() => setKnowledgePinned(false)}
          onShow={() => setKnowledgeTooltipOpen(true)}
          onHide={() => setKnowledgeTooltipOpen(false)}
          content={
            <WordStatusPillKnowledge
              word={props.word}
              language={targetLanguage()}
              pinned={knowledgePinned()}
              onClose={() => setKnowledgePinned(false)}
              onPin={() => setKnowledgePinned(true)}
              statusSourceLabel={statusSourceLabel()}
            />
          }
        >
          <PillBtn
            variant={statusVariant()}
            icon={statusIcon()}
            label={props.iconOnly ? '' : statusLabel()}
            onClick={handleStatusChange}
          />
        </Tooltip>
      </KnowledgeGate>
      <AnkiModifyWarningModal
        isOpen={showStatusSourceWarning()}
        title={t('mlearn.Knowledge.OverrideWarning.Title')}
        message={t('mlearn.Knowledge.OverrideWarning.Message')}
        confirmText={t('mlearn.Knowledge.OverrideWarning.Confirm')}
        dontRemindLabel={t('mlearn.Knowledge.OverrideWarning.DontRemind')}
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
