/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, For, createSignal, createMemo, onMount, onCleanup, createEffect, batch, on } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { FlashcardEditModal } from './FlashcardEditModal';
import { TtsGenerateModal } from './TtsGenerateModal';
import { Button, Badge, Panel, ProgressBar, MicrophoneIcon, EditIcon, ToggleSwitch, StealthIcon, VolumeOffIcon } from '../common';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { getBackend } from '../../../shared/backends';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { showToast } from '../common/Feedback/Toast';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import type { ButtonVariant } from '../common/Button/Button';
import type { Rating } from '../../services/srsAlgorithm';
import { getSessionProgress } from './flashcardReviewSession';
import './FlashcardReview.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardReview");

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
    getPreviewDueDates,
    answerCard,
    buryCard,
    removeFlashcard,
    undoLastAction,
    canUndo,
    refreshQueue,
    dueDateToString,
    generateExampleSentenceWithLLM,
    updateFlashcardContent,
    updateFlashcard,
  } = useFlashcards();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);

  // TTS integration
  const { settings, updateSetting } = useSettings();
  const { playTts, isGenerating: ttsGenerating, stop: stopTts, metadata: ttsMetadata, playingField: ttsPlayingField } = useFlashcardTts();

  const handlePlayTts = (cardId: string, text: string, field: 'word' | 'example') => {
    playTts(cardId, text, settings.language, field);
  };

  // Current card
  const currentCard = createMemo(() => getCurrentCard());

  // Preview due dates for buttons
  const previewDates = createMemo(() => getPreviewDueDates());

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
      // Ignore held-down key repeats to prevent accidental multi-reviews
      if (e.repeat) return;

      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Check for Ctrl+Z / Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (canUndo()) {
          handleUndo();
        }
        return;
      }

      if (isComplete()) return;

      if (!currentCard()) return;

      // Space to show answer, or rate Good if answer is shown
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!showAnswer()) {
          setShowAnswer(true);
        } else {
          handleRating('good');
        }
        return;
      }

      // Rating keys (only when answer is shown)
      if (showAnswer()) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            handleRating('again');
            break;
          case '2':
            e.preventDefault();
            handleRating('hard');
            break;
          case '3':
            e.preventDefault();
            handleRating('good');
            break;
          case '4':
            e.preventDefault();
            handleRating('easy');
            break;
          case 'b':
            e.preventDefault();
            handleBury();
            break;
          case 'x':
            e.preventDefault();
            handleRemove();
            break;
        }
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

  // Auto-TTS: play word when a new card appears
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      if (!cardId || !settings.flashcardAutoTts || settings.flashcardMuteAudio) return;
      const card = currentCard();
      if (!card) return;
      playTts(card.id, card.content.front, settings.language, 'word');
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
      playTts(card.id, card.content.example!, settings.language, 'example');
    }
  ));

  const handleRating = (quality: Rating) => {
    const card = currentCard();
    if (!card) return;

    stopTts();
    batch(() => {
      setShowAnswer(false);
      const completed = answerCard(quality, card.id);
      if (completed) {
        setCardsAnswered(prev => prev + 1);
      }
    });
  };

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
    batch(() => {
      setShowAnswer(false);
      buryCard(card.id);
    });
  };

  const handleRemove = async () => {
    const card = currentCard();
    if (!card) return;
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
      const result = await generateExampleSentenceWithLLM(card.content.front, card.content.back, settings.language);
      if (result.sentence) {
        let exampleHtml = result.sentence;
        try {
          const backend = getBackend({
            mode: settings.backendMode,
            url: settings.backendUrl,
            authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
          });
          const tokens = await backend.tokenize(result.sentence, settings.language);
          if (tokens.length > 0) {
            const colourCodes = settings.colour_codes || {};
            exampleHtml = tokensToColoredHtml(tokens, colourCodes, card.content.front);
          }
        } catch (e) {
          log.error("error", e);
          // Use plain text if tokenization fails
        }
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
  const ratingButtons = createMemo(() => {
    const dates = previewDates();
    if (!dates) return [];

    return [
      {
        quality: 'again' as Rating,
        label: t('mlearn.Flashcards.Review.Again'),
        variant: 'danger' as ButtonVariant,
        time: dueDateToString(dates.again),
        key: '1'
      },
      {
        quality: 'hard' as Rating,
        label: t('mlearn.Flashcards.Review.Hard'),
        variant: 'warning' as ButtonVariant,
        time: dueDateToString(dates.hard),
        key: '2'
      },
      {
        quality: 'good' as Rating,
        label: t('mlearn.Flashcards.Review.Ok'),
        variant: 'success' as ButtonVariant,
        time: dueDateToString(dates.good),
        key: '3'
      },
      {
        quality: 'easy' as Rating,
        label: t('mlearn.Flashcards.Review.Easy'),
        variant: 'primary' as ButtonVariant,
        time: dueDateToString(dates.easy),
        key: '4'
      },
    ];
  });

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
              <For each={ratingButtons()}>
                {(btn) => (
                    <Button
                        buttonType="default"
                        variant={btn.variant}
                        class="flashcard-rating-btn"
                        onClick={() => handleRating(btn.quality)}
                        title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: btn.key })}
                    >
                      <span class="flashcard-rating-label">{btn.label}</span>
                      <span class="flashcard-rating-time">{btn.time}</span>
                    </Button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* TTS Regenerate Modal */}
        <Show when={currentCard()}>
          <TtsGenerateModal
            isOpen={showTtsModal()}
            onClose={() => setShowTtsModal(false)}
            cardId={currentCard()!.id}
            wordText={currentCard()!.content.front}
            exampleText={currentCard()!.content.example}
            reading={currentCard()!.content.reading}
            cardBack={currentCard()!.content.back}
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
