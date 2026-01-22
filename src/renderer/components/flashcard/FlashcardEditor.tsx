/**
 * Flashcard Editor Component
 * Full-featured editor for flashcards with pitch accent, contentEditable fields,
 * and all the features from the old word database editor
 */

import { Component, createSignal, createEffect, createMemo, Show, onMount } from 'solid-js';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import { useSettings, useLanguage } from '../../context';
import { buildPitchAccentHtml, getPitchAccentInfo, getPitchAccentName } from '../../utils/pitchAccent';
import { GlassInput, GlassButton } from '../common';
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

  // Form state
  const [word, setWord] = createSignal('');
  const [pronunciation, setPronunciation] = createSignal('');
  const [pitchAccent, setPitchAccent] = createSignal<number | undefined>(undefined);
  const [pos, setPos] = createSignal('');
  const [definition, setDefinition] = createSignal('');
  const [translation, setTranslation] = createSignal('');
  const [example, setExample] = createSignal('');
  const [exampleMeaning, setExampleMeaning] = createSignal('');
  const [level, setLevel] = createSignal(-1);
  const [screenshotUrl, setScreenshotUrl] = createSignal('');
  
  // ContentEditable refs
  let definitionRef: HTMLDivElement | undefined;
  let exampleRef: HTMLDivElement | undefined;
  let exampleMeaningRef: HTMLDivElement | undefined;

  // Initialize form from flashcard or initial content
  onMount(() => {
    const content = props.flashcard?.content ?? props.initialContent;
    if (content) {
      setWord(content.word || '');
      setPronunciation(content.pronunciation || '');
      setPitchAccent(content.pitchAccent);
      setPos(content.pos || '');
      
      // Handle definition - could be array or string
      const def = content.definition;
      if (Array.isArray(def)) {
        setDefinition(def.join('<br/>'));
      } else {
        setDefinition(def || '');
      }
      
      // Handle translation - could be array or string
      const trans = content.translation;
      if (Array.isArray(trans)) {
        setTranslation(trans.join(', '));
      } else {
        setTranslation(trans || '');
      }
      
      setExample(content.example || '');
      setExampleMeaning(content.exampleMeaning || '');
      setLevel(content.level ?? -1);
      setScreenshotUrl(content.screenshotUrl || '');
    }
  });

  // Sync contentEditable values
  createEffect(() => {
    if (definitionRef) {
      definitionRef.innerHTML = definition();
    }
  });

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

  // Compute pitch accent preview HTML
  const pitchPreviewHtml = createMemo(() => {
    if (!supportsPitchAccent()) return null;
    const pa = pitchAccent();
    const reading = pronunciation() || word();
    if (pa === undefined || pa < 0 || !reading) return null;
    
    const info = getPitchAccentInfo(pa, reading);
    if (!info) return null;
    
    return buildPitchAccentHtml(info, reading.length, {
      includeParticleBox: true,
      padTo: reading.length,
    });
  });

  // Compute pitch accent name (heiban, atamadaka, etc.)
  const pitchName = createMemo(() => {
    if (!supportsPitchAccent()) return '';
    const pa = pitchAccent();
    const reading = pronunciation() || word();
    if (pa === undefined || pa < 0 || !reading) return '';
    return getPitchAccentName(pa, reading.length);
  });

  // Handle contentEditable input
  const handleDefinitionInput = (e: Event) => {
    const el = e.target as HTMLDivElement;
    setDefinition(el.innerHTML);
  };

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
    // Parse translation into array
    const translationArr = translation()
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    
    // Parse definition - it's stored as string but type expects array
    const definitionArr = definition()
      .split(/<br\s*\/?>/i)
      .map(s => s.trim())
      .filter(Boolean);

    const content: FlashcardContent = {
      word: word(),
      pronunciation: pronunciation() || word(),
      pitchAccent: pitchAccent(),
      pos: pos(),
      definition: definitionArr,
      translation: translationArr,
      example: example(),
      exampleMeaning: exampleMeaning(),
      level: level(),
      screenshotUrl: screenshotUrl(),
      contextPhrase: props.flashcard?.content.contextPhrase || '',
    };

    props.onSave(content);
  };

  // Get stats for existing card
  const cardStats = createMemo(() => {
    const fc = props.flashcard;
    if (!fc) return null;
    
    const intervalMs = fc.interval ?? 0;
    const intervalDays = intervalMs > 0 ? Math.round(intervalMs / 1000 / 60 / 60 / 24 * 10) / 10 : 0;
    
    return {
      ease: fc.ease,
      reviews: fc.reviews,
      lastReviewed: fc.lastReviewed ? new Date(fc.lastReviewed).toLocaleString() : '—',
      dueDate: fc.dueDate ? new Date(fc.dueDate).toLocaleString() : '—',
      interval: intervalDays > 0 ? `${intervalDays}d` : '—',
    };
  });

  return (
    <div class="flashcard-editor">
      <div class="editor-section">
        <div class="editor-row">
          <GlassInput
            label="Word"
            value={word()}
            onInput={(e) => setWord(e.currentTarget.value)}
            placeholder="Word..."
            fullWidth
          />
        </div>

        <div class="editor-row">
          <GlassInput
            label="Reading / Pronunciation"
            value={pronunciation()}
            onInput={(e) => setPronunciation(e.currentTarget.value)}
            placeholder="Pronunciation..."
            fullWidth
          />
        </div>

        {/* Pitch Accent Section - only show for languages that support it */}
        <Show when={supportsPitchAccent()}>
          <div class="editor-row pitch-row">
            <div class="pitch-input-group">
              <label>Pitch Accent</label>
              <input
                type="number"
                min="0"
                value={pitchAccent() ?? ''}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  setPitchAccent(val ? parseInt(val, 10) : undefined);
                }}
                placeholder="0 (Heiban), 1, 2, 3…"
                class="pitch-input"
              />
            </div>
            <div class="pitch-name">{pitchName()}</div>
            <div class="pitch-preview">
              <span class="pronunciation-preview">{pronunciation() || word()}</span>
              <Show when={pitchPreviewHtml()}>
                <div class="mLearn-pitch-accent" innerHTML={pitchPreviewHtml()!} />
              </Show>
            </div>
          </div>
        </Show>

        <div class="editor-row">
          <GlassInput
            label="Part of Speech"
            value={pos()}
            onInput={(e) => setPos(e.currentTarget.value)}
            placeholder="Noun, Verb, etc..."
            fullWidth
          />
        </div>
      </div>

      {/* Main Card Content */}
      <div class="editor-section card-preview">
        <div class="card-word">{word() || '(Word)'}</div>
        
        {/* Translation - contentEditable */}
        <div class="editor-field">
          <label>Translation (comma or newline separated)</label>
          <div
            contentEditable
            class="content-editable translation-edit"
            onInput={(e) => setTranslation((e.target as HTMLDivElement).innerText)}
          >
            {translation()}
          </div>
        </div>

        {/* Example sentence - contentEditable with HTML */}
        <div class="editor-field">
          <label>Example Sentence (HTML allowed)</label>
          <div
            ref={exampleRef}
            contentEditable
            class="content-editable example-edit"
            onInput={handleExampleInput}
          />
        </div>

        {/* Example meaning - contentEditable */}
        <div class="editor-field">
          <label>Example Translation</label>
          <div
            ref={exampleMeaningRef}
            contentEditable
            class="content-editable example-meaning-edit"
            onInput={handleExampleMeaningInput}
          />
        </div>

        {/* Definition - contentEditable with HTML support */}
        <div class="editor-field">
          <label>Definition (HTML allowed)</label>
          <div
            ref={definitionRef}
            contentEditable
            class="content-editable definition-edit"
            onInput={handleDefinitionInput}
          />
        </div>

        {/* Screenshot preview */}
        <Show when={screenshotUrl()}>
          <div class="screenshot-preview">
            <img src={screenshotUrl()} alt="Screenshot" />
          </div>
        </Show>
      </div>

      {/* Stats Section - only for existing cards */}
      <Show when={props.showStats && cardStats()}>
        <div class="editor-section stats-section">
          <h3>Statistics</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">Ease:</span>
              <span class="stat-value">{cardStats()!.ease}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Reviews:</span>
              <span class="stat-value">{cardStats()!.reviews}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Last Reviewed:</span>
              <span class="stat-value">{cardStats()!.lastReviewed}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Due Date:</span>
              <span class="stat-value">{cardStats()!.dueDate}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Interval:</span>
              <span class="stat-value">{cardStats()!.interval}</span>
            </div>
          </div>
        </div>
      </Show>

      <div class="editor-hint">
        Translations: comma or newline separated. Pitch accent is mora drop position (0=heiban).
      </div>

      {/* Footer Actions */}
      <div class="editor-footer">
        <GlassButton onClick={props.onCancel}>Cancel</GlassButton>
        <GlassButton variant="primary" onClick={handleSave}>
          Save Changes
        </GlassButton>
      </div>
    </div>
  );
};

export default FlashcardEditor;
