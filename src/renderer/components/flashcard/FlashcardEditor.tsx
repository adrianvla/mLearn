/**
 * Flashcard Editor Component
 * Full-featured editor for flashcards with pitch accent, contentEditable fields,
 * TTS regeneration, and example sentence generation.
 * Updated for the new UUID-keyed flashcard format
 */

import { Component, createSignal, createEffect, createMemo, Show, onMount } from 'solid-js';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import { useSettings, useLanguage, useLocalization, useFlashcards } from '../../context';
import { getPitchAccentName } from '../../utils/pitchAccent';
import { Input, Btn, PitchAccentOverlay } from '../common';
import { TtsGenerateModal } from './TtsGenerateModal';
import { getBackend } from '../../../shared/backends';
import { isElectron } from '../../../shared/platform';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { showToast } from '../common/Feedback/Toast';
import './FlashcardEditor.css';

export interface FlashcardEditorProps {
  /** Flashcard to edit (null for new card) */
  flashcard?: Flashcard | null;
  /** Initial content for new card */
  initialContent?: Partial<FlashcardContent>;
  /** Called when save is clicked */
  onSave: (content: FlashcardContent) => void;
  /** Called when cancel is clicked */
  onCancel: () => void;
  /** Whether to show stats section (for existing cards) */
  showStats?: boolean;
}

export const FlashcardEditor: Component<FlashcardEditorProps> = (props) => {
  const { settings } = useSettings();
  const { getLanguageFeatures } = useLanguage();
  const { t } = useLocalization();
  const { intervalToString, generateExampleSentenceWithLLM, updateFlashcardContent } = useFlashcards();

  // Form state
  const [front, setFront] = createSignal('');
  const [back, setBack] = createSignal('');
  const [reading, setReading] = createSignal('');
  const [pitchAccent, setPitchAccent] = createSignal<number | undefined>(undefined);
  const [pos, setPos] = createSignal('');
  const [example, setExample] = createSignal('');
  const [exampleMeaning, setExampleMeaning] = createSignal('');
  const [level, setLevel] = createSignal<number | undefined>(undefined);
  const [imageUrl, setImageUrl] = createSignal('');

  // TTS / generation state
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);
  const [showTtsModal, setShowTtsModal] = createSignal(false);

  // ContentEditable refs
  let exampleRef: HTMLDivElement | undefined;
  let exampleMeaningRef: HTMLDivElement | undefined;

  // Initialize form from flashcard or initial content
  onMount(() => {
    const content = props.flashcard?.content ?? props.initialContent;
    if (content) {
      setFront(content.front || '');
      setBack(content.back || '');
      setReading(content.reading || '');
      setPitchAccent(content.pitchAccent);
      setPos(content.pos || '');
      setExample(content.example || '');
      setExampleMeaning(content.exampleMeaning || '');
      setLevel(content.level);
      setImageUrl(content.imageUrl || '');
    }
  });

  // Sync contentEditable values
  createEffect(() => {
    if (exampleRef) {
      exampleRef.innerHTML = example();
    }
  });

  createEffect(() => {
    if (exampleMeaningRef) {
      exampleMeaningRef.innerHTML = exampleMeaning();
    }
  });

  // Language features check
  const features = createMemo(() => getLanguageFeatures());
  const supportsPitchAccent = createMemo(() => features().supportsPitchAccent && settings.showPitchAccent);

  // Compute pitch accent name (heiban, atamadaka, etc.)
  const pitchName = createMemo(() => {
    if (!supportsPitchAccent()) return '';
    const pa = pitchAccent();
    const readingVal = reading() || front();
    if (pa === undefined || pa < 0 || !readingVal) return '';
    return getPitchAccentName(pa, readingVal.length);
  });

  // Handle contentEditable input
  const handleExampleInput = (e: Event) => {
    const el = e.target as HTMLDivElement;
    setExample(el.innerHTML);
  };

  const handleExampleMeaningInput = (e: Event) => {
    const el = e.target as HTMLDivElement;
    setExampleMeaning(el.innerHTML);
  };

  // Handle save
  const handleSave = () => {
    const content: FlashcardContent = {
      type: props.flashcard?.content.type || 'word',
      front: front(),
      back: back(),
      reading: reading() || undefined,
      pitchAccent: pitchAccent(),
      pos: pos() || undefined,
      level: level(),
      example: example() || undefined,
      exampleMeaning: exampleMeaning() || undefined,
      imageUrl: imageUrl() || undefined,
    };

    props.onSave(content);
  };

  /** Regenerate example sentence using LLM */
  const handleRegenerateExample = async () => {
    const card = props.flashcard;
    if (!card) return;

    setRegeneratingExample(true);
    try {
      const result = await generateExampleSentenceWithLLM(front(), back(), settings.language);
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
            exampleHtml = tokensToColoredHtml(tokens, settings.colour_codes || {}, front());
          }
        } catch {
          // Use plain text if tokenization fails
        }
        setExample(exampleHtml);
        setExampleMeaning(result.meaning || '');
        // Also persist to the flashcard store
        updateFlashcardContent(card.id, {
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

  /** Check if this card has TTS audio saved */
  const hasTtsAudio = createMemo(() => {
    // Only show regenerate for existing cards on Electron
    return !!props.flashcard && isElectron();
  });

  // Get stats for existing card
  const cardStats = createMemo(() => {
    const fc = props.flashcard;
    if (!fc) return null;

    return {
      ease: fc.ease.toFixed(2),
      reviews: fc.reviews,
      lapses: fc.lapses,
      state: fc.state,
      lastReviewed: fc.lastReviewed ? new Date(fc.lastReviewed).toLocaleString() : '—',
      dueDate: fc.dueDate ? new Date(fc.dueDate).toLocaleString() : '—',
      interval: fc.interval > 0 ? intervalToString(fc.interval) : '—',
    };
  });

  return (
    <div class="flashcard-editor">
      <div class="editor-section">
        <div class="editor-row">
          <Input
            label={t('mlearn.CardEditor.Fields.Word')}
            value={front()}
            onInput={(e) => setFront(e.currentTarget.value)}
            placeholder={t('mlearn.CardEditor.Fields.WordPlaceholder')}
            fullWidth
          />
        </div>

        <div class="editor-row">
          <Input
            label={t('mlearn.CardEditor.Fields.Reading')}
            value={reading()}
            onInput={(e) => setReading(e.currentTarget.value)}
            placeholder={t('mlearn.CardEditor.Fields.ReadingPlaceholder')}
            fullWidth
          />
        </div>

        {/* Pitch Accent Section - only show for languages that support it */}
        <Show when={supportsPitchAccent()}>
          <div class="editor-row pitch-row">
            <div class="pitch-input-group">
              <label>{t('mlearn.CardEditor.Fields.PitchAccent')}</label>
              <input
                type="number"
                min="0"
                value={pitchAccent() ?? ''}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  setPitchAccent(val ? parseInt(val, 10) : undefined);
                }}
                placeholder={t('mlearn.CardEditor.Fields.PitchAccentPlaceholder')}
                class="pitch-input"
              />
            </div>
            <div class="pitch-name">{pitchName()}</div>
            <div class="pitch-preview">
              <PitchAccentOverlay
                word={front()}
                reading={reading() || front()}
                pitchPosition={pitchAccent()}
                mode="preview"
                showParticleBox={true}
              />
            </div>
          </div>
        </Show>

        <div class="editor-row">
          <Input
            label={t('mlearn.WordDbEditor.Fields.PartOfSpeech')}
            value={pos()}
            onInput={(e) => setPos(e.currentTarget.value)}
            placeholder={t('mlearn.WordDbEditor.Fields.PosPlaceholder')}
            fullWidth
          />
        </div>
      </div>

      {/* Main Card Content */}
      <div class="editor-section card-preview">
        <div class="card-word">{front() || t('mlearn.CardEditor.Fields.SurfaceNote')}</div>

        {/* Meaning/Translation - contentEditable */}
        <div class="editor-field">
          <label>{t('mlearn.CardEditor.Fields.Translation')}</label>
          <div
            contentEditable
            class="content-editable translation-edit"
            onInput={(e) => setBack((e.target as HTMLDivElement).innerText)}
          >
            {back()}
          </div>
        </div>

        {/* Example sentence - contentEditable with HTML */}
        <div class="editor-field">
          <div class="editor-field-header">
            <label>{t('mlearn.CardEditor.Fields.ExampleSentence')}</label>
            <Show when={props.flashcard}>
              <div class="editor-field-actions">
                <Btn
                  size="xs"
                  variant="ghost"
                  onClick={handleRegenerateExample}
                  disabled={regeneratingExample()}
                >
                  {t('mlearn.CardEditor.RegenerateExample')}
                </Btn>
              </div>
            </Show>
          </div>
          <div
            ref={exampleRef}
            contentEditable
            class="content-editable example-edit"
            onInput={handleExampleInput}
          />
        </div>

        {/* Example meaning - contentEditable */}
        <div class="editor-field">
          <label>{t('mlearn.CardEditor.Fields.ExampleTranslation')}</label>
          <div
            ref={exampleMeaningRef}
            contentEditable
            class="content-editable example-meaning-edit"
            onInput={handleExampleMeaningInput}
          />
        </div>

        {/* Screenshot preview */}
        <Show when={imageUrl()}>
          <div class="screenshot-preview">
            <img src={imageUrl()} alt={t('mlearn.Flashcards.Card.ScreenshotAlt')} />
          </div>
        </Show>
      </div>

      {/* TTS Regeneration - only for existing cards on Electron */}
      <Show when={hasTtsAudio()}>
        <div class="editor-section">
          <Btn
            size="sm"
            variant="secondary"
            onClick={() => setShowTtsModal(true)}
          >
            {t('mlearn.CardEditor.Regenerate.Title')}
          </Btn>
          <TtsGenerateModal
            isOpen={showTtsModal()}
            onClose={() => setShowTtsModal(false)}
            cardId={props.flashcard!.id}
            wordText={front()}
            exampleText={example()}
            reading={reading()}
            cardBack={back()}
            onExampleGenerated={(ex, exMeaning) => {
              setExample(ex);
              setExampleMeaning(exMeaning);
            }}
          />
        </div>
      </Show>

      {/* Stats Section - only for existing cards */}
      <Show when={props.showStats && cardStats()}>
        <div class="editor-section stats-section">
          <h3>{t('mlearn.CardEditor.Statistics.Title')}</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.State')}</span>
              <span class="stat-value">{cardStats()!.state}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.Ease')}</span>
              <span class="stat-value">{cardStats()!.ease}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.Reviews')}</span>
              <span class="stat-value">{cardStats()!.reviews}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.Lapses')}</span>
              <span class="stat-value">{cardStats()!.lapses}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.LastReviewed')}</span>
              <span class="stat-value">{cardStats()!.lastReviewed}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{t('mlearn.CardEditor.Statistics.Interval')}</span>
              <span class="stat-value">{cardStats()!.interval}</span>
            </div>
          </div>
        </div>
      </Show>

      <div class="editor-hint">
        {t('mlearn.CardEditor.Hint')}
      </div>

      {/* Footer Actions */}
      <div class="editor-footer">
        <Btn onClick={props.onCancel}>{t('mlearn.Global.Cancel')}</Btn>
        <Btn variant="primary" onClick={handleSave}>
          {t('mlearn.Global.Actions.SaveChanges')}
        </Btn>
      </div>
    </div>
  );
};

export default FlashcardEditor;
