/**
 * useFlashcardTts Hook
 * Provides TTS playback for flashcard words and examples.
 * Uses pre-generated .ogg files when available, falls back to Kokoro/remote generation.
 */

import { createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import { useLanguage, useLocalization, useSettings } from '../context';
import { isElectron } from '../../shared/platform';
import { stripReadingAnnotations } from '../../shared/utils/textUtils';
import { showToast } from '../components/common/Feedback/Toast';
import { resolveTtsLanguageData } from '../utils/ttsLanguageData';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.hooks.useFlashcardTts");

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

export interface TtsPlaybackOptions {
  /** Automatic playback should not interrupt review when a recording is absent. */
  silentIfMissing?: boolean;
  /** Called only after audio playback starts, for retrieval cue attribution. */
  onStarted?: () => void;
}

export function useFlashcardTts() {
  const { t } = useLocalization();
  const { langData, currentLangData } = useLanguage();
  const { settings } = useSettings();
  const [state, setState] = createSignal<FlashcardTtsState>({
    isPlaying: false,
    isGenerating: false,
    playingField: null,
  });
  const [metadata, setMetadata] = createSignal<TtsMetadata | null>(null);

  let currentAudio: HTMLAudioElement | null = null;
  /** Per-instance generation counter to detect stale async results */
  let generationId = 0;

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
  const playUrl = (url: string, myGenId: number, onStarted?: () => void): Promise<void> => {
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

      audio.play().then(() => {
        if (myGenId === generationId && currentAudio === audio) onStarted?.();
      }).catch(reject);
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
    options?: TtsPlaybackOptions,
  ) => {
    // Always stop previous audio — never skip because something is playing
    stop();
    if (!text || text === '-') return;

    // Set the field we're about to play so the UI can highlight the correct button
    setState((s) => ({ ...s, playingField: field }));

    const languageData = resolveTtsLanguageData(language, {
      installedLanguageData: langData,
      activeLanguage: settings.language,
      activeLanguageData: currentLangData(),
    });
    const cleanText = stripReadingAnnotations(text, languageData);
    if (!cleanText.trim()) {
      setState({ isPlaying: false, isGenerating: false, playingField: null });
      return;
    }

    const myGenId = generationId;
    const bridge = getBridge();

    try {
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
            await playUrl(existingUrl + '?t=' + Date.now(), myGenId, options?.onStarted);
            return;
          } catch (e) {
            log.error("error", e);
            if (myGenId !== generationId) return;
          }
        }

        // No saved audio — notify the user to regenerate
        if (myGenId === generationId) {
          const fieldLabel = field === 'word'
            ? t('mlearn.Flashcards.PostCreate.WordTts')
            : t('mlearn.Flashcards.PostCreate.ExampleTts');
          if (!options?.silentIfMissing) showToast({ message: t('mlearn.CardEditor.TtsMissing', { field: fieldLabel }), variant: 'warning' });
          setState({ isPlaying: false, isGenerating: false, playingField: null });
        }
        return;
      }

      // Fallback: system TTS (works on all platforms)
      if (myGenId === generationId) {
        const ttsRuntime = languageData?.runtime?.tts;
        bridge.speech.ttsSpeak(cleanText, language, {
          speechSynthesisLang: ttsRuntime?.webSpeechLang,
          speechSynthesisVoice: ttsRuntime?.webSpeechVoice,
        });
        options?.onStarted?.();
        // System TTS is fire-and-forget; update state optimistically
        setState({ isPlaying: false, isGenerating: false, playingField: null });
      }
    } catch (e) {
      log.error("error", e);
      // Ensure state is always reset on any error to prevent stuck buttons
      if (myGenId === generationId) {
        setState({ isPlaying: false, isGenerating: false, playingField: null });
      }
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
