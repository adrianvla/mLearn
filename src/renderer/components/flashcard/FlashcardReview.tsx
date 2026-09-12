/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo, onMount, onCleanup, createEffect, batch, on } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { selectNextEncounter } from '../../learning/engine';
import { FlashcardEditModal } from './FlashcardEditModal';
import { TtsGenerateModal } from './TtsGenerateModal';
import { Button, Badge, Panel, ProgressBar, Select, MicrophoneIcon, EditIcon, ToggleSwitch, StealthIcon, VolumeOffIcon } from '../common';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { colorizeTokenizedText } from '../../utils/languageTokenization';
import { showToast } from '../common/Feedback/Toast';
import type { CapabilityKind, Flashcard, FlashcardContent } from '../../../shared/types';
import { ASPECT_CAPABILITY } from '../../../shared/graph/types';
import { CAPABILITY_LABEL_KEYS } from '../../../shared/graph/access';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { qualityToSrsRating } from '../../../shared/constants';
import { nextAttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import { RatingMatrix, type ProfileObservation, type RateOptions } from '../common';
import type { KnowledgeAspect } from '../../../shared/constants';
import { OtherLanguageDueHint } from './OtherLanguageDueHint';
import { getSessionProgress } from './flashcardReviewSession';
import { resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';
import { isRatingKeyIgnored, isUndoShortcut } from '../../utils/ratingShortcuts';
import './FlashcardReview.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardReview");

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
  /** Session-local review focus mode (never persisted). */
  reviewMode?: KnowledgeAspect;
  onReviewModeChange?: (mode: KnowledgeAspect) => void;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const {
    store,
    queueCounts,
    getCurrentCard,
    answerCard,
    buryCard,
    removeFlashcard,
    undoLastAction,
    canUndo,
    refreshQueue,
    generateExampleSentenceWithLLM,
    updateFlashcardContent,
    updateFlashcard,
    recordAttempt,
  } = useFlashcards();

  const [showAnswer, setShowAnswer] = createSignal(false);
  // Retrieval-time audio scaffold: whether the spoken form was available
  // BEFORE the reveal (auto-play or manual word TTS). Recorded on the
  // attempt's evidence so an audio-cued reading rating stays cued
  // recognition instead of fabricating unassisted recall evidence.
  const [wordAudioPreReveal, setWordAudioPreReveal] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);

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
    if (field === 'word' && !showAnswer()) setWordAudioPreReveal(true);
    playTts(cardId, text, card ? languageForCard(card) : settings.language, field);
  };

  // Current card
  const currentDecision = createMemo(() => {
    const fallback = getCurrentCard();
    if (!fallback) return null;
    const language = languageForCard(fallback);
    return selectNextEncounter({
      preset: 'RETENTION',
      nowMs: Date.now(),
      reviewQueueEntries: [{
        id: fallback.id,
        word: fallback.content.front,
        language,
        targets: [{ entityId: `${language}:surface:${fallback.content.front}`, capability: 'surface-recognition' }],
        dueDate: fallback.dueDate,
        interval: fallback.interval,
        suspended: fallback.suspended,
        buried: fallback.buried,
      }],
    });
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

  // Matrix rows: capabilities THIS card interaction tests (shared tested/supplied gate).
  const testedAccesses = createMemo<readonly CapabilityKind[]>(() => {
    const card = currentCard();
    if (!card) return ['sense-recognition'] as const;
    return getTestedAccesses({
      languageData: languageDataForCard(card),
      surface: card.content.front,
      hasReadingData: cardHasReadingData(card),
      hasProsodyData: cardHasProsodyData(card),
    }).filter(capability => knowledge.capabilities().includes(capability));
  });

  // Review modes available for the current card: language capability
  // (getAvailableAccesses) intersected with per-card data presence.
  const availableAspects = createMemo<KnowledgeAspect[]>(() => {
    const card = currentCard();
    if (!card) return ['meaning'];
    const supported = testedAccesses();
    const aspects: KnowledgeAspect[] = supported.includes('sense-recognition') ? ['meaning'] : [];
    if (supported.includes('surface-reading')) aspects.push('reading');
    if (supported.includes('prosodic-pattern') && cardHasProsodyData(card)) aspects.push('prosody');
    return aspects;
  });

  const effectiveMode = createMemo<KnowledgeAspect>(() => {
    const mode = props.reviewMode ?? 'meaning';
    return availableAspects().includes(mode) ? mode : 'meaning';
  });

  createEffect(() => {
    if (knowledge.loading()) return;
    const mode = props.reviewMode ?? 'meaning';
    if (mode !== 'meaning' && !availableAspects().includes(mode)) {
      props.onReviewModeChange?.('meaning');
    }
  });

  const modeOptions = createMemo(() => (
    availableAspects().map((aspect) => ({
      value: aspect,
      label: t(CAPABILITY_LABEL_KEYS[ASPECT_CAPABILITY[aspect]]),
    }))
  ));

  // Explicit whole-word / matrix submissions rate every tested capability —
  // revealed cues change the evidence condition, not the rating surface.
  // Scaffold provenance still travels on each observation (see below).
  const handleBulkRate = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    const card = currentCard();
    if (!card || !showAnswer() || observations.length === 0) return;
    const timing = stopTiming();
    const attemptId = nextAttemptId();
    // A mixed profile schedules on its weakest evidence, matching the
    // whole-word semantics: missed dominates struggled dominates fluent.
    const quality = observations.some((observation) => observation.quality === 'missed')
      ? 'missed'
      : observations.some((observation) => observation.quality === 'struggled')
        ? 'struggled'
        : 'fluent';

    stopTts();
    batch(() => {
      setShowAnswer(false);
      for (const observation of observations) {
        recordAttempt(card.content.front, observation.capability, observation.quality, {
          language: languageForCard(card),
          method: observation.method,
          attemptId,
          ...(timing ? { timing } : {}),
          taskType: 'srs-review',
          ...(wordAudioPreReveal() ? { scaffolds: { audio: true } satisfies AttemptScaffolds } : {}),
        });
      }
      const completed = answerCard(qualityToSrsRating(quality, opts?.easy), card.id, timing?.wallLatencyMs ?? 0, {
        attemptId,
        tested: observations.map((observation) => observation.capability as CapabilityKind),
        ...(wordAudioPreReveal() ? { scaffolds: { audio: true } satisfies AttemptScaffolds } : {}),
      });
      if (completed) setCardsAnswered((previous) => previous + 1);
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
      const target = e.target;
      const buttonTarget = target instanceof HTMLElement && target.matches('button, [role="button"]');

      // Space/Enter reveal only. Prevent native button activation first, so a
      // focused rating cell cannot turn Space into a concealed rating action.
      if (e.key === ' ' || e.key === 'Enter') {
        if (isRatingKeyIgnored(e) && !buttonTarget) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isComplete() && currentCard() && !showAnswer()) setShowAnswer(true);
        return;
      }

      // Shared press semantics: ignore held-down key repeats and typing in
      // editable/control elements (single source of truth with Word Sync).
      if (isRatingKeyIgnored(e)) return;

      // Check for Ctrl+Z / Cmd+Z for undo
      if (isUndoShortcut(e)) {
        e.preventDefault();
        if (canUndo()) {
          handleUndo();
        }
        return;
      }

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

  // Auto-TTS: play word when a new card appears — the spoken form was
  // available during retrieval, so it is a prompt scaffold.
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      if (!cardId || !settings.flashcardAutoTts || settings.flashcardMuteAudio) return;
      const card = currentCard();
      if (!card) return;
      if (!showAnswer()) setWordAudioPreReveal(true);
      playTts(card.id, card.content.front, languageForCard(card), 'word');
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
      playTts(card.id, card.content.example!, languageForCard(card), 'example');
    }
  ));

  const handleUndo = () => {
    const actionType = undoLastAction();
    if (actionType === 'answer') {
      setCardsAnswered(prev => Math.max(0, prev - 1));
    }
    setShowAnswer(false);
  };

  const handleBury = () => {
    const card = currentCard();
    if (!card) return;
    stopTiming();
    batch(() => {
      setShowAnswer(false);
      buryCard(card.id);
    });
  };

  const handleRemove = async () => {
    const card = currentCard();
    if (!card) return;
    stopTiming();
    setShowAnswer(false);
    await removeFlashcard(card.id, true);
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
            <Show when={availableAspects().length > 1}>
              <label class="flashcard-mode-select" for="flashcard-review-mode">
                <span class="flashcard-mode-select__label">{t('mlearn.Flashcards.Review.Modes.Label')}</span>
                <Select
                  id="flashcard-review-mode"
                  options={modeOptions()}
                  value={effectiveMode()}
                  onChange={(e) => props.onReviewModeChange?.(e.currentTarget.value as KnowledgeAspect)}
                  class="flashcard-mode-select__control"
                />
              </label>
            </Show>
            <ToggleSwitch
              checked={settings.flashcardStealthMode}
              onChange={(checked) => updateSetting('flashcardStealthMode', checked)}
              title={t('mlearn.Flashcards.Review.StealthMode')}
              thumbIcon={<StealthIcon size={12} />}
            />
            <ToggleSwitch
              checked={settings.flashcardMuteAudio}
              onChange={(checked) => updateSetting('flashcardMuteAudio', checked)}
              title={t('mlearn.Flashcards.Review.MuteAudio')}
              thumbIcon={<VolumeOffIcon size={12} />}
            />
            {/* Bury/Remove in header to prevent misclicks */}
            <Show when={!isComplete() && currentCard()}>
              <div class="flashcard-action-buttons">
                <Button
                    buttonType="default"
                    variant="ghost"
                    size="xs"
                    class="flashcard-action-btn flashcard-action-btn--bury"
                    onClick={handleBury}
                    title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}
                >
                  <span class="flashcard-action-label">{t('mlearn.Flashcards.Review.Bury')}</span>
                </Button>
                <Button
                    buttonType="default"
                    variant="danger"
                    size="xs"
                    class="flashcard-action-btn flashcard-action-btn--remove"
                    onClick={handleRemove}
                    title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'x' })}
                >
                  <span class="flashcard-action-label">{t('mlearn.Flashcards.Review.Remove')}</span>
                </Button>
              </div>
            </Show>
            <Show when={canUndo()}
            >
              <Button buttonType="default" variant="ghost" size="xs" onClick={handleUndo} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
                {t('mlearn.Flashcards.Review.Undo')}
              </Button>
            </Show>
            <Show when={!isComplete() && currentCard()}>
              <Button
                buttonType="default"
                variant="ghost"
                size="xs"
                class="flashcard-action-btn"
                onClick={handleOpenEditModal}
                title={t('mlearn.Flashcards.Modals.EditCard.EditButton')}
                icon={<EditIcon size={14} />}
              >
                {/*<span class="flashcard-action-label">{t('mlearn.Flashcards.Modals.EditCard.EditButton')}</span>*/}
              </Button>
            </Show>
            <Show when={isElectron() && !isComplete() && currentCard()}>
              <Button
                buttonType="default"
                variant="ghost"
                size="xs"
                class="flashcard-action-btn"
                onClick={() => setShowTtsModal(true)}
                title={t('mlearn.CardEditor.Regenerate.Title')}
                icon={<MicrophoneIcon size={14} />}
              >
                <span class="flashcard-action-label">{t('mlearn.CardEditor.Regenerate.Title')}</span>
              </Button>
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
                  reviewMode={effectiveMode()}
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
                keyboardMode={settings.ratingKeyboardMode}
                armed={showAnswer() && !!currentCard() && !isComplete()}
                resetKey={currentCard()?.id}
                onSubmit={handleBulkRate}
              />
              <Button buttonType="default" variant="ghost" size="xs" class="flashcard-rating-inspect" onClick={() => {
                const card = currentCard();
                if (!card) return;
                const language = languageForCard(card);
                const surface = card.content.front;
                openKnowledgeInspector({ language, surface, target: { kind: 'surface', id: surfaceEntityId(language, hashWordSync(surface)) } });
              }}>
                {t('mlearn.Knowledge.Popup.Inspect')}
              </Button>
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
