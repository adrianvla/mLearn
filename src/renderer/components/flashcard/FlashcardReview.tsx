/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo, onMount, onCleanup, createEffect, batch, on } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { getBridge } from '../../../shared/bridges';
import type { LearningDecision } from '../../../shared/learningDecision';
import type { PolicyDecision } from '../../learning/types';
import { policyContextFromSettings } from '../../learning/policyContext';
import { useDecisionPin } from '../../hooks/useDecisionPin';
import { FlashcardEditModal } from './FlashcardEditModal';
import { TtsGenerateModal } from './TtsGenerateModal';
import {
  Button, Badge, Panel, ProgressBar, MicrophoneIcon, EditIcon, ToggleSwitch, StealthIcon, VolumeOffIcon,
  EyeIcon, Popover, WriteStatusBanner, useConfirmDialog
} from '../common';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { colorizeTokenizedText } from '../../utils/languageTokenization';
import { showToast } from '../common/Feedback/Toast';
import type { CapabilityKey, Flashcard, FlashcardContent } from '../../../shared/types';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { getProvidedAccessesForCue, getTestedAccesses } from '../../../shared/languageFeatures';
import { qualityToSrsRating, worstAttemptQuality } from '../../../shared/constants';
import { nextAttemptId, providedAccessScaffolds, type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import { RatingMatrix, type ProfileObservation, type RateOptions } from '../common';
import type { AttemptQuality } from '../../../shared/constants';
import { OtherLanguageDueHint } from './OtherLanguageDueHint';
import { getSessionProgress } from './flashcardReviewSession';
import { studySessionState, type StudySessionWriteStatus } from '../../learning/studySession';
import { resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';
import { isBlockedByPendingWrite, isNativeActivationTarget, isRatingKeyIgnored, isRevealKey, isUndoShortcut } from '../../utils/ratingShortcuts';
import { canRetryRetraction, isRetractionWriteBlocking, type RetractionWriteState } from '../../learning/undoHistory';
import './FlashcardReview.css';
import { requiresDestructiveConfirmation, buildDestructiveConfirmOptions } from '../../windows/flashcards/bulkDestructiveConfirm';
import { getLogger } from '../../../shared/utils/logger';
import { flashcardReviewPolicyEntry, selectFlashcardReviewDecision } from './flashcardReviewDecision';
import { createReviewAssistanceStore, type ReviewAssistance } from '../../learning/reviewAssistance';

const log = getLogger("renderer.components.flashcardReview");

type ReviewEncounter = { card: Flashcard; decision: PolicyDecision | null; provenance: LearningDecision };

interface ReviewRatingWrite {
  encounter: ReviewEncounter;
  /** The durable rating write's state; the encounter is idle when null. */
  phase: StudySessionWriteStatus;
  attemptId: AttemptId;
  card: Flashcard;
  language: string;
  observations: readonly ProfileObservation[];
  quality: AttemptQuality;
  easy: boolean;
  timing: AttemptTiming | null;
  origin: string;
  scaffolds?: AttemptScaffolds;
  assistance?: { scope: string; record: ReviewAssistance };
}

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
  const {
    store,
    queueCounts,
    getCurrentCard,
    isWordIgnoredSync,
    buryCard,
    removeFlashcard,
    undoLastAction,
    canUndo,
    refreshQueue,
    generateExampleSentenceWithLLM,
    updateFlashcardContent,
    updateFlashcard,
    submitRating,
    ratingPersistenceState,
    retryRatingPersistence,
    queue,
  } = useFlashcards();

  // One pinned decision per encounter (see useDecisionPin): unrelated
  // reactive updates re-run the selection memo, and the pin re-serves the
  // SAME decision instead of re-drawing with a fresh unseeded rng draw.
  // Explicit review actions below call advance() to re-select.
  const decisionPin = useDecisionPin<ReviewEncounter | null>();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [showCardActions, setShowCardActions] = createSignal(false);
  let cardActionsAnchor: HTMLButtonElement | undefined;
  const assistanceStore = createReviewAssistanceStore(localStorage,
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null);
  const [referenceAssistance, setReferenceAssistance] = createSignal<ReviewAssistance | null>(null);
  const [restoredAssistanceScope, setRestoredAssistanceScope] = createSignal<string | null>(null);
  const [assistanceWrite, setAssistanceWrite] = createSignal<StudySessionWriteStatus | null>(null);
  let retryReference: (() => void) | undefined;
  let referenceEncounter = 0;
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [ratingWrite, setRatingWrite] = createSignal<ReviewRatingWrite | null>(null);
  const [removalWrite, setRemovalWrite] = createSignal<{
    encounter: ReviewEncounter; card: Flashcard; language: string; sessionLanguage: string; phase: StudySessionWriteStatus | null;
  } | null>(null);
  // Undo is a durable write (it appends a retraction), reported through the
  // same owner Word Sync uses so the two surfaces cannot disagree about it.
  const [retractionWrite, setRetractionWrite] = createSignal<RetractionWriteState>(null);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);
  let reviewScrollContainer: HTMLDivElement | undefined;
  let reviewActionsContainer: HTMLDivElement | undefined;
  const resetReviewScroll = () => {
    if (reviewScrollContainer) reviewScrollContainer.scrollTop = 0;
    if (reviewActionsContainer) reviewActionsContainer.scrollTop = 0;
  };

  // Active-engagement timing per card: blur/hidden pauses are excluded from
  // the recorded latency; the shared timer is the single implementation all
  // encounter surfaces use (review, Word Sync, welcome review).
  let encounterTimer: EncounterTimer | null = null;

  const stopTiming = (): AttemptTiming | null => {
    const timing = encounterTimer?.stop() ?? null;
    encounterTimer?.dispose();
    encounterTimer = null;
    return timing;
  };

  onCleanup(() => stopTiming());

  // Timing belongs to the encounter, including a genuine same-card requeue.
  // Held writes keep their stopped timer until the acknowledged next owner.
  createEffect(on(
    () => choiceReady() ? currentEncounter() : null,
    (encounter) => {
      if (ratingWrite()) return;
      stopTiming();
      if (encounter) {
        encounterTimer = createEncounterTimer();
        encounterTimer.start();
      }
    }
  ));

  // TTS integration
  const { settings, updateSetting } = useSettings();
  const { langData, currentLangData } = useLanguage();
  const { playTts, isGenerating: ttsGenerating, stop: stopTts, metadata: ttsMetadata, playingField: ttsPlayingField } = useFlashcardTts();
  // A confirmed command belongs to this study scope. A late old-scope
  // acknowledgment must not hide or advance the successor encounter.
  createEffect(on(() => settings.language, () => {
    if (removalWrite()) { setRemovalWrite(null); setShowAnswer(false); }
  }, { defer: true }));
  const languageForCard = (card: Flashcard): string => card.language || settings.language;
  const assistanceScope = (card: Flashcard) => JSON.stringify([languageForCard(card), card.id]);
  const languageDataForCard = (card: Flashcard) => {
    const language = languageForCard(card);
    return langData[language] ?? (language === settings.language ? currentLangData() : null);
  };

  const handlePlayTts = (cardId: string, text: string, field: 'word' | 'example', silentIfMissing = false) => {
    const card = currentCard();
    if (!card || card.id !== cardId || ratingWrite() !== null || removalWrite() !== null
      || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() !== null) return;
    const scope = assistanceScope(card);
    const encounter = referenceEncounter;
    const language = languageForCard(card);
    const sameEncounter = () => !disposed && referenceEncounter === encounter
      && !!currentCard() && assistanceScope(currentCard()!) === scope && ratingWrite() === null
      && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite());
    // Resource lookup may finish after reveal. Only audio admitted while the
    // question is still shown supplies a retrieval cue. Once admitted, its
    // durable record survives cancellation or a restart conservatively.
    let cueAdmitted = false;
    const play = () => {
      if (!sameEncounter()) return;
      void playTts(cardId, text, language, field, {
        silentIfMissing,
        beforePlay: async () => {
          if (!sameEncounter()) return false;
          if (showAnswer() && !cueAdmitted) return true;
          cueAdmitted = true;
          setAssistanceWrite('pending');
          try {
            const capabilities = getTestedAccesses({ languageData: languageDataForCard(card), surface: card.content.front,
              hasReadingData: cardHasReadingData(card), hasProsodyData: cardHasProsodyData(card), taskType: 'srs-review' });
            const supplied = getProvidedAccessesForCue(languageDataForCard(card), capabilities, `${field}-audio`);
            const record = await assistanceStore.provide(scope, { audio: true, ...providedAccessScaffolds(supplied) }, sameEncounter);
            if (!record || !sameEncounter()) return false;
            setReferenceAssistance(record);
            setAssistanceWrite(null);
            retryReference = undefined;
            return true;
          } catch (error) {
            if (sameEncounter()) {
              log.warn('Failed to save review audio assistance:', error);
              setAssistanceWrite('failed');
              retryReference = play;
            }
            return false;
          }
        },
      });
    };
    play();
  };

  // Current card
  const currentEncounter = createMemo(() => {
    const removal = removalWrite();
    if (removal) return removal.encounter;
    const held = ratingWrite();
    if (held) return held.encounter;
    const fallback = getCurrentCard();
    if (!fallback || isWordIgnoredSync(fallback.content.front, languageForCard(fallback))) return null;
    const language = languageForCard(fallback);
    // The policy arbitrates within the scheduler's OWN visible workload for
    // today (the queue — respecting daily caps and same-day scheduling), not
    // just its first card (R07/R08): goal/deadline weighting and intensity
    // momentum can only change allocation when there is more than one
    // candidate. Queued-new cards carry their state so the source scores them
    // as exploration (novelty), never as fabricated overdue repair.
    const nowMs = Date.now();
    const reviewQueueEntries = [...queue().newQueue, ...queue().scheduledQueue]
      .map((id) => store.flashcards[id])
      .filter((card): card is Flashcard => !!card && !card.suspended && !card.buried
        && (card.language || settings.language) === language
        && !isWordIgnoredSync(card.content.front, language))
      .map(card => flashcardReviewPolicyEntry(card, languageForCard(card), languageDataForCard(card)));
    if (!reviewQueueEntries.some(entry => entry.id === fallback.id)) {
      reviewQueueEntries.push(flashcardReviewPolicyEntry(fallback, language, languageDataForCard(fallback)));
    }
    // Pinned for the active encounter (R20 repair): this memo re-runs on
    // every unrelated queue/store/settings update, and the unseeded weighted
    // draw would silently replace the displayed card. The pin re-serves the
    // same decision until an explicit review action advances the epoch.
    const availableIds = new Set(reviewQueueEntries.map((entry) => entry.id));
    const restored = store.meta?.reviewPresentations?.[language];
    return decisionPin.pin(JSON.stringify([language, restored?.id ?? null]), () => {
      if (restored && availableIds.has(restored.cardId)) {
        // Undo names the actual restored card. No fresh graph decision or
        // random draw may silently replace that acknowledged return position.
        const card = store.flashcards[restored.cardId];
        const entry = flashcardReviewPolicyEntry(card, language, languageDataForCard(card));
        return { card: JSON.parse(JSON.stringify(card)) as Flashcard, decision: null,
          provenance: { id: crypto.randomUUID(), at: nowMs, policyVersion: 'restored-review-position-v1',
            selected: { key: card.id, action: 'RESTORE', task: entry.task!,
              presentation: { cardId: card.id, language, surface: card.content.front },
              targets: entry.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })) },
            baseline: null, detail: { scope: 'acknowledged-undo-position',
              reason: 'Return to the saved Undo position without making a fresh recommendation.' } } };
      }
      const selected = selectFlashcardReviewDecision({
        id: crypto.randomUUID(), at: nowMs,
        // The goal applies only to the queue's own learning language (R07).
        context: policyContextFromSettings(settings, language),
        entries: reviewQueueEntries,
      });
      if (!selected) return null;
      const card = store.flashcards[selected.decision.candidate.key] ?? fallback;
      return { card: JSON.parse(JSON.stringify(card)) as Flashcard, ...selected };
    }, (encounter) => {
      if (!encounter || !availableIds.has(encounter.card.id)) return false;
      const actual = store.flashcards[encounter.card.id] ?? fallback;
      const task = reviewQueueEntries.find(entry => entry.id === encounter.card.id)?.task;
      return actual.content.front === encounter.card.content.front
        && languageForCard(actual) === languageForCard(encounter.card)
        && JSON.stringify(task) === JSON.stringify(encounter.provenance.selected.task);
    });
  });

  const [choiceWrite, setChoiceWrite] = createSignal<{ id: string; phase: StudySessionWriteStatus | null } | null>(null);
  const choiceReady = () => !!currentEncounter() && choiceWrite()?.id === currentEncounter()!.provenance.id && choiceWrite()?.phase === null;
  const saveChoice = async (encounter: ReviewEncounter): Promise<void> => {
    const id = encounter.provenance.id;
    setChoiceWrite({ id, phase: 'pending' });
    try {
      await getBridge().knowledgeEvents.recordLearningDecision(encounter.provenance);
      if (!disposed && currentEncounter()?.provenance.id === id) setChoiceWrite({ id, phase: null });
    } catch (error) {
      if (!disposed && currentEncounter()?.provenance.id === id) {
        log.warn('Failed to save the review choice before presentation:', error);
        setChoiceWrite({ id, phase: 'failed' });
      }
    }
  };
  createEffect(on(() => currentEncounter()?.provenance.id, () => {
    const encounter = currentEncounter();
    if (encounter) void saveChoice(encounter);
    else setChoiceWrite(null);
  }));

  const currentDecision = () => currentEncounter()?.decision ?? null;
  const currentCard = createMemo(() => {
    const removal = removalWrite();
    if (removal) return removal.card;
    const held = ratingWrite();
    if (held) return held.card;
    const encounter = currentEncounter();
    if (!choiceReady()) return null;
    return encounter ? store.flashcards[encounter.card.id] ?? encounter.card : null;
  });

  const currentCardId = createMemo(() => currentCard()?.id);

  const restoredAssistance = createMemo(() => {
    const card = currentCard();
    if (!card) return undefined;
    const restored = store.meta?.reviewPresentations?.[languageForCard(card)];
    return restored?.cardId === card.id ? restored.scaffolds : undefined;
  });
  const encounterAssistance = createMemo(() => ({ ...restoredAssistance(), ...referenceAssistance()?.scaffolds, ...ratingWrite()?.scaffolds }));

  const cardHasReadingData = (card: Flashcard): boolean => {
    const r = card.content.reading;
    return !!r && r !== card.content.front;
  };

  const cardHasProsodyData = (card: Flashcard): boolean => {
    const p = card.content.prosody;
    return !!p && (p.position !== undefined || !!p.display);
  };

  const knowledge = useKnowledgeProjection(() => {
    const card = currentCard();
    return card ? { language: languageForCard(card), surface: card.content.front } : undefined;
  });

  // Matrix rows: capabilities THIS card interaction tests (shared tested/supplied gate).
  // The knowledge projection narrows what this surface may record; it does not
  // decide what the card tests. That makes it an asynchronous refinement, so a
  // pending or unmeasured projection must not collapse the rows to nothing: an
  // empty row set renders a revealed card with no way to rate it.
  const testedAccesses = createMemo<readonly CapabilityKey[]>(() => {
    const card = currentCard();
    if (!card) return ['sense-recognition'] as const;
    const tested = getTestedAccesses({
      languageData: languageDataForCard(card),
      surface: card.content.front,
      hasReadingData: cardHasReadingData(card),
      hasProsodyData: cardHasProsodyData(card),
      taskType: 'srs-review',
    });
    if (knowledge.loading()) return tested;
    const projection = knowledge.projection();
    if (projection?.status !== 'ready') return [];
    return projection.surfaceKnown === false ? tested : tested.filter((capability) => knowledge.capabilities().includes(capability));
  });
  const capabilityQueryFailed = () => {
    const status = knowledge.projection()?.status;
    return status === 'error' || status === 'not-installed' || status === 'unavailable';
  };

  // Event handlers read this prop too. Own the computation in the component,
  // rather than creating a JSX expression memo when a handler reads its getter.

  // Explicit whole-word / matrix submissions rate every tested capability —
  // revealed cues change the evidence condition, not the rating surface.
  // Scaffold provenance still travels on each observation (see below).
  const commitRating = async (write: ReviewRatingWrite) => {
    setRatingWrite({ ...write, phase: 'pending' });
    // TEMP DIAGNOSTIC: see FlashcardContext's rating tracer. Enable with
    // `window.__mlearnTrace = true` in the DevTools console.
    const traceOn = (() => {
      try {
        return (window as unknown as { __mlearnTrace?: boolean }).__mlearnTrace === true
          || localStorage.getItem('mlearn.ratingTrace') === '1';
      } catch { return false; }
    })();
    const t0 = performance.now();
    try {
      const result = await submitRating(write.card.content.front, write.observations, {
        language: write.language,
        attemptId: write.attemptId,
        decision: write.encounter.provenance,
        ...(write.timing ? { timing: write.timing } : {}),
        taskType: 'srs-review',
        origin: write.origin,
        // Keep this physical response visible until journal and scheduler saves acknowledge.
        persistence: 'immediate',
        ...(write.scaffolds ? { scaffolds: write.scaffolds } : {}),
        scheduler: {
          cardId: write.card.id,
          rating: qualityToSrsRating(write.quality, write.easy),
          timeSpentMs: write.timing?.wallLatencyMs ?? 0,
          tested: write.observations.map((observation) => observation.capability),
        },
      });
      const afterAwait = performance.now();
      if (write.assistance) {
        try { await assistanceStore.acknowledge(write.assistance.scope, write.assistance.record); }
        catch (error) {
          // The rating is committed. Retaining assistance is conservative;
          // retrying the rating would misrepresent the failure that occurred.
          log.warn('Failed to clear acknowledged review assistance:', error);
          showToast({ message: t('mlearn.WordSync.AssistanceSaveFailed'), variant: 'error' });
        }
      }
      batch(() => {
        setShowAnswer(false);
        // Publish one next encounter after ACK; readiness must not trigger
        // auto-play for an intermediate selection before the pin advances.
        decisionPin.advance();
        setRatingWrite(null);
        // A different scope's effect owns its admission refresh. Same-card
        // requeues need an explicit new encounter even though the scope is stable.
        const next = currentCard();
        if (next && assistanceScope(next) === assistanceScope(write.card)) {
          referenceEncounter += 1;
          refreshReferenceAssistance();
        }
        if (result.completed) setCardsAnswered((previous) => previous + 1);
      });
      if (traceOn) {
        // eslint-disable-next-line no-console
        console.log(`%c[REVIEW] await submitRating=${(afterAwait - t0).toFixed(1)}ms  localApply=${(performance.now() - afterAwait).toFixed(1)}ms`,
          'color:#f80; font-weight:bold');
      }
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to save flashcard review rating:', error);
      setRatingWrite({ ...write, phase: 'failed' });
    }
  };

  const handleBulkRate = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    const encounter = currentEncounter();
    const card = currentCard();
    if (!encounter || !card || !ratingArmed() || observations.length === 0) return;
    let assistance: ReviewAssistance | null;
    try { assistance = assistanceStore.read(assistanceScope(card)); }
    catch (error) {
      log.warn('Failed to read review assistance:', error);
      setAssistanceWrite('failed');
      retryReference = () => refreshReferenceAssistance();
      return;
    }
    const scaffolds = { ...restoredAssistance(), ...assistance?.scaffolds };
    const timing = stopTiming();
    // A mixed profile schedules on its weakest evidence — the same reduction
    // word sync applies, read from the one ordering (missed dominates
    // struggled dominates fluent).
    const quality = worstAttemptQuality(observations.map((observation) => observation.quality));

    stopTts();
    const admittedCard = JSON.parse(JSON.stringify(card)) as Flashcard;
    admittedCard.language ??= languageForCard(card);
    void commitRating({
      phase: 'pending',
      attemptId: nextAttemptId(),
      card: admittedCard,
      encounter: { ...encounter, card: admittedCard },
      language: languageForCard(card),
      observations,
      quality,
      easy: opts?.easy === true,
      timing,
      origin: knowledge.projection()?.surfaceKnown === false ? 'flashcard-review:unmapped' : 'flashcard-review',
      ...(Object.keys(scaffolds).length ? { scaffolds } : {}),
      ...(assistance ? { assistance: { scope: assistanceScope(card), record: assistance } } : {}),
    });
  };

  // Counts
  const counts = createMemo(() => queueCounts());
  // An unresolved final encounter is still work until its ACK, even if the
  // provider has already published an empty queue.
  const remainingWork = createMemo(() => Math.max(counts().total, ratingWrite() || removalWrite() ? 1 : 0));

  // Single owner for "what phase is the encounter in", shared with the other
  // study surfaces. The review queue is studyable work plus this session's
 // already-answered cards, so completion is expressed against that total.
  const presentation = createMemo(() => studySessionState({
    ready: true,
    index: cardsAnswered(),
    total: cardsAnswered() + remainingWork(),
    revealed: showAnswer(),
    write: ratingWrite()?.phase ?? null,
  }));

  /** A rating may only be committed from a revealed, idle encounter. */
  const canRate = createMemo(() =>
    presentation().canRate && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite()));
  const ratingArmed = createMemo(() => canRate() && !!currentCard()
    && knowledge.projection()?.status === 'ready' && ratingPersistenceState() !== 'failed' && assistanceWrite() === null);

  function refreshReferenceAssistance(): void {
    const card = currentCard();
    try {
      const scope = card ? assistanceScope(card) : null;
      const record = scope ? assistanceStore.read(scope) : null;
      batch(() => {
        setReferenceAssistance(record);
        setAssistanceWrite(null);
        setRestoredAssistanceScope(scope);
      });
      retryReference = undefined;
    } catch (error) {
      log.warn('Failed to restore review assistance:', error);
      setAssistanceWrite('failed');
      retryReference = refreshReferenceAssistance;
    }
  }

  function withReferenceContent(open: () => void, media = false): void {
    const card = currentCard();
    if (!card || ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() === 'pending') return;
    if (showAnswer()) { open(); return; }
    const encounter = referenceEncounter;
    const scope = assistanceScope(card);
    const sameEncounter = () => !disposed && referenceEncounter === encounter
      && !!currentCard() && assistanceScope(currentCard()!) === scope && ratingWrite() === null;
    const save = () => {
      if (!sameEncounter()) return;
      setAssistanceWrite('pending');
      void Promise.resolve().then(() => {
        const capabilities = getTestedAccesses({ languageData: languageDataForCard(card), surface: card.content.front,
          hasReadingData: cardHasReadingData(card), hasProsodyData: cardHasProsodyData(card), taskType: 'srs-review' });
        // Front clips can expose sound, subtitles and translation. Treat the
        // whole clip as reference content; do not guess which answer it hides.
        return assistanceStore.provide(scope, { ...providedAccessScaffolds(capabilities), ...(media ? { media: true } : {}) }, sameEncounter);
      }).then(record => {
        if (!record || !sameEncounter()) return;
        setReferenceAssistance(record);
        setAssistanceWrite(null);
        retryReference = undefined;
        open();
      }).catch(error => {
        if (!sameEncounter()) return;
        log.warn('Failed to save review reference exposure:', error);
        setAssistanceWrite('failed');
        retryReference = save;
      });
    };
    save();
  }

  createEffect(on(() => currentCard() ? assistanceScope(currentCard()!) : null, () => {
    referenceEncounter += 1;
    refreshReferenceAssistance();
  }));

  const sessionTotal = createMemo(() => cardsAnswered() + remainingWork());
  // Calculate session progress percentage
  const sessionProgress = createMemo(() => {
    return getSessionProgress(cardsAnswered(), remainingWork());
  });

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRatingKeyIgnored(e)) return;

      // Native controls own Space/Enter. The study surface owns those keys
      // only while focus remains on non-interactive prompt content.
      if (isRevealKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (presentation().phase === 'question' && currentCard()) handleFlip();
        return;
      }

      // Undo rewrites the journal a pending write is appending to, so it waits
      // for the write to land. Other shortcuts are unaffected by that write.
      if (isUndoShortcut(e)) {
        if (isBlockedByPendingWrite('undo', ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()))) { e.preventDefault(); return; }
        if (canUndo()) { e.preventDefault(); void handleUndo(); }
        return;
      }

      if (isNativeActivationTarget(e)) return;

      if (presentation().phase === 'complete') return;

      if (!currentCard()) return;

      if (!showAnswer()) {
        if (e.key === 'b') {
          e.preventDefault();
          handleBury();
        } else if (e.key === 'x') {
          e.preventDefault();
          handleRemove();
        }
      } else if (e.key === 'b') {
        e.preventDefault();
        handleBury();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  // The session is over when the queue has drained: the contract already
  // reports that as `complete`, so completion is not tracked twice.
  createEffect(() => {
    if (presentation().phase === 'complete') props.onComplete?.();
  });

  // A new displayed card starts face-down (R20 repair): the reveal belongs
  // to one encounter, so an action that moves the displayed card must not
  // leak a revealed answer onto the next one. `on` fires only when the id
  // actually changes, so a pinned same-id re-run never flips the reveal.
  createEffect(on(
    () => currentCardId(),
    () => {
      setShowAnswer(false);
      resetReviewScroll();
    }
  ));

  // One automatic cue per pinned encounter. A provider may publish the next
  // card before its previous rating ACK returns; wait for admission to reopen.
  let automaticAudioEncounter: ReturnType<typeof currentEncounter> = null;
  createEffect(() => {
    const encounter = currentEncounter();
    const ready = choiceReady() && ratingWrite() === null && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite()) && assistanceWrite() === null;
    if (!encounter || !ready || restoredAssistanceScope() !== assistanceScope(encounter.card) || showAnswer() || !settings.flashcardAutoTts || settings.flashcardMuteAudio
      || automaticAudioEncounter === encounter) return;
    automaticAudioEncounter = encounter;
    handlePlayTts(encounter.card.id, encounter.card.content.front, 'word', true);
  });

  // Auto-TTS: play example when answer is revealed (waits for word TTS to finish)
  // Skip example TTS for cards with video — the video provides the audio
  createEffect(on(
    () => showAnswer(),
    (isShown) => {
      if (!isShown || !settings.flashcardAutoTts || settings.flashcardMuteAudio) return;
      const card = currentCard();
      if (!card?.content.example || card.content.example === '-') return;
      if (card.content.videoUrl || card.content.skipExampleTts) return;
      // Play example immediately — playTts stops any previous audio first
      playTts(card.id, card.content.example!, languageForCard(card), 'example', { silentIfMissing: true });
    }
  ));

  const handleUndo = async () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())) return;
    setRetractionWrite('pending');
    try {
      const actionType = await undoLastAction();
      if (actionType === 'answer') {
        setCardsAnswered(prev => Math.max(0, prev - 1));
      }
      setRetractionWrite(null);
      setShowAnswer(false);
      // The undo restored prior pool state: re-select afresh (R20 pin repair).
      decisionPin.advance();
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to persist flashcard Undo:', error);
      setRetractionWrite('failed');
    }
  };

  const handleBury = () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())) return;
    const card = currentCard();
    if (!card) return;
    stopTiming();
    batch(() => {
      setShowAnswer(false);
      buryCard(card.id);
    });
    // The bury changed the pool: re-select afresh (R20 pin repair).
    decisionPin.advance();
    resetReviewScroll();
  };

  const removalStillMatches = (write: NonNullable<ReturnType<typeof removalWrite>>) => {
    const stored = store.flashcards[write.card.id];
    return settings.language === write.sessionLanguage && !!stored && JSON.stringify(stored) === JSON.stringify(write.card)
      && (stored.language || settings.language) === write.language;
  };

  const commitRemoval = async (write: NonNullable<ReturnType<typeof removalWrite>>) => {
    const pending = { ...write, phase: 'pending' as const };
    setRemovalWrite(pending);
    let removed = false;
    try {
      removed = removalStillMatches(pending) && await removeFlashcard(pending.card.id, true);
    } catch (error) {
      log.warn('Failed to persist flashcard removal:', error);
    }
    if (disposed || removalWrite() !== pending || settings.language !== pending.sessionLanguage) return;
    if (!removed) {
      setRemovalWrite({ ...pending, phase: 'failed' });
      return;
    }
    stopTiming();
    batch(() => {
      setShowAnswer(false);
      decisionPin.advance();
      setRemovalWrite(null);
    });
    resetReviewScroll();
  };

  const handleRemove = async () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() !== null) return;
    const encounter = currentEncounter();
    const card = currentCard();
    if (!encounter || !card) return;
    // Hold the confirmed encounter across the dialog and durable command.
    const write = { encounter, card: JSON.parse(JSON.stringify(card)) as Flashcard,
      language: languageForCard(card), sessionLanguage: settings.language, phase: null };
    setRemovalWrite(write);
    if (requiresDestructiveConfirmation(1)) {
      const confirmed = await showConfirm(buildDestructiveConfirmOptions({
        count: 1,
        titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
        messageKey: 'mlearn.Flashcards.Modals.DeleteCard.Confirm',
      }, t));
      if (disposed || removalWrite() !== write || settings.language !== write.sessionLanguage) return;
      if (!confirmed) { setRemovalWrite(null); return; }
    }
    await commitRemoval(write);
  };

  const handleFlip = () => {
    if (removalWrite()) return;
    setShowAnswer(true);
    resetReviewScroll();
  };

  const handleRegenerateExample = async (cardId: string) => {
    const card = currentCard();
    if (!card || card.id !== cardId || regeneratingExample() || removalWrite()) return;
    const encounter = currentEncounter();
    const sessionLanguage = settings.language;
    const stillOwned = () => !disposed && !removalWrite() && currentEncounter() === encounter
      && currentCard()?.id === cardId && settings.language === sessionLanguage;

    setRegeneratingExample(true);
    try {
      const language = languageForCard(card);
      const languageData = languageDataForCard(card);
      const result = await generateExampleSentenceWithLLM(card.content.front, card.content.back, language);
      if (result.sentence && stillOwned()) {
        const exampleHtml = await colorizeTokenizedText({
          text: result.sentence,
          language,
          languageData,
          settings,
          colourCodes: resolveFlashcardColourCodes(languageData, settings.colour_codes),
          targetWord: card.content.front,
        });
        if (!stillOwned()) return;
        updateFlashcardContent(cardId, {
          example: exampleHtml,
          exampleMeaning: result.meaning || undefined,
        });
        showToast({ message: t('mlearn.CardEditor.RegenerateExample'), variant: 'success' });
      }
    } catch (e) {
      log.warn('Failed to regenerate example:', e);
    } finally {
      setRegeneratingExample(false);
    }
  };

  const handleEditCardSave = (content: FlashcardContent, metadataUpdates?: Partial<Flashcard>) => {
    const card = editingCard();
    if (!card) return;
    if (metadataUpdates && Object.keys(metadataUpdates).length > 0) {
      updateFlashcard(card.id, { content: { ...card.content, ...content }, ...metadataUpdates });
    } else {
      updateFlashcardContent(card.id, content);
    }
    setShowEditModal(false);
    setEditingCard(null);
  };

  const handleEditCardClose = () => {
    setShowEditModal(false);
    setEditingCard(null);
  };

  const handleOpenEditModal = () => {
    const card = currentCard();
    if (!card) return;

    batch(() => {
      setEditingCard(card);
      setShowEditModal(true);
    });
  };

  const handleStartOver = () => {
    refreshQueue();
    decisionPin.advance();
    setShowAnswer(false);
    setCardsAnswered(0);
    resetReviewScroll();
  };

  // Rating buttons config with time estimates
  
  // Get state label variant
  const getStateLabelVariant = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return 'primary' as const;
      case 'learning': return 'warning' as const;
      case 'relearning': return 'error' as const;
      case 'review': return 'success' as const;
      default: return 'default' as const;
    }
  };

  // Get state label text
  const getStateLabelText = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return t('mlearn.Flashcards.Review.NewCard');
      case 'learning': return t('mlearn.Flashcards.Review.LearningCard');
      case 'relearning': return t('mlearn.Flashcards.Review.RelearningCard');
      case 'review': return t('mlearn.Flashcards.Review.ReviewCard');
      default: return '';
    }
  };

  return (
      <div class="flashcard-review-container" style={props.style}>
        {/* Session progress bar */}
        <Show when={sessionTotal() > 0}>
          <div class="flashcard-session-progress">
            <ProgressBar
              value={sessionProgress()}
              size="md"
              variant="default"
              class="flashcard-progress-bar"
              rounded={false}
            />
          </div>
        </Show>

        {/* Header with stats */}
        <div class="flashcard-review-header">
          <div class="flashcard-status">
            <Badge class="flashcard-stat flashcard-stat--new">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.New')}</span>
              <span class="flashcard-stat-value">{counts().new}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--learning" variant="warning">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.LearningLabel')}</span>
              <span class="flashcard-stat-value">{counts().learning}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--review" variant="success">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.Review')}</span>
              <span class="flashcard-stat-value">{counts().review}</span>
            </Badge>
          </div>

          <div class="flashcard-header-actions">
            <Show when={ratingPersistenceState() === 'failed'}>
              <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                <span>{t('mlearn.Flashcards.Review.PendingRatingsSaveFailed')}</span>
                <Button size="sm" variant="primary" onClick={() => {
                  void retryRatingPersistence().catch(error => log.warn('Rating persistence retry failed:', error));
                }}>
                  {t('mlearn.Global.TryAgain')}
                </Button>
              </div>
            </Show>
            <ToggleSwitch
              checked={settings.flashcardStealthMode}
              onChange={(checked) => updateSetting('flashcardStealthMode', checked)}
              label={t('mlearn.Flashcards.Review.StealthMode')}
              title={t('mlearn.Flashcards.Review.StealthMode')}
              thumbIcon={<StealthIcon size={12} />}
            />
            <ToggleSwitch
              checked={settings.flashcardMuteAudio}
              onChange={(checked) => updateSetting('flashcardMuteAudio', checked)}
              label={t('mlearn.Flashcards.Review.MuteAudio')}
              title={t('mlearn.Flashcards.Review.MuteAudio')}
              thumbIcon={<VolumeOffIcon size={12} />}
            />
            <Show when={canUndo()}>
              <Button buttonType="default" variant="ghost" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { void handleUndo(); }} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
                {t('mlearn.Flashcards.Review.Undo')}
              </Button>
            </Show>
            <WriteStatusBanner
              status={retractionWrite()}
              savingLabelKey="mlearn.Flashcards.Review.SavingUndo"
              failedLabelKey="mlearn.Flashcards.Review.UndoSaveFailed"
              canRetry={canRetryRetraction(retractionWrite())}
              onRetry={() => { void handleUndo(); }}
              class="flashcard-rating-write"
              failedClass="flashcard-rating-write--failed"
            />
            <Show when={presentation().phase !== 'complete' && currentCard()}>
              <Button
                ref={(element) => { cardActionsAnchor = element; }}
                variant="ghost"
                size="xs"
                class="flashcard-actions-trigger"
                disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())}
                aria-haspopup="dialog"
                aria-expanded={showCardActions()}
                onClick={() => setShowCardActions((open) => !open)}
              >
                {t('mlearn.Flashcards.Review.CardActions')}
              </Button>
              <Popover
                open={showCardActions}
                anchor={() => cardActionsAnchor}
                onClose={() => setShowCardActions(false)}
                label={t('mlearn.Flashcards.Review.CardActions')}
                class="flashcard-actions-popover"
              >
                <div class="flashcard-action-buttons">
                  <Button variant="ghost" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { setShowCardActions(false); handleBury(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}>
                    {t('mlearn.Flashcards.Review.Bury')}
                  </Button>
                  <Button variant="danger" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { setShowCardActions(false); handleRemove(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'x' })}>
                    {t('mlearn.Flashcards.Review.Remove')}
                  </Button>
                  <Button variant="ghost" size="xs" icon={<EyeIcon size={14} />} onClick={() => {
                  setShowCardActions(false);
                  const card = currentCard();
                  if (!card) return;
                  const language = languageForCard(card);
                  const surface = card.content.front;
                  // R20: the SAME pinned decision that selected this card rides
                  // into the existing Inspector drawer — the learner audits the
                  // selection (brief reason + emitted trace) where the
                  // knowledge lives. No recomputation anywhere.
                  const decision = currentDecision();
                  withReferenceContent(() => openKnowledgeInspector(surfaceKnowledgeInspection(
                      language,
                      surface,
                      decision?.trace !== undefined ? { policyTrace: decision.trace, policyBrief: decision.encounter.why } : undefined,
                  )));
                  }}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>
                  <Button variant="ghost" size="xs" onClick={() => { setShowCardActions(false); withReferenceContent(handleOpenEditModal); }} title={t('mlearn.Flashcards.Modals.EditCard.EditButton')} icon={<EditIcon size={14} />}>
                    {t('mlearn.Flashcards.Modals.EditCard.EditButton')}
                  </Button>
                  <Show when={isElectron()}>
                    <Button variant="ghost" size="xs" onClick={() => { setShowCardActions(false); setShowTtsModal(true); }} title={t('mlearn.CardEditor.Regenerate.Title')} icon={<MicrophoneIcon size={14} />}>
                      {t('mlearn.CardEditor.Regenerate.Title')}
                    </Button>
                  </Show>
                </div>
              </Popover>
            </Show>
          </div>
        </div>

        <div class="flashcard-review-content" ref={reviewScrollContainer}>
        {/* Card or completion screen */}
        <Show
            when={presentation().phase !== 'complete' && currentCard()}
            fallback={
              <Show when={presentation().phase === 'complete'} fallback={
                <WriteStatusBanner status={choiceWrite()?.phase ?? 'pending'}
                  savingLabelKey="mlearn.Flashcards.Review.PreparingQuestion"
                  failedLabelKey="mlearn.Flashcards.Review.QuestionSaveFailed"
                  canRetry={choiceWrite()?.phase === 'failed'}
                  onRetry={() => { const encounter = currentEncounter(); if (encounter) void saveChoice(encounter); }}
                  class="flashcard-rating-write" failedClass="flashcard-rating-write--failed" />
              }>
              <Panel
                  variant="default"
                  rounded="xl"
                  class="flashcard-completion"
              >
                <h2 class="flashcard-completion-title">
                  {t('mlearn.Flashcards.Review.Complete')}
                </h2>
                <p class="flashcard-completion-text">
                  {t('mlearn.Flashcards.Review.CompleteDescription')}
                </p>
                <OtherLanguageDueHint />
                <div class="flashcard-completion-actions">
                  <Show when={Object.keys(store.flashcards).length > 0}>
                    <Button buttonType="default" variant="primary" onClick={handleStartOver}>
                      {t('mlearn.Flashcards.Review.ReviewMore')}
                    </Button>
                  </Show>
                  <Show when={props.onClose}>
                    <Button buttonType="default" onClick={props.onClose}>
                      {t('mlearn.Global.Close')}
                    </Button>
                  </Show>
                </div>
              </Panel>
              </Show>
            }
        >
          {/* Card state indicator */}
          <Show when={currentCard()}>
            <div class="flashcard-state-indicator">
              <Badge variant={getStateLabelVariant(currentCard()!)}>
                <span class="flashcard-stat-label">
                  {getStateLabelText(currentCard()!)}
                </span>
              </Badge>
            </div>
          </Show>
          {/* Show card - non-keyed to avoid remount delay between cards */}
          <Show when={currentCard()}>
            {(card) => (
              <FlashcardDisplay
                  flashcard={card()}
                  showAnswer={showAnswer()}
                  onFlip={handleFlip}
                  onPlayTts={handlePlayTts}
                  ttsPlayingField={ttsPlayingField()}
                  ttsGenerating={ttsGenerating()}
                  promptMediaOwner={currentEncounter()}
                  onOpenPromptMedia={(cardId, open) => {
                    if (currentCard()?.id === cardId) withReferenceContent(open, true);
                  }}
                  ttsMetadata={ttsMetadata()}
                  onRegenerateExample={removalWrite() ? undefined : handleRegenerateExample}
                  regeneratingExample={regeneratingExample()}
              />
            )}
          </Show>
        </Show>

        </div>

        {/* Buttons container */}
        <div class="flashcard-buttons-container" ref={reviewActionsContainer}>
          <WriteStatusBanner status={removalWrite()?.phase ?? null}
            savingLabelKey="mlearn.Flashcards.Review.SavingRemoval" failedLabelKey="mlearn.Flashcards.Review.RemovalSaveFailed"
            canRetry={removalWrite()?.phase === 'failed' && removalStillMatches(removalWrite()!)}
            retryTestId="review-removal-retry"
            onRetry={() => { const failed = removalWrite(); if (failed?.phase === 'failed') void commitRemoval(failed); }} />
          <Show when={removalWrite()?.phase === 'failed'}>
            <Button size="sm" onClick={() => { setShowAnswer(false); setRemovalWrite(null); }}>
              {t('mlearn.Global.Cancel')}
            </Button>
          </Show>
          <WriteStatusBanner status={assistanceWrite()}
            savingLabelKey="mlearn.WordSync.SavingAssistance" failedLabelKey="mlearn.WordSync.AssistanceSaveFailed"
            canRetry={assistanceWrite() === 'failed'} onRetry={() => retryReference?.()} />
          <Show when={Object.keys(encounterAssistance()).length > 0}>
            <p class="flashcard-rating-write" role="status">{t((encounterAssistance().audio || encounterAssistance().media) ? 'mlearn.Flashcards.Review.AssistanceRecorded' : 'mlearn.WordSync.ReferenceConsulted')}</p>
          </Show>
          {/* Show answer button */}
          <Show when={presentation().phase !== 'complete' && currentCard() && !showAnswer()}>
            <Button buttonType="default" variant="primary" size="lg" class="flashcard-show-answer-btn" onClick={handleFlip}>
              {t('mlearn.Flashcards.Review.ShowAnswer')}
            </Button>
          </Show>

          {/* Rating buttons */}
          <Show when={presentation().phase !== 'complete' && currentCard() && showAnswer()}>
            <div class="flashcard-rating-buttons">
              <RatingMatrix
                capabilities={testedAccesses()}
                capabilityLabels={Object.fromEntries(testedAccesses().map((capability) => {
                  const label = (currentCard() ? languageDataForCard(currentCard()!) : undefined)?.learning?.capabilities?.[capability]?.label;
                  return [capability, label];
                }).filter((entry): entry is [string, string] => entry[1] !== undefined))}
                keyboardMode={settings.ratingKeyboardMode}
                armed={ratingArmed()}
                resetKey={currentEncounter() ?? undefined}
                onSubmit={handleBulkRate}
              />
              <WriteStatusBanner
                status={presentation().write}
                savingLabelKey="mlearn.Flashcards.Review.SavingRating"
                failedLabelKey="mlearn.Flashcards.Review.SaveFailed"
                canRetry={ratingWrite()?.phase === 'failed'}
                onRetry={() => { const failed = ratingWrite(); if (failed) void commitRating(failed); }}
                class="flashcard-rating-write"
                failedClass="flashcard-rating-write--failed"
              />
              <Show when={knowledge.loading()}>
                <div class="flashcard-rating-write" role="status" aria-live="polite">
                  {t('mlearn.Knowledge.Loading')}
                </div>
              </Show>
              <Show when={capabilityQueryFailed()}>
                <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                  <span>{t(knowledge.projection()?.status === 'error' ? 'mlearn.Knowledge.LoadError' : 'mlearn.Knowledge.UnavailableHint')}</span>
                  <Button size="sm" variant="primary" onClick={() => knowledge.retry()}>
                    {t('mlearn.Global.TryAgain')}
                  </Button>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {/* TTS Regenerate Modal */}
        <Show when={currentCard()}>
          <TtsGenerateModal
            isOpen={showTtsModal()}
            onClose={() => setShowTtsModal(false)}
            cardId={currentCard()!.id}
            language={languageForCard(currentCard()!)}
            languageData={languageDataForCard(currentCard()!)}
            wordText={currentCard()!.content.front}
            exampleText={currentCard()!.content.example}
          />
        </Show>

        {/* Edit Card Modal */}
        <FlashcardEditModal
          isOpen={showEditModal()}
          flashcard={editingCard()}
          onClose={handleEditCardClose}
          onSave={handleEditCardSave}
        />

        <ConfirmDialogElement />
      </div>
  );
};
