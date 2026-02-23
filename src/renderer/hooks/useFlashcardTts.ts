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
  playingField: 'word' | 'example' | null;
}

export interface TtsMetadata {
  provider: string;
  generatedAt: string;
  language: string;
}

/** Monotonically increasing generation counter to detect stale async results */
let generationId = 0;

export function useFlashcardTts() {
  const { settings } = useSettings();
  const [state, setState] = createSignal<FlashcardTtsState>({
    isPlaying: false,
    isGenerating: false,
    playingField: null,
  });
  const [metadata, setMetadata] = createSignal<TtsMetadata | null>(null);

  let currentAudio: HTMLAudioElement | null = null;

  /** Stop any currently playing audio and cancel pending generation */
  const stop = () => {
    // Bump generation so any in-flight async work becomes stale
    generationId++;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio = null;
    }
    setState({ isPlaying: false, isGenerating: false, playingField: null });
  };

  /** Play an audio URL. Resolves when playback finishes. */
  const playUrl = (url: string, myGenId: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (myGenId !== generationId) { resolve(); return; }

      // Stop previous audio without bumping generationId
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio = null;
      }

      const audio = new Audio(url);
      currentAudio = audio;
      setState((s) => ({ ...s, isPlaying: true }));

      audio.onended = () => {
        if (currentAudio === audio) {
          setState((s) => ({ ...s, isPlaying: false, playingField: null }));
          currentAudio = null;
        }
        resolve();
      };

      audio.onerror = () => {
        if (currentAudio === audio) {
          setState((s) => ({ ...s, isPlaying: false, playingField: null }));
          currentAudio = null;
        }
        reject(new Error('Audio playback failed'));
      };

      audio.play().catch(reject);
    });
  };

  /**
   * Play TTS for a flashcard field.
   * Stops any currently playing audio first, then:
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
    // Always stop previous audio — never skip because something is playing
    stop();
    // Set the field we're about to play so the UI can highlight the correct button
    setState((s) => ({ ...s, playingField: field }));

    if (!text || text === '-') return;

    // Strip HTML tags from text for TTS
    const cleanText = text.replace(/<[^>]*>/g, '');
    if (!cleanText.trim()) return;

    const myGenId = generationId;
    const bridge = getBridge();

    if (isElectron()) {
      // Try existing audio file first
      const existingUrl = await bridge.flashcards.getFlashcardTts(cardId, field);
      if (myGenId !== generationId) return; // Stale

      if (existingUrl) {
        try {
          // Load metadata in parallel with starting playback
          bridge.flashcards.getFlashcardTtsMeta(cardId, field).then(m => {
            if (m && myGenId === generationId) setMetadata(m);
          });
          // Append cache-buster to avoid stale audio after regeneration
          await playUrl(existingUrl + '?t=' + Date.now(), myGenId);
          return;
        } catch {
          if (myGenId !== generationId) return;
        }
      }

      // Generate via configured provider
      setState((s) => ({ ...s, isGenerating: true }));
      if (myGenId !== generationId) return;

      const provider = settings.flashcardTtsProvider;
      const remoteUrl = settings.flashcardRemoteTtsUrl || undefined;
      const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
      const generatedUrl = await bridge.flashcards.generateFlashcardTts(
        cardId,
        cleanText,
        language,
        field,
        provider,
        remoteUrl,
        voiceSampleId,
      );
      if (myGenId !== generationId) { setState((s) => ({ ...s, isGenerating: false })); return; }
      setState((s) => ({ ...s, isGenerating: false }));

      if (generatedUrl) {
        try {
          bridge.flashcards.getFlashcardTtsMeta(cardId, field).then(m => {
            if (m && myGenId === generationId) setMetadata(m);
          });
          await playUrl(generatedUrl + '?t=' + Date.now(), myGenId);
          return;
        } catch {
          if (myGenId !== generationId) return;
        }
      }
    }

    // Fallback: system TTS (works on all platforms)
    if (myGenId === generationId) {
      bridge.speech.ttsSpeak(cleanText, language);
    }
  };

  onCleanup(() => {
    stop();
  });

  return {
    state,
    playTts,
    stop,
    metadata,
    isPlaying: () => state().isPlaying,
    isGenerating: () => state().isGenerating,
    playingField: () => state().playingField,
  };
}
