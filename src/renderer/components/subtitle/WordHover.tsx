/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect } from 'solid-js';
import type { Token, DictionaryEntry, TranslationEntry, PitchData } from '../../../shared/types';
import { useSettings, useFlashcards } from '../../context';
import './WordHover.css';

// Icon paths - served from static assets
const ICON_CROSS = 'assets/icons/cross2.svg';
const ICON_CHECK = 'assets/icons/check.svg';
const ICON_BOT = 'assets/icons/bot.svg';

export type WordStatus = 'unknown' | 'learning' | 'known';

export interface WordHoverProps {
  token: Token;
  word: string;
  position: { x: number; y: number };
  anchorRect?: DOMRect;
  dictionaryEntries?: DictionaryEntry[];
  translationData?: { data?: (TranslationEntry | PitchData | null | undefined)[] };
  pitchAccent?: { position?: number; reading?: string };
  isLoading?: boolean;
  status?: WordStatus;
  level?: number; // JLPT level (1-5) or frequency level (1-7)
  isInSRS?: boolean;
  ease?: number;
  onStatusChange?: (status: WordStatus) => void;
  onAddFlashcard?: (token: Token, entry?: DictionaryEntry) => void;
  onAddToSRS?: () => void;
  onPlayAudio?: (word: string) => void;
  onLLMExplain?: () => void;
  onClose?: () => void;
  visible?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings } = useSettings();
  const { addFlashcard } = useFlashcards();
  const [placement, setPlacement] = createSignal<'above' | 'below'>('above');
  const [currentStatus, setCurrentStatus] = createSignal<WordStatus>(props.status || 'unknown');
  let hoverRef: HTMLDivElement | undefined;

  // Helper to get display word
  const displayWord = () => props.word || props.token.surface || props.token.word;

  const isShown = createMemo(() => props.visible !== false);

  // Determine placement (above preferred, flip below if needed)
  createEffect(() => {
    const anchor = props.anchorRect;
    if (!hoverRef || !anchor) return;
    const run = () => {
      const h = hoverRef?.offsetHeight || 0;
      const margin = 12;
      const shouldPlaceAbove = anchor.top - h - margin >= 0;
      setPlacement(shouldPlaceAbove ? 'above' : 'below');
    };
    requestAnimationFrame(run);
  });

  // Calculate position to keep popup on screen
  const hoverStyle = createMemo((): JSX.CSSProperties => {
    const width = 400;
    let x = props.position.x;
    const anchor = props.anchorRect;
    const baseTop = anchor ? anchor.top : props.position.y;
    const baseBottom = anchor ? anchor.bottom : props.position.y + 16;
    const y = placement() === 'above' ? baseTop - 8 : baseBottom + 8;

    // Adjust if too close to right edge
    if (typeof window !== 'undefined' && x + width / 2 > window.innerWidth) {
      x = window.innerWidth - width / 2 - 16;
    }
    if (x - width / 2 < 0) {
      x = width / 2 + 16;
    }

    return {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      transform: placement() === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      'z-index': '1000',
    };
  });

  const handleStatusChange = () => {
    const statusOrder: WordStatus[] = ['unknown', 'learning', 'known'];
    const currentIdx = statusOrder.indexOf(currentStatus());
    const nextIdx = (currentIdx + 1) % statusOrder.length;
    const newStatus = statusOrder[nextIdx];
    setCurrentStatus(newStatus);
    props.onStatusChange?.(newStatus);
  };

  const handleAddFlashcard = (entry?: DictionaryEntry) => {
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
    } else {
      addFlashcard({
        word: displayWord(),
        pronunciation: props.token.reading || displayWord(),
        translation: entry?.meanings ? [entry.meanings.join('; ')] : undefined,
        definition: props.token.meaning ? [props.token.meaning] : undefined,
        example: '',
        exampleMeaning: '',
        pos: props.token.partOfSpeech ?? props.token.type ?? '',
        level: props.level ?? 0,
      });
    }
  };

  const handleAddToSRS = () => {
    props.onAddToSRS?.();
  };

  const handleLLMExplain = () => {
    props.onLLMExplain?.();
  };

  // Translation entries (legacy shows all definitions/readings returned by backend)
  const translationEntries = createMemo<TranslationEntry[]>(() => {
    const data = props.translationData?.data || [];
    const entries: TranslationEntry[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as TranslationEntry;
      if (entry.definitions) entries.push(entry);
    }
    return entries;
  });


  // Get POS type
  const posType = () => props.token.partOfSpeech || props.token.type || '';

  // Map legacy JLPT levels to display names
  const levelDisplayMap: { [key: number]: string } = {
    1: 'JLPT N1',
    2: 'JLPT N2',
    3: 'JLPT N3',
    4: 'JLPT N4',
    5: 'JLPT N5',
    6: 'N0',
    7: '10K',
  };

  // Status pill component - matches legacy HTML exactly
  const StatusPill = () => {
    const status = currentStatus();

    if (status === 'unknown') {
      return (
        <div class="pill pill-btn red" onClick={handleStatusChange}>
          <span class="icon">
            <img src={ICON_CROSS} alt="" />
          </span>
          <span>Unknown</span>
        </div>
      );
    } else if (status === 'learning') {
      return (
        <div class="pill pill-btn orange" onClick={handleStatusChange}>
          <span class="icon">
            <img src={ICON_CHECK} alt="" />
          </span>
          <span>Learning</span>
        </div>
      );
    } else {
      return (
        <div class="pill pill-btn green" onClick={handleStatusChange}>
          <span class="icon">
            <img src={ICON_CHECK} alt="" />
          </span>
          <span>Known</span>
        </div>
      );
    }
  };

  // Level pill - matches legacy with level attribute for CSS styling
  const LevelPill = () => {
    const level = props.level;
    if (level === undefined || level < 0) return null;

    const levelName = levelDisplayMap[level] || `${level}`;

    return (
      <div class="pill" attr:level={level}>
        {levelName}
      </div>
    );
  };

  // POS pill - matches legacy
  const POSPill = () => {
    const pos = posType();
    if (!pos || !settings.show_pos) return null;

    return <div class="pill">{pos}</div>;
  };

  // Flashcard pill - matches legacy exactly
  const FlashcardPill = () => {
    if (props.isInSRS) {
      return (
        <div class="pill pill-btn green">
          <span class="icon">
            <img src={ICON_CHECK} alt="" />
          </span>
          <span>Tracked</span>
        </div>
      );
    }

    return (
      <div class="pill pill-btn blue" onClick={handleAddToSRS}>
        <span class="icon">
          <img src={ICON_CROSS} alt="" style={{ transform: 'rotate(45deg)' }} />
        </span>
        <span>Flashcard</span>
      </div>
    );
  };

  // Ease indicator - matches legacy
  const EasePill = () => {
    if (props.ease === undefined) return null;

    return (
      <div class="ease-indicator">
        <span>Ease: {Math.round(props.ease * 100) / 100}</span>
      </div>
    );
  };

  // LLM Explain pill - matches legacy
  const LLMPill = () => {
    return (
      <div class="pill pill-btn blue" onClick={handleLLMExplain}>
        <span class="icon">
          <img src={ICON_BOT} alt="" />
        </span>
        <span>Explain</span>
      </div>
    );
  };

  // Pitch accent pill - matches legacy with visual diagram
  const PitchAccentPill = () => {
    const pitch = props.pitchAccent;
    if (!pitch || !pitch.reading || settings.language !== 'ja') return null;
    if (!settings.showPitchAccent) return null;

    return (
      <div class="pill gray pitch-accent-pill">
        <div class="pitch-accent-word">
          {pitch.reading}✦
          <div class="mLearn-pitch-accent" aria-hidden="true">
            {/* Pitch accent visualization would go here */}
          </div>
        </div>
      </div>
    );
  };

  // Frequency stars - matches legacy
  const FrequencyStars = () => {
    const level = props.level;
    if (level === undefined || level < 1 || level > 5) return null;

    return (
      <span class="frequency" attr:level={level}>
        <For each={Array(level).fill(0)}>
          {() => <span class="star"></span>}
        </For>
      </span>
    );
  };

  return (
    <div
      class="word-hover-container"
      style={hoverStyle()}
      ref={hoverRef}
      onMouseEnter={() => props.onMouseEnter?.()}
      onMouseLeave={() => props.onMouseLeave?.()}
    >
      <div class={`subtitle_hover ${isShown() ? 'show-hover' : ''} ${settings.dark_mode ? 'dark' : ''}`}>
        <div class="subtitle_hover_relative">
          <div class="subtitle_hover_content">
            {/* Loading state */}
            <Show when={props.isLoading}>
              <div class="hover_loading">Loading...</div>
            </Show>

            {/* Translation content - matches legacy order */}
            <Show when={!props.isLoading}>
              <Show when={translationEntries().length > 0}>
                <For each={translationEntries()}>
                  {(entry, index) => (
                    <>
                      <Show when={index() > 0}>
                        <hr />
                      </Show>
                      <div class="hover_translation">
                        {Array.isArray(entry.definitions)
                          ? entry.definitions.join('; ')
                          : String(entry.definitions)}
                      </div>
                      <Show when={entry.reading}>
                        <div class="hover_reading">{entry.reading}</div>
                      </Show>
                    </>
                  )}
                </For>
              </Show>

              {/* Dictionary entries - additional meanings if provided */}
              <Show when={translationEntries().length === 0 && props.dictionaryEntries && props.dictionaryEntries.length > 0}>
                <For each={props.dictionaryEntries}>
                  {(entry, index) => (
                    <>
                      <Show when={index() > 0}>
                        <hr />
                      </Show>
                      <div class="hover_translation">
                        {entry.meanings?.join('; ')}
                      </div>
                      <Show when={entry.reading}>
                        <div class="hover_reading">{entry.reading}</div>
                      </Show>
                    </>
                  )}
                </For>
              </Show>

              {/* No results fallback */}
              <Show when={translationEntries().length === 0 && (!props.dictionaryEntries || props.dictionaryEntries.length === 0)}>
                <div class="hover_translation">No translation found</div>
              </Show>
            </Show>
          </div>

          {/* Footer with pills - matches legacy .footer structure */}
          <div class="footer">
            <div class="pills">
              <PitchAccentPill />
              <LevelPill />
              <POSPill />
              <StatusPill />
              <FlashcardPill />
              <Show when={props.isInSRS}>
                <EasePill />
              </Show>
              <LLMPill />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
