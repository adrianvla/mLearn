/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 * Matches the legacy .aside card strip behavior exactly
 *
 * Layout: Translation/definition (h1) on left, reading/pronunciation (p) on right
 */

import { Component, createSignal, For, onCleanup, createEffect, Show } from 'solid-js';
import { useSettings } from '../../context';
import { PanelHeader } from '../common';
import { getBridge } from '../../../shared/bridges';
import './LiveWordTranslator.css';

interface TranslationCard {
  id: string;
  translation: string; // The definition/meaning - shown on left
  reading: string;     // The reading/pronunciation - shown on right
  timestamp: number;
}

export const LiveWordTranslator: Component = () => {
  const { settings, updateSetting } = useSettings();
  const [isActive, setIsActive] = createSignal(false);
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

    setIsActive(true);
    resetHideTimeout();
  };

  // Remove a card
  const removeCard = (cardId: string) => {
    setCards((prev) => prev.filter(c => c.id !== cardId));
  };

  // Reset the hide timeout — only fades the background, cards remain
  const resetHideTimeout = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    if (!isHovered()) {
      hideTimeout = setTimeout(() => {
        setIsActive(false);
      }, HIDE_DELAY);
    }
  };

  // Handle mouse hover to keep panel background visible
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    setIsActive(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    resetHideTimeout();
  };

  // Listen for IPC events to show aside
  createEffect(() => {
    const handleShowAside = () => {
      setIsActive(true);
      updateSetting('openAside', true);
      resetHideTimeout();
    };

    const cleanup = getBridge().window.onOpenAside(handleShowAside);

    onCleanup(() => {
      cleanup();
    });
  });

  // Expose addCard globally for subtitle components to use
  createEffect(() => {
    if (typeof window !== 'undefined') {
      window.mLearnLiveTranslator = {
        addCard,
        removeCard,
        show: () => {
          setIsActive(true);
          updateSetting('openAside', true);
          resetHideTimeout();
        },
        hide: () => {
          setIsActive(false);
          setCards([]);
          updateSetting('openAside', false);
        },
        isVisible: () => cards().length > 0,
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
    if (!isActive()) {
      classes.push('idle');
    }
    if (settings.openAside === false) {
      classes.push('hidden');
    }
    return classes.join(' ');
  };

  return (
    <Show when={settings.showLiveTranslator !== false}>
      <div
          class={containerClass()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
      >
        {/* Header with close button */}
        <PanelHeader onClose={() => { setIsActive(false); setCards([]); updateSetting('openAside', false); }} />

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
    </Show>
  );
};

export default LiveWordTranslator;
