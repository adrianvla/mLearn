/**
 * useFlashcardTts Hook
 * Provides TTS playback for flashcard words and examples.
 * Uses pre-generated .ogg files when available, falls back to Kokoro/remote generation.
 */

import { createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import { useSettings } from '../context';
import { isElectron } from '../../shared/platform';

interface FlashcardTtsState {
  isPlaying: boolean;
  isGenerating: boolean;
}

export function useFlashcardTts() {
  const { settings } = useSettings();
  const [state, setState] = createSignal<FlashcardTtsState>({
    isPlaying: false,
    isGenerating: false,
  });

  let currentAudio: HTMLAudioElement | null = null;

  /** Stop any currently playing audio */
  const stop = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    setState({ isPlaying: false, isGenerating: false });
  };

  /** Play an audio URL */
  const playUrl = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      stop();
      const audio = new Audio(url);
      currentAudio = audio;
      setState((s) => ({ ...s, isPlaying: true }));

      audio.onended = () => {
        setState((s) => ({ ...s, isPlaying: false }));
        currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        setState((s) => ({ ...s, isPlaying: false }));
        currentAudio = null;
        reject(new Error('Audio playback failed'));
      };

      audio.play().catch(reject);
    });
  };

  /**
   * Play TTS for a flashcard field.
   * 1. Check for existing .ogg file
   * 2. If not found, generate via configured provider
   * 3. Falls back to system TTS if generation fails
   */
  const playTts = async (
    cardId: string,
    text: string,
    language: string,
    field: 'word' | 'example',
  ) => {
    if (!text || text === '-' || state().isPlaying) return;

    // Strip HTML tags from text for TTS
    const cleanText = text.replace(/<[^>]*>/g, '');
    if (!cleanText.trim()) return;

    const bridge = getBridge();

    if (isElectron()) {
      // Try existing audio file first
      const existingUrl = await bridge.flashcards.getFlashcardTts(cardId, field);
      if (existingUrl) {
        try {
          await playUrl(existingUrl);
          return;
        } catch {
          // File might be corrupted, try regenerating
        }
      }

      // Generate via configured provider
      setState((s) => ({ ...s, isGenerating: true }));
      const provider = settings.flashcardTtsProvider;
      const remoteUrl = settings.flashcardRemoteTtsUrl || undefined;
      const generatedUrl = await bridge.flashcards.generateFlashcardTts(
        cardId,
        cleanText,
        language,
        field,
        provider,
        remoteUrl,
      );
      setState((s) => ({ ...s, isGenerating: false }));

      if (generatedUrl) {
        try {
          await playUrl(generatedUrl);
          return;
        } catch {
          // Fall through to system TTS
        }
      }
    }

    // Fallback: system TTS (works on all platforms)
    bridge.speech.ttsSpeak(cleanText, language);
  };

  onCleanup(() => {
    stop();
  });

  return {
    state,
    playTts,
    stop,
    isPlaying: () => state().isPlaying,
    isGenerating: () => state().isGenerating,
  };
}
