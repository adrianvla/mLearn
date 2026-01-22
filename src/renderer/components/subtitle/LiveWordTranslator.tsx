/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 * Matches the legacy .aside card strip behavior exactly
 * 
 * Layout: Translation/definition (h1) on left, Reading (p) on right
 */

import { Component, createSignal, For, Show, onCleanup, createEffect } from 'solid-js';
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
  const { settings, updateSetting } = useSettings();
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

  // Add a translation card - matches old addTranslationCard(translation, reading)
  // In old app: h1 = translation (English definition), p = reading (original word)
  // But looking at old code: addTranslationCard(first_meaning.definitions, first_meaning.reading)
  // So the params are: translation = definitions, reading = kana/word reading
  // The card shows: h1 = translation (definition), p = reading (word reading)
  const addCard = (word: string, reading: string, translationDef?: string) => {
    // Generate ID from reading (word reading) to dedupe
    const cardId = generateCardId(reading || word);
    
    // Check if already displaying this reading
    if (cards().some(c => c.id === cardId)) {
      return;
    }

    // Use provided translation, or word as fallback
    const displayTranslation = translationDef || word;
    const displayReading = reading || word;

    // Only add if we have something to show
    if (!displayTranslation) {
      return;
    }

    const newCard: TranslationCard = {
      id: cardId,
      translation: displayTranslation, // The definition/meaning
      reading: displayReading,         // The kana reading
      timestamp: Date.now(),
    };

    setCards((prev) => {
      // Add new card at the beginning (like old app's prepend behavior)
      const updated = [newCard, ...prev];
      // Limit to MAX_CARDS (old app limited to 6)
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

  // Reset the hide timeout - matches old asideTimeout behavior
  const resetHideTimeout = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    
    if (!isHovered()) {
      hideTimeout = setTimeout(() => {
        setIsVisible(false);
        // Clear cards after fade out (like old alreadyDisplayingCards = {})
        setTimeout(() => setCards([]), 300);
      }, HIDE_DELAY);
    }
  };

  // Handle mouse hover to keep panel visible (like old aside mouseover handler)
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
          // Also update settings to persist that the user wants it open
          // Matches old app: settings.openAside = true
          updateSetting('openAside', true);
          resetHideTimeout();
        },
        hide: () => {
          setIsVisible(false);
          // Matches old app: settings.openAside = false
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

  // Always render the container (can be shown via menu even if disabled)
  // Settings check happens at addCard level

  return (
    <div
      class={`live-word-translator aside ${!isVisible() ? 'opacity0' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header with close button - matches old aside .header */}
      <PanelHeader onClose={() => setIsVisible(false)} />
      {/* Card container - matches old aside .c */}
      <div class="c aside-c">
        <For each={cards()}>
          {(card) => (
            <div class="card aside-card" id={card.id}>
              {/* Translation/definition on left (h1), reading on right (p) */}
              <h1 innerHTML={card.translation}></h1>
              <p innerHTML={card.reading}></p>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default LiveWordTranslator;
