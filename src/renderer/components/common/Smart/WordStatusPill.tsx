import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { Component, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { useLanguage, useFlashcards, useLocalization, useSettings } from '../../../context';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import { getWordFormCandidates } from '../../../utils/wordForms';
import {
  type WordStatus,
} from '../../subtitle/wordHoverHelpers';
import { Button } from '../Button';
import { Tooltip } from '../Tooltip';
import { AnkiModifyWarningModal } from '../../flashcard/AnkiModifyWarningModal';
import { buildWordStatusSourceLabel, getWordStatusChangeAction } from './wordStatusPillLogic';
import { isUnmeasuredKnowledge, knowledgeStatusLabelKey } from '../WordStatusPillKnowledge/knowledgeSummary';
import { WordStatusPillKnowledge } from '../WordStatusPillKnowledge';
import { WORD_STATUS_VALUES } from '../../../../shared/constants';
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
  /** Keep dictionary hovers compact; detailed knowledge opens in the Inspector. */
  suppressKnowledgePopover?: boolean;
  /** Compact dictionary interaction: cycle explicit claims, without recording attempts. */
  cycleClaims?: boolean;
  /** Browsing a learning record must not silently change a knowledge claim. */
  onInspect?: () => void;
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
  const { setWordClaim, getComprehensiveWordStatusWithSourceSync } = useFlashcards();
  const { t } = useLocalization();

  const [showStatusSourceWarning, setShowStatusSourceWarning] = createSignal(false);
  const [pendingStatus, setPendingStatus] = createSignal<WordStatus | null>(null);
  // The knowledge tooltip is interactive (Portal-mounted) — while open it counts
  // as an internal modal so hover-popover parents don't close mid-interaction.
  const [knowledgeTooltipOpen, setKnowledgeTooltipOpen] = createSignal(false);
  const [knowledgePinned, setKnowledgePinned] = createSignal(false);
  const [restoreFocusAfterTooltipClose, setRestoreFocusAfterTooltipClose] = createSignal(false);

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
  const primaryWord = createMemo(() => wordForms()[0] ?? props.word);
  const projection = useKnowledgeProjection(() => ({ language: targetLanguage(), surface: props.word }));
  // The pill reads the SAME resolver every other surface uses. Deriving the
  // result from the projection instead fabricated `source`, which made the
  // passive-evidence exemption in hasIntentionalBasis unreachable.
  const comprehensiveResult = createMemo<ComprehensiveWordStatusResult>(() =>
    getComprehensiveWordStatusWithSourceSync(primaryWord(), targetLanguage()));
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
    setPendingStatus(null);
    setKnowledgePinned(false);
  });

  createEffect(() => {
    props.onModalOpenChange?.(showStatusSourceWarning() || knowledgeTooltipOpen());
  });

  const applyStatusChange = (nextStatus: WordStatus) => {
    const word = primaryWord();
    if (!word) return;

    setWordClaim(word, nextStatus, targetLanguage());

    props.onStatusChange?.(nextStatus);
  };

  const openStatusChangeFlow = (nextStatus: WordStatus) => {
    setPendingStatus(nextStatus);

    const hasIntentionalSource = hasIntentionalBasis(comprehensiveResult());

    const action = getWordStatusChangeAction({
      hasNonManualSource: hasIntentionalSource,
      skipStatusSourceWarning: settings.skipStatusSourceWarning,
    });

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
    if (props.onInspect) { props.onInspect(); return; }
    if (props.cycleClaims) {
      const next = WORD_STATUS_VALUES[(WORD_STATUS_VALUES.indexOf(effectiveStatus()) + 1) % WORD_STATUS_VALUES.length];
      openStatusChangeFlow(next);
      return;
    }
    if (effectiveStatus() === 'known') return;
    openStatusChangeFlow('known');
  };

  const confirmStatusSourceChange = (dontRemind: boolean) => {
    const nextStatus = pendingStatus();

    setShowStatusSourceWarning(false);
    setPendingStatus(null);

    if (dontRemind) {
      updateSettings({ skipStatusSourceWarning: true });
    }

    if (nextStatus) {
      applyStatusChange(nextStatus);
    }
  };

  const statusVariant = createMemo(() => {
    // Untracked is the honest "no claim, no evidence" state — muted, never
    // danger red; red is reserved for an actual negative epistemic state.
    if (isUnmeasuredKnowledge(effectiveStatus(), comprehensiveResult().basis)) return 'gray';
    const status = effectiveStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });

  const statusIcon = createMemo(() => {
    if (isUnmeasuredKnowledge(effectiveStatus(), comprehensiveResult().basis)) return undefined;
    return effectiveStatus() === 'unknown' ? ICON_CROSS2 : ICON_CHECK;
  });

  const statusLabel = createMemo(() => (
    t(knowledgeStatusLabelKey(effectiveStatus(), comprehensiveResult().basis))
  ));
  const pill = () => <Button buttonType="pill"
    variant={statusVariant()}
    icon={statusIcon()}
    label={props.iconOnly ? '' : statusLabel()}
    title={props.onInspect ? t('mlearn.Knowledge.Popup.Inspect') : projection.loading() ? t('mlearn.Knowledge.Updating') : undefined}
    aria-busy={projection.loading()}
    onClick={handleStatusChange}
  />;

  return (
    <>
      {/* Unresolved ≠ Untracked: before the learner projection hydrates the
          pill shows a neutral loading placeholder — claiming Known or reading
          a status from a half-loaded store would present false semantics. */}
      <Show when={!projection.projection() || projection.projection()?.status === 'ready'} fallback={
        <Show when={projection.projection()?.status === 'error'} fallback={<span title={t('mlearn.Knowledge.UnavailableHint')}>{t('mlearn.Knowledge.Unavailable')}</span>}>
        <Button size="xs" variant="ghost" title={t('mlearn.Knowledge.LoadError')} onClick={event => { event.stopPropagation(); projection.retry(); }}>{t('mlearn.Knowledge.Retry')}</Button>
        </Show>
      }>
      <KnowledgeGate variant="pill" ready={projection.projection()?.status === 'ready'}>
        <Show when={!props.suppressKnowledgePopover} fallback={pill()}>
          <Tooltip
            interactive
            pinned={knowledgePinned() || undefined}
            restoreFocusOnHide={restoreFocusAfterTooltipClose()}
            onRequestClose={(reason) => {
              setRestoreFocusAfterTooltipClose(reason === 'escape');
              setKnowledgePinned(false);
            }}
            onShow={() => setKnowledgeTooltipOpen(true)}
            onHide={() => {
              setKnowledgeTooltipOpen(false);
              setRestoreFocusAfterTooltipClose(false);
            }}
            content={
              <WordStatusPillKnowledge
                word={props.word}
                language={targetLanguage()}
                pinned={knowledgePinned()}
                onClose={(reason) => {
                  setRestoreFocusAfterTooltipClose(reason === 'close');
                  setKnowledgePinned(false);
                }}
                onPin={() => setKnowledgePinned(true)}
                statusSourceLabel={statusSourceLabel()}
                projectionState={projection}
              />
            }
          >{pill()}</Tooltip>
        </Show>
      </KnowledgeGate>
      </Show>
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
        }}
      />
    </>
  );
};
