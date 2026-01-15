/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 */

import { Component, createSignal, For, Show, onCleanup, createEffect } from 'solid-js';
import { useSettings } from '../../context';
import { GlassPanel } from '../common';
import { IPC_CHANNELS } from '../../../shared/constants';
import './LiveWordTranslator.css';

interface TranslationCard {
  id: string;
  word: string;
  reading: string;
  translation: string;
  timestamp: number;
}

export const LiveWordTranslator: Component = () => {
  const { settings } = useSettings();
  const [isOpen, setIsOpen] = createSignal(false);
  const [cards, setCards] = createSignal<TranslationCard[]>([]);
  const [isHovered, setIsHovered] = createSignal(false);

  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  const MAX_CARDS = 6;
  const HIDE_DELAY = 5000;

  // Generate unique ID for a word
  const generateCardId = (word: string): string => {
    return `card_${btoa(encodeURIComponent(word)).replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  // Add a translation card
  const addCard = (word: string, reading: string, translation: string) => {
    const cardId = generateCardId(word);
    
    // Check if already displaying
    if (cards().some(c => c.id === cardId)) {
      return;
    }

    const newCard: TranslationCard = {
      id: cardId,
      word,
      reading,
      translation,
      timestamp: Date.now(),
    };

    setCards((prev) => {
      const updated = [newCard, ...prev];
      // Limit to MAX_CARDS
      if (updated.length > MAX_CARDS) {
        return updated.slice(0, MAX_CARDS);
      }
      return updated;
    });

    // Reset hide timeout
    resetHideTimeout();
  };

  // Remove a card
  const removeCard = (cardId: string) => {
    setCards((prev) => prev.filter(c => c.id !== cardId));
  };

  // Reset the hide timeout
  const resetHideTimeout = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    
    setIsOpen(true);
    
    if (!isHovered()) {
      hideTimeout = setTimeout(() => {
        setIsOpen(false);
        setCards([]);
      }, HIDE_DELAY);
    }
  };

  // Handle mouse hover to keep panel visible
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    resetHideTimeout();
  };

  // Listen for IPC events to show aside
  createEffect(() => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      // Listen for show-aside event from menu
      const handleShowAside = () => {
        setIsOpen(true);
        resetHideTimeout();
      };
      
      window.mLearnIPC.on(IPC_CHANNELS.SHOW_ASIDE, handleShowAside);
      
      onCleanup(() => {
        // Would need to implement removeListener
      });
    }
  });

  // Expose addCard globally for subtitle components to use
  createEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).mLearnLiveTranslator = {
        addCard,
        removeCard,
        show: () => {
          setIsOpen(true);
          resetHideTimeout();
        },
        hide: () => setIsOpen(false),
      };
    }
  });

  onCleanup(() => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
  });

  // Only render if enabled in settings
  if (!settings.openAside) {
    return null;
  }

  return (
    <div
      class={`live-word-translator ${isOpen() ? 'open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <GlassPanel
        variant="dark"
        blur="lg"
        rounded="lg"
        padding="md"
        class="translator-panel"
      >
        <div class="translator-header">
          <span class="translator-title">Live Translations</span>
          <button class="close-btn" onClick={() => setIsOpen(false)}>
            ×
          </button>
        </div>
        
        <div class="translator-cards">
          <Show
            when={cards().length > 0}
            fallback={
              <div class="empty-state">
                <p>Hover over words in subtitles to see translations here</p>
              </div>
            }
          >
            <For each={cards()}>
              {(card) => (
                <div class="translation-card" id={card.id}>
                  <div class="card-translation">{card.translation}</div>
                  <div class="card-reading">
                    <Show when={card.reading && card.reading !== card.word}>
                      <ruby>
                        {card.word}
                        <rt>{card.reading}</rt>
                      </ruby>
                    </Show>
                    <Show when={!card.reading || card.reading === card.word}>
                      {card.word}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </GlassPanel>
    </div>
  );
};

export default LiveWordTranslator;
