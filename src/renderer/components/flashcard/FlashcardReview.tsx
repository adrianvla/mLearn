/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, For, createSignal, createMemo, onMount, onCleanup, createEffect, batch, on } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { TtsGenerateModal } from './TtsGenerateModal';
import { Button, Badge, Panel, ProgressBar, MicrophoneIcon } from '../common';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { getBackend } from '../../../shared/backends';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { showToast } from '../common/Feedback/Toast';
import type { Flashcard } from '../../../shared/types';
import type { Rating } from '../../services/srsAlgorithm';
import * as SRS from '../../services/srsAlgorithm';
import './FlashcardReview.css';

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const {
    store,
    queue,
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
    intervalToString,
    generateExampleSentenceWithLLM,
    updateFlashcardContent,
  } = useFlashcards();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [isWaiting, setIsWaiting] = createSignal(false);
  const [waitingTimeStr, setWaitingTimeStr] = createSignal('');
  const [initialTotal, setInitialTotal] = createSignal(0);
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);

  // TTS integration
  const { settings } = useSettings();
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

  // Calculate session progress percentage
  const sessionProgress = createMemo(() => {
    const total = initialTotal();
    if (total === 0) return 100;
    return Math.round((cardsAnswered() / total) * 100);
  });

  // Initialize session total on mount
  onMount(() => {
    setInitialTotal(counts().total);
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
          undoLastAction();
          setCardsAnswered(prev => Math.max(0, prev - 1));
          setShowAnswer(false);
        }
        return;
      }

      if (isComplete()) return;

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

  // Track timer for waiting-for-cards auto-refresh
  let waitingTimer: ReturnType<typeof setTimeout> | null = null;
  let waitingCountdownTimer: ReturnType<typeof setInterval> | null = null;
  
  const clearWaitingTimers = () => {
    if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
    if (waitingCountdownTimer) { clearInterval(waitingCountdownTimer); waitingCountdownTimer = null; }
  };
  
  onCleanup(clearWaitingTimers);

  // Check if session is complete or waiting for learning cards
  createEffect(() => {
    const card = currentCard();
    const total = counts().total;
    if (!card && total === 0) {
      // No immediately-due cards. Check if there are pending learning cards.
      const nextDue = SRS.getNextPendingLearningDueDate(queue(), store.flashcards);
      if (nextDue !== null) {
        // There are learning cards that are not yet due -- show waiting state
        setIsComplete(false);
        setIsWaiting(true);
        
        const updateWaitingStr = () => {
          const remaining = nextDue - Date.now();
          if (remaining <= 0) {
            setWaitingTimeStr('');
          } else {
            setWaitingTimeStr(intervalToString(remaining));
          }
        };
        updateWaitingStr();
        
        clearWaitingTimers();
        // Countdown display update
        waitingCountdownTimer = setInterval(updateWaitingStr, 1000);
        // Auto-refresh when the card becomes due
        const delay = Math.max(0, nextDue - Date.now()) + 500;
        waitingTimer = setTimeout(() => {
          clearWaitingTimers();
          refreshQueue();
          setIsWaiting(false);
        }, delay);
      } else {
        // Truly complete - no learning cards pending
        clearWaitingTimers();
        setIsWaiting(false);
        setIsComplete(true);
        props.onComplete?.();
      }
    } else {
      clearWaitingTimers();
      setIsWaiting(false);
      setIsComplete(false);
    }
  });

  // Auto-TTS: play word when a new card appears
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      if (!cardId || !settings.flashcardAutoTts) return;
      const card = currentCard();
      if (!card) return;
      playTts(card.id, card.content.front, settings.language, 'word');
    }
  ));

  // Auto-TTS: play example when answer is revealed (waits for word TTS to finish)
  createEffect(on(
    () => showAnswer(),
    (isShown) => {
      if (!isShown || !settings.flashcardAutoTts) return;
      const card = currentCard();
      if (!card?.content.example || card.content.example === '-') return;
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
      answerCard(quality);
      setCardsAnswered(prev => prev + 1);
    });
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
        } catch {
          // Use plain text if tokenization fails
        }
        updateFlashcardContent(cardId, {
          example: exampleHtml,
          exampleMeaning: result.meaning || undefined,
        });
        showToast({ message: t('mlearn.CardEditor.RegenerateExample'), variant: 'success' });
      }
    } catch (e) {
      console.warn('Failed to regenerate example:', e);
    } finally {
      setRegeneratingExample(false);
    }
  };

  const handleStartOver = () => {
    refreshQueue();
    setShowAnswer(false);
    setIsComplete(false);
    // Reset progress tracking for new session
    setCardsAnswered(0);
    setTimeout(() => {
      setInitialTotal(counts().total);
    }, 0);
  };

  // Rating buttons config with time estimates
  const ratingButtons = createMemo(() => {
    const dates = previewDates();
    if (!dates) return [];

    return [
      {
        quality: 'again' as Rating,
        label: t('mlearn.Flashcards.Review.Again'),
        className: 'flashcard-rating-btn--again',
        time: dueDateToString(dates.again),
        key: '1'
      },
      {
        quality: 'hard' as Rating,
        label: t('mlearn.Flashcards.Review.Hard'),
        className: 'flashcard-rating-btn--hard',
        time: dueDateToString(dates.hard),
        key: '2'
      },
      {
        quality: 'good' as Rating,
        label: t('mlearn.Flashcards.Review.Ok'),
        className: 'flashcard-rating-btn--good',
        time: dueDateToString(dates.good),
        key: '3'
      },
      {
        quality: 'easy' as Rating,
        label: t('mlearn.Flashcards.Review.Easy'),
        className: 'flashcard-rating-btn--easy',
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
        <Show when={initialTotal() > 0}>
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
            {/* Bury/Remove in header to prevent misclicks */}
            <Show when={!isComplete() && currentCard()}>
              <div class="flashcard-action-buttons">
                <Button
                    buttonType="default"
                    variant="ghost"
                    size="sm"
                    class="flashcard-action-btn flashcard-action-btn--bury"
                    onClick={handleBury}
                    title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}
                >
                  <span class="flashcard-action-label">{t('mlearn.Flashcards.Review.Bury')}</span>
                </Button>
                <Button
                    buttonType="default"
                    variant="danger"
                    size="sm"
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
              <Button buttonType="default" variant="ghost" size="sm" onClick={() => { undoLastAction(); setCardsAnswered(prev => Math.max(0, prev - 1)); }} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
                {t('mlearn.Flashcards.Review.Undo')}
              </Button>
            </Show>
            <Show when={isElectron() && !isComplete() && currentCard()}>
              <Button
                buttonType="default"
                variant="ghost"
                size="sm"
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

        {/* Card or completion/waiting screen */}
        <Show
            when={!isComplete() && !isWaiting() && currentCard()}
            fallback={
              <Show when={isWaiting()} fallback={
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
              }>
                <Panel
                    variant="default"
                    rounded="xl"
                    class="flashcard-completion"
                >
                  <h2 class="flashcard-completion-title">
                    {t('mlearn.Flashcards.Review.WaitingTitle')}
                  </h2>
                  <p class="flashcard-completion-text">
                    {t('mlearn.Flashcards.Review.WaitingDescription', { time: waitingTimeStr() })}
                  </p>
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
                        class={`flashcard-rating-btn ${btn.className}`}
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
      </div>
  );
};
