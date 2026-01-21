/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 * Matches the legacy .aside-c horizontal card strip behavior
 */

import { Component, createSignal, For, Show, onCleanup, createEffect } from 'solid-js';
import { useSettings } from '../../context';
import { IPC_CHANNELS } from '../../../shared/constants';
import { extractKanaReading } from '../../utils/subtitleParsing';
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
  const [isVisible, setIsVisible] = createSignal(false);
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

    // Show the panel and reset hide timeout
    setIsVisible(true);
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
    
    if (!isHovered()) {
      hideTimeout = setTimeout(() => {
        setIsVisible(false);
        // Clear cards after fade out
        setTimeout(() => setCards([]), 300);
      }, HIDE_DELAY);
    }
  };

  // Handle mouse hover to keep panel visible
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    setIsVisible(true);
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
        setIsVisible(true);
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
          setIsVisible(true);
          resetHideTimeout();
        },
        hide: () => setIsVisible(false),
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
      class={`live-word-translator ${!isVisible() ? 'opacity0' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Show when={cards().length > 0}>
        <div class="aside-c">
          <For each={cards()}>
            {(card) => {
              // Extract only kana reading (not kanji with ruby)
              const kanaReading = () => extractKanaReading(card.reading);
              const hasDistinctReading = () => kanaReading() && kanaReading() !== card.word;
              
              return (
                <div class="aside-card" id={card.id}>
                  <div class="card-translation">{card.translation}</div>
                  <div class="card-reading">
                    {/* Show word and reading separately (not as ruby) */}
                    <span class="card-word">{card.word}</span>
                    <Show when={hasDistinctReading()}>
                      <span class="card-kana">{kanaReading()}</span>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default LiveWordTranslator;
