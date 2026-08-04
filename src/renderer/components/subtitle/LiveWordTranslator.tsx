/**
 * Live Word Translator (Aside Panel)
 * Shows automatic translations for words in subtitles
 * Matches the legacy .aside card strip behavior exactly
 *
 * Layout: Translation/definition (h1) on left, reading/pronunciation (p) on right
 */

import { Component, createSignal, For, onCleanup, createEffect, Show } from 'solid-js';
import { useSettings } from '../../context';
import { PanelHeader, SafeHtml } from '../common';
import { getBridge } from '../../../shared/bridges';
import './LiveWordTranslator.css';

interface TranslationCard {
  id: string;
  translation: string; // The definition/meaning - shown on left
  reading: string;     // The reading/pronunciation - shown on right
  timestamp: number;
  /** True while the card is fading out before removal */
  fading: boolean;
}

export const LiveWordTranslator: Component = () => {
  const { settings, updateSetting } = useSettings();
  const [isActive, setIsActive] = createSignal(false);
  const [cards, setCards] = createSignal<TranslationCard[]>([]);

  const MAX_CARDS = 6;
  /** How long a card stays on screen before fading out and being removed */
  const CARD_LIFETIME_MS = 30000;
  /** Must match the fade-out CSS transition on .translator-card.fading */
  const FADE_MS = 300;

  // Pending removal timers per card id. A card must never have two timers,
  // and a stale timer must never remove a re-added card with the same id.
  const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Generate unique ID for a word based on reading
  const generateCardId = (reading: string): string => {
    return `card_${btoa(encodeURIComponent(reading)).replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  const clearRemoveTimer = (cardId: string) => {
    const timer = removeTimers.get(cardId);
    if (timer) {
      clearTimeout(timer);
      removeTimers.delete(cardId);
    }
  };

  // After CARD_LIFETIME_MS the card fades out, then is removed from the DOM.
  const scheduleCardRemoval = (cardId: string) => {
    clearRemoveTimer(cardId);
    removeTimers.set(cardId, setTimeout(() => {
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, fading: true } : c)));
      removeTimers.set(cardId, setTimeout(() => {
        removeTimers.delete(cardId);
        setCards(prev => {
          // Guard: skip removal if the word was re-added (un-faded) during the fade
          const card = prev.find(c => c.id === cardId);
          if (!card?.fading) return prev;
          const next = prev.filter(c => c.id !== cardId);
          if (next.length === 0) setIsActive(false);
          return next;
        });
      }, FADE_MS));
    }, CARD_LIFETIME_MS));
  };

  // Add a translation card
  const addCard = (word: string, reading: string, translationDef?: string) => {
    const cardId = generateCardId(reading || word);

    // Already displaying this reading: restart its lifetime and cancel any pending fade
    const existing = cards().find(c => c.id === cardId);
    if (existing) {
      scheduleCardRemoval(cardId);
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, fading: false } : c)));
      setIsActive(true);
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
      fading: false,
    };

    // Dropping the oldest card must also cancel its removal timer
    if (cards().length >= MAX_CARDS) {
      clearRemoveTimer(cards()[cards().length - 1].id);
    }

    setCards(prev => {
      const updated = [newCard, ...prev];
      if (updated.length > MAX_CARDS) {
        return updated.slice(0, MAX_CARDS);
      }
      return updated;
    });

    scheduleCardRemoval(cardId);
    setIsActive(true);
  };

  // Remove a card
  const removeCard = (cardId: string) => {
    clearRemoveTimer(cardId);
    setCards(prev => {
      const next = prev.filter(c => c.id !== cardId);
      if (next.length === 0) setIsActive(false);
      return next;
    });
  };

  const clearAllCards = () => {
    for (const timer of removeTimers.values()) clearTimeout(timer);
    removeTimers.clear();
    setCards([]);
    setIsActive(false);
  };

  // Listen for IPC events to show aside
  createEffect(() => {
    const handleShowAside = () => {
      setIsActive(true);
      updateSetting('openAside', true);
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
        },
        hide: () => {
          clearAllCards();
          updateSetting('openAside', false);
        },
        isVisible: () => cards().length > 0,
      };
    }
  });

  onCleanup(() => {
    for (const timer of removeTimers.values()) clearTimeout(timer);
    removeTimers.clear();
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
      >
        {/* Header with close button */}
        <PanelHeader onClose={() => { clearAllCards(); updateSetting('openAside', false); }} />

        {/* Card container */}
        <div class="translator-cards-container">
          <For each={cards()}>
            {(card) => (
                <div class={`translator-card${card.fading ? ' fading' : ''}`} id={card.id}>
                  <SafeHtml tag="h1" class="translator-card-translation" html={card.translation} />
                  <SafeHtml tag="p" class="translator-card-reading" html={card.reading} />
                </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};

export default LiveWordTranslator;
