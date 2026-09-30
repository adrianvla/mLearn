/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo, onMount, onCleanup, createEffect, batch, on } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { selectNextEncounter } from '../../learning/engine';
import { policyContextFromSettings } from '../../learning/policyContext';
import { useDecisionPin } from '../../hooks/useDecisionPin';
import { FlashcardEditModal } from './FlashcardEditModal';
import { TtsGenerateModal } from './TtsGenerateModal';
import {
  Button, Badge, Panel, ProgressBar, MicrophoneIcon, EditIcon, ToggleSwitch, StealthIcon, VolumeOffIcon,
  EyeIcon, Popover
} from '../common';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { colorizeTokenizedText } from '../../utils/languageTokenization';
import { showToast } from '../common/Feedback/Toast';
import type { CapabilityKey, Flashcard, FlashcardContent } from '../../../shared/types';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { qualityToSrsRating } from '../../../shared/constants';
import { nextAttemptId, type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import { RatingMatrix, type ProfileObservation, type RateOptions } from '../common';
import type { AttemptQuality } from '../../../shared/constants';
import { OtherLanguageDueHint } from './OtherLanguageDueHint';
import { getSessionProgress } from './flashcardReviewSession';
import { resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';
import { isNativeActivationTarget, isRatingKeyIgnored, isUndoShortcut } from '../../utils/ratingShortcuts';
import './FlashcardReview.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardReview");

interface ReviewRatingWrite {
  phase: 'pending' | 'failed';
  attemptId: AttemptId;
  card: Flashcard;
  observations: readonly ProfileObservation[];
  quality: AttemptQuality;
  easy: boolean;
  timing: AttemptTiming | null;
  origin: string;
  scaffolds?: AttemptScaffolds;
}

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const {
    store,
    queueCounts,
    getCurrentCard,
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
  const decisionPin = useDecisionPin();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [showCardActions, setShowCardActions] = createSignal(false);
  let cardActionsAnchor: HTMLButtonElement | undefined;
  // Retrieval-time audio scaffold: whether the spoken form was available
  // BEFORE the reveal (auto-play or manual word TTS). Recorded on the
  // attempt's evidence so an audio-cued reading rating stays cued
  // recognition instead of fabricating unassisted recall evidence.
  const [wordAudioPreReveal, setWordAudioPreReveal] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [ratingWrite, setRatingWrite] = createSignal<ReviewRatingWrite | null>(null);
  const [undoWrite, setUndoWrite] = createSignal<'pending' | 'failed' | null>(null);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);
  let reviewScrollContainer: HTMLDivElement | undefined;
  const resetReviewScroll = () => {
    if (reviewScrollContainer) reviewScrollContainer.scrollTop = 0;
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

  // Start timing whenever a new card is shown
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      stopTiming();
      if (cardId) {
        encounterTimer = createEncounterTimer();
        encounterTimer.start();
      }
    }
  ));

  // TTS integration
  const { settings, updateSetting } = useSettings();
  const { langData, currentLangData } = useLanguage();
  const { playTts, isGenerating: ttsGenerating, stop: stopTts, metadata: ttsMetadata, playingField: ttsPlayingField } = useFlashcardTts();
  const languageForCard = (card: Flashcard): string => card.language || settings.language;
  const languageDataForCard = (card: Flashcard) => {
    const language = languageForCard(card);
    return langData[language] ?? (language === settings.language ? currentLangData() : null);
  };

  const handlePlayTts = (cardId: string, text: string, field: 'word' | 'example') => {
    const card = store.flashcards[cardId] ?? currentCard();
    playTts(cardId, text, card ? languageForCard(card) : settings.language, field, {
      onStarted: () => { if (field === 'word' && currentCard()?.id === cardId && !showAnswer()) setWordAudioPreReveal(true); },
    });
  };

  // Current card
  const currentDecision = createMemo(() => {
    const fallback = getCurrentCard();
    if (!fallback) return null;
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
        && (card.language || settings.language) === language)
      .map((card) => ({
        id: card.id,
        word: card.content.front,
        language: languageForCard(card),
        targets: [{ entityId: `${language}:surface:${card.content.front}`, capability: 'surface-recognition' as const }],
        dueDate: card.dueDate,
        interval: card.interval,
        suspended: card.suspended,
        buried: card.buried,
        state: card.state,
        // Queue membership IS the scheduler's same-day admission.
        scheduledForToday: true,
        // Scheduler-replayed journal state feeding the momentum producer (R08).
        lastReviewed: card.lastReviewed,
        ease: card.ease,
        reviews: card.reviews,
      }));
    if (!reviewQueueEntries.some((entry) => entry.id === fallback.id)) {
      reviewQueueEntries.push({
        id: fallback.id,
        word: fallback.content.front,
        language,
        targets: [{ entityId: `${language}:surface:${fallback.content.front}`, capability: 'surface-recognition' }],
        dueDate: fallback.dueDate,
        interval: fallback.interval,
        suspended: fallback.suspended,
        buried: fallback.buried,
        state: fallback.state,
        scheduledForToday: true,
        lastReviewed: fallback.lastReviewed,
        ease: fallback.ease,
        reviews: fallback.reviews,
      });
    }
    // Pinned for the active encounter (R20 repair): this memo re-runs on
    // every unrelated queue/store/settings update, and the unseeded weighted
    // draw would silently replace the displayed card. The pin re-serves the
    // same decision until an explicit review action advances the epoch.
    return decisionPin.pin(fallback.id, () => selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      // The goal applies only to the queue's own learning language (R07).
      context: policyContextFromSettings(settings, language),
      reviewQueueEntries,
    }));
  });

  const currentCard = createMemo(() => {
    const fallback = getCurrentCard();
    if (!fallback) return null;
    const decision = currentDecision();
    return decision?.action === 'DEFER'
      ? fallback
      : store.flashcards[decision?.candidate.key ?? ''] ?? fallback;
  });

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

  // The authored prompt defines the task when its surface is absent from the
  // installed graph. Observations still use the exact surface address; this
  // does not create graph entities or attest relationships to dictionary entries.
  const testedAccesses = createMemo<readonly CapabilityKey[]>(() => {
    const card = currentCard();
    if (!card) return ['sense-recognition'] as const;
    const candidates = getTestedAccesses({
      languageData: languageDataForCard(card),
      surface: card.content.front,
      hasReadingData: cardHasReadingData(card),
      hasProsodyData: cardHasProsodyData(card),
      taskType: 'srs-review',
    });
    const projection = knowledge.projection();
    if (projection?.status !== 'ready') return [];
    return projection.surfaceKnown === false
      ? candidates
      : candidates.filter(capability => knowledge.capabilities().includes(capability));
  });
  const capabilityQueryFailed = () => {
    const status = knowledge.projection()?.status;
    return status === 'error' || status === 'not-installed' || status === 'unavailable';
  };

  // Event handlers read this prop too. Own the computation in the component,
  // rather than creating a JSX expression memo when a handler reads its getter.
  const ratingArmed = createMemo(() => showAnswer() && !!currentCard() && !isComplete()
    && ratingWrite() === null && undoWrite() === null && ratingPersistenceState() !== 'failed');

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
        language: languageForCard(write.card),
        attemptId: write.attemptId,
        ...(write.timing ? { timing: write.timing } : {}),
        taskType: 'srs-review',
        origin: write.origin,
        persistence: 'background',
        ...(write.scaffolds ? { scaffolds: write.scaffolds } : {}),
        scheduler: {
          cardId: write.card.id,
          rating: qualityToSrsRating(write.quality, write.easy),
          timeSpentMs: write.timing?.wallLatencyMs ?? 0,
          tested: write.observations.map((observation) => observation.capability),
        },
      });
      const afterAwait = performance.now();
      batch(() => {
        setShowAnswer(false);
        setRatingWrite(null);
        if (result.completed) setCardsAnswered((previous) => previous + 1);
      });
      if (traceOn) {
        // eslint-disable-next-line no-console
        console.log(`%c[REVIEW] await submitRating=${(afterAwait - t0).toFixed(1)}ms  localApply=${(performance.now() - afterAwait).toFixed(1)}ms`,
          'color:#f80; font-weight:bold');
      }
      setWordAudioPreReveal(false);
      // The answer changed the pool: end the encounter so the next read
      // re-selects instead of replaying the just-rated pick through the pin.
      decisionPin.advance();
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to save flashcard review rating:', error);
      setRatingWrite({ ...write, phase: 'failed' });
    }
  };

  const handleBulkRate = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    const card = currentCard();
    if (!card || !showAnswer() || observations.length === 0 || ratingWrite() !== null) return;
    const timing = stopTiming();
    // A mixed profile schedules on its weakest evidence, matching the
    // whole-word semantics: missed dominates struggled dominates fluent.
    const quality = observations.some((observation) => observation.quality === 'missed')
      ? 'missed'
      : observations.some((observation) => observation.quality === 'struggled')
        ? 'struggled'
        : 'fluent';

    stopTts();
    void commitRating({
      phase: 'pending',
      attemptId: nextAttemptId(),
      card,
      observations,
      quality,
      easy: opts?.easy === true,
      timing,
      origin: knowledge.projection()?.surfaceKnown === false ? 'flashcard-review:unmapped' : 'flashcard-review',
      ...(wordAudioPreReveal() ? { scaffolds: { audio: true } satisfies AttemptScaffolds } : {}),
    });
  };

  // Counts
  const counts = createMemo(() => queueCounts());

  const sessionTotal = createMemo(() => cardsAnswered() + counts().total);
  // Calculate session progress percentage
  const sessionProgress = createMemo(() => {
    return getSessionProgress(cardsAnswered(), counts().total);
  });

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRatingKeyIgnored(e)) return;

      // Native controls own Space/Enter. The study surface owns those keys
      // only while focus remains on non-interactive prompt content.
      if (e.key === ' ' || e.key === 'Enter') {
        if (isNativeActivationTarget(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isComplete() && currentCard() && !showAnswer() && ratingWrite() === null && undoWrite() === null) setShowAnswer(true);
        return;
      }

      // Check for Ctrl+Z / Cmd+Z for undo
      if (isUndoShortcut(e)) {
        if (ratingWrite() !== null || undoWrite() !== null) { e.preventDefault(); return; }
        if (canUndo()) { e.preventDefault(); void handleUndo(); }
        return;
      }

      if (isNativeActivationTarget(e)) return;

      if (isComplete()) return;

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

  // Check if session is complete
  createEffect(() => {
    const card = currentCard();
    const total = counts().total;

    if (!card && total === 0) {
      setIsComplete(true);
      props.onComplete?.();
      return;
    }

    setIsComplete(false);
  });

  // Per-card scaffold reset: the audio scaffold reflects THIS card's prompt.
  createEffect(on(
    () => currentCard()?.id,
    () => {
      setWordAudioPreReveal(false);
    }
  ));

  // A new displayed card starts face-down (R20 repair): the reveal belongs
  // to one encounter, so an action that moves the displayed card must not
  // leak a revealed answer onto the next one. `on` fires only when the id
  // actually changes, so a pinned same-id re-run never flips the reveal.
  createEffect(on(
    () => currentCard()?.id,
    () => {
      setShowAnswer(false);
      resetReviewScroll();
    }
  ));

  // Auto-TTS: play word when a new card appears — the spoken form was
  // available during retrieval, so it is a prompt scaffold.
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      if (!cardId || !settings.flashcardAutoTts || settings.flashcardMuteAudio) return;
      const card = currentCard();
      if (!card) return;
      playTts(card.id, card.content.front, languageForCard(card), 'word', {
        silentIfMissing: true,
        onStarted: () => { if (currentCard()?.id === card.id && !showAnswer()) setWordAudioPreReveal(true); },
      });
    }
  ));

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
    if (ratingWrite() !== null || undoWrite() === 'pending') return;
    setUndoWrite('pending');
    try {
      const actionType = await undoLastAction();
      if (actionType === 'answer') {
        setCardsAnswered(prev => Math.max(0, prev - 1));
      }
      setUndoWrite(null);
      setShowAnswer(false);
      // The undo restored prior pool state: re-select afresh (R20 pin repair).
      decisionPin.advance();
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to persist flashcard Undo:', error);
      setUndoWrite('failed');
    }
  };

  const handleBury = () => {
    if (ratingWrite() !== null || undoWrite() !== null) return;
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

  const handleRemove = async () => {
    if (ratingWrite() !== null || undoWrite() !== null) return;
    const card = currentCard();
    if (!card) return;
    stopTiming();
    setShowAnswer(false);
    await removeFlashcard(card.id, true);
    // The removal changed the pool: re-select afresh (R20 pin repair).
    decisionPin.advance();
    resetReviewScroll();
  };

  const handleFlip = () => {
    setShowAnswer(true);
  };

  const handleRegenerateExample = async (cardId: string) => {
    const card = currentCard();
    if (!card || card.id !== cardId || regeneratingExample()) return;

    setRegeneratingExample(true);
    try {
      const language = languageForCard(card);
      const languageData = languageDataForCard(card);
      const result = await generateExampleSentenceWithLLM(card.content.front, card.content.back, language);
      if (result.sentence) {
        const exampleHtml = await colorizeTokenizedText({
          text: result.sentence,
          language,
          languageData,
          settings,
          colourCodes: resolveFlashcardColourCodes(languageData, settings.colour_codes),
          targetWord: card.content.front,
        });
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
    setShowAnswer(false);
    setIsComplete(false);
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
      <div class="flashcard-review-container" style={props.style} ref={reviewScrollContainer}>
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
              <Button buttonType="default" variant="ghost" size="xs" disabled={ratingWrite() !== null || undoWrite() === 'pending'} onClick={() => { void handleUndo(); }} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
                {t('mlearn.Flashcards.Review.Undo')}
              </Button>
            </Show>
            <Show when={undoWrite() === 'pending'}>
              <div class="flashcard-rating-write" role="status" aria-live="polite">
                {t('mlearn.Flashcards.Review.SavingUndo')}
              </div>
            </Show>
            <Show when={undoWrite() === 'failed'}>
              <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                <span>{t('mlearn.Flashcards.Review.UndoSaveFailed')}</span>
                <Button size="sm" variant="primary" onClick={() => { void handleUndo(); }}>
                  {t('mlearn.Global.TryAgain')}
                </Button>
              </div>
            </Show>
            <Show when={!isComplete() && currentCard()}>
              <Button
                ref={(element) => { cardActionsAnchor = element; }}
                variant="ghost"
                size="xs"
                class="flashcard-actions-trigger"
                disabled={ratingWrite() !== null || undoWrite() !== null}
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
                  <Button variant="ghost" size="xs" disabled={ratingWrite() !== null || undoWrite() !== null} onClick={() => { setShowCardActions(false); handleBury(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}>
                    {t('mlearn.Flashcards.Review.Bury')}
                  </Button>
                  <Button variant="danger" size="xs" disabled={ratingWrite() !== null || undoWrite() !== null} onClick={() => { setShowCardActions(false); handleRemove(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'x' })}>
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
                  openKnowledgeInspector(surfaceKnowledgeInspection(
                      language,
                      surface,
                      decision?.trace !== undefined ? { policyTrace: decision.trace, policyBrief: decision.encounter.why } : undefined,
                  ));
                  }}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>
                  <Button variant="ghost" size="xs" onClick={() => { setShowCardActions(false); handleOpenEditModal(); }} title={t('mlearn.Flashcards.Modals.EditCard.EditButton')} icon={<EditIcon size={14} />}>
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

        {/* Card or completion screen */}
        <Show
            when={!isComplete() && currentCard()}
            fallback={
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
                  ttsMetadata={ttsMetadata()}
                  onRegenerateExample={handleRegenerateExample}
                  regeneratingExample={regeneratingExample()}
              />
            )}
          </Show>
        </Show>

        {/* Buttons container */}
        <div class="flashcard-buttons-container">
          {/* Show answer button */}
          <Show when={!isComplete() && currentCard() && !showAnswer()}>
            <Button buttonType="default" variant="primary" size="lg" class="flashcard-show-answer-btn" onClick={handleFlip}>
              {t('mlearn.Flashcards.Review.ShowAnswer')}
            </Button>
          </Show>

          {/* Rating buttons */}
          <Show when={!isComplete() && currentCard() && showAnswer()}>
            <div class="flashcard-rating-buttons">
              <RatingMatrix
                capabilities={testedAccesses()}
                capabilityLabels={Object.fromEntries(testedAccesses().map((capability) => {
                  const label = (currentCard() ? languageDataForCard(currentCard()!) : undefined)?.learning?.capabilities?.[capability]?.label;
                  return [capability, label];
                }).filter((entry): entry is [string, string] => entry[1] !== undefined))}
                keyboardMode={settings.ratingKeyboardMode}
                armed={ratingArmed()}
                resetKey={currentCard()?.id}
                onSubmit={handleBulkRate}
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
              <Show when={ratingWrite()?.phase === 'pending'}>
                <div class="flashcard-rating-write" role="status" aria-live="polite">
                  {t('mlearn.Flashcards.Review.SavingRating')}
                </div>
              </Show>
              <Show when={ratingWrite()?.phase === 'failed'}>
                <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                  <span>{t('mlearn.Flashcards.Review.SaveFailed')}</span>
                  <Button size="sm" variant="primary" onClick={() => {
                    const failed = ratingWrite();
                    if (failed?.phase === 'failed') void commitRating(failed);
                  }}>
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
      </div>
  );
};
