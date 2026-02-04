/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 * Matches the legacy .aside card strip behavior exactly
 *
 * Layout: Translation/definition (h1) on left, Reading (p) on right
 */

import { Component, createSignal, For, onCleanup, createEffect } from 'solid-js';
import { useSettings } from '../../context';
import { PanelHeader } from '../common';
import { IPC_CHANNELS } from '../../../shared/constants';
import './LiveWordTranslator.css';

interface TranslationCard {
  id: string;
  translation: string; // The definition/meaning (English) - shown on left
  reading: string;     // The kana reading - shown on right
  timestamp: number;
}

export const LiveWordTranslator: Component = () => {
  const { updateSetting } = useSettings();
  const [isVisible, setIsVisible] = createSignal(false);
  const [cards, setCards] = createSignal<TranslationCard[]>([]);
  const [isHovered, setIsHovered] = createSignal(false);

  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  const MAX_CARDS = 6;
  const HIDE_DELAY = 5000;

  // Generate unique ID for a word based on reading
  const generateCardId = (reading: string): string => {
    return `card_${btoa(encodeURIComponent(reading)).replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  // Add a translation card
  const addCard = (word: string, reading: string, translationDef?: string) => {
    const cardId = generateCardId(reading || word);

    // Check if already displaying this reading
    if (cards().some(c => c.id === cardId)) {
      return;
    }

    const displayTranslation = translationDef || word;
    const displayReading = reading || word;

    if (!displayTranslation) {
      return;
    }

    const newCard: TranslationCard = {
      id: cardId,
      translation: displayTranslation,
      reading: displayReading,
      timestamp: Date.now(),
    };

    setCards((prev) => {
      const updated = [newCard, ...prev];
      if (updated.length > MAX_CARDS) {
        return updated.slice(0, MAX_CARDS);
      }
      return updated;
    });

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
          updateSetting('openAside', true);
          resetHideTimeout();
        },
        hide: () => {
          setIsVisible(false);
          updateSetting('openAside', false);
        },
        isVisible: () => isVisible(),
      };
    }
  });

  onCleanup(() => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
  });

  const containerClass = () => {
    const classes = ['live-word-translator'];
    if (!isVisible()) {
      classes.push('hidden');
    }
    return classes.join(' ');
  };

  return (
      <div
          class={containerClass()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
      >
        {/* Header with close button */}
        <PanelHeader onClose={() => setIsVisible(false)} />

        {/* Card container */}
        <div class="translator-cards-container">
          <For each={cards()}>
            {(card) => (
                <div class="translator-card" id={card.id}>
                  <h1 class="translator-card-translation" innerHTML={card.translation} />
                  <p class="translator-card-reading" innerHTML={card.reading} />
                </div>
            )}
          </For>
        </div>
      </div>
  );
};

export default LiveWordTranslator;
