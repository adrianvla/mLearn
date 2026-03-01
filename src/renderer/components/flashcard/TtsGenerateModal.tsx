/**
 * TTS Generate Modal
 * Modal dialog for regenerating TTS audio with provider/voice selection,
 * optional reading-based TTS, and LLM example sentence regeneration.
 * Used by FlashcardReview and FlashcardEditor.
 */

import { Component, Show, createSignal, createMemo } from 'solid-js';
import { Modal, Btn, Select, Spinner, VoiceSamplePicker, ToggleSwitch } from '../common';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { getBackend } from '../../../shared/backends';
import { showToast } from '../common/Feedback/Toast';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import type { TTSProvider } from '../../../shared/types';
import './TtsGenerateModal.css';

export interface TtsGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Card ID to regenerate TTS for */
  cardId: string;
  /** Word text (front of card) */
  wordText: string;
  /** Example text (if any) */
  exampleText?: string;
  /** Reading text (furigana/pinyin) for the word */
  reading?: string;
  /** Back of card (definition) — needed for example regeneration */
  cardBack?: string;
  /** Called after TTS is regenerated successfully */
  onGenerated?: () => void;
  /** Called after example sentence is regenerated via LLM */
  onExampleGenerated?: (example: string, exampleMeaning: string) => void;
}

export const TtsGenerateModal: Component<TtsGenerateModalProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { getLanguageFeatures } = useLanguage();
  const { generateExampleSentenceWithLLM, updateFlashcardContent } = useFlashcards();

  const [provider, setProvider] = createSignal<TTSProvider>(settings.flashcardTtsProvider);
  const [voiceSampleId, setVoiceSampleId] = createSignal(settings.flashcardVoiceSampleId || '');
  const [generating, setGenerating] = createSignal(false);
  const [useReadingForTts, setUseReadingForTts] = createSignal(true);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);

  const showReadingToggle = createMemo(() => {
    const features = getLanguageFeatures();
    return features.supportsReadings && !!props.reading;
  });

  const providerOptions = () => [
    { value: 'kokoro', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Kokoro') },
    { value: 'qwen3', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Qwen3') },
    { value: 'cloud', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Cloud') },
  ];

  const handleGenerate = async () => {
    if (generating()) return;
    setGenerating(true);

    const bridge = getBridge();
    const prov = provider();
    const sampleId = voiceSampleId() || undefined;
    const language = settings.language;
    const cloudAuthToken = settings.cloudAuthAccessToken || undefined;
    const cloudApiUrl = settings.cloudApiUrl || undefined;

    try {
      const wordForTts = (useReadingForTts() && props.reading) ? props.reading : props.wordText;
      const clean = wordForTts.replace(/<[^>]*>/g, '');
      if (clean && clean !== '-') {
        await bridge.flashcards.generateFlashcardTts(props.cardId, clean, language, 'word', prov, sampleId, cloudAuthToken, cloudApiUrl);
      }
      if (props.exampleText) {
        const cleanEx = props.exampleText.replace(/<[^>]*>/g, '');
        if (cleanEx && cleanEx !== '-') {
          await bridge.flashcards.generateFlashcardTts(props.cardId, cleanEx, language, 'example', prov, sampleId, cloudAuthToken, cloudApiUrl);
        }
      }

      // Persist the chosen provider and voice sample as new defaults
      updateSettings({
        flashcardTtsProvider: prov,
        flashcardVoiceSampleId: sampleId || '',
      });

      showToast({ message: t('mlearn.CardEditor.TtsGenerated'), variant: 'success' });
      props.onGenerated?.();
      props.onClose();
    } catch {
      showToast({ message: t('mlearn.CardEditor.TtsGenerateFailed'), variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateExample = async () => {
    if (regeneratingExample() || !props.cardBack) return;
    setRegeneratingExample(true);
    try {
      const result = await generateExampleSentenceWithLLM(props.wordText, props.cardBack, settings.language);
      if (result.sentence) {
        let exampleHtml = result.sentence;
        try {
          const backend = getBackend({
            mode: settings.backendMode,
            url: settings.backendUrl,
            authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
          });
          const tokens = await backend.tokenize(result.sentence, settings.language);
          if (tokens.length > 0) {
            exampleHtml = tokensToColoredHtml(tokens, settings.colour_codes || {}, props.wordText);
          }
        } catch {
          // Use plain text if tokenization fails
        }
        updateFlashcardContent(props.cardId, {
          example: exampleHtml,
          exampleMeaning: result.meaning || undefined,
        });
        props.onExampleGenerated?.(exampleHtml, result.meaning || '');
        showToast({ message: t('mlearn.CardEditor.RegenerateExample'), variant: 'success' });
      }
    } catch (e) {
      console.warn('Failed to regenerate example:', e);
      showToast({ message: t('mlearn.CardEditor.ExampleGenerateFailed'), variant: 'error' });
    } finally {
      setRegeneratingExample(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.CardEditor.RegenerateTts')}
      size="md"
      footer={
        <>
          <Btn onClick={props.onClose} disabled={generating()}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={handleGenerate} disabled={generating()}>
            <Show when={generating()} fallback={t('mlearn.CardEditor.GenerateTtsAction')}>
              <Spinner size={16} />
              <span>{t('mlearn.CardEditor.GeneratingTts')}</span>
            </Show>
          </Btn>
        </>
      }
    >
      <div class="tts-generate-modal-body">
        <div class="tts-generate-option">
          <label class="tts-generate-label">{t('mlearn.AI.Settings.FlashcardTTS.Provider.Label')}</label>
          <Select
            options={providerOptions()}
            value={provider()}
            onChange={(e) => setProvider(e.currentTarget.value as TTSProvider)}
          />
        </div>

        <Show when={provider() !== 'kokoro'}>
          <div class="tts-generate-option">
            <label class="tts-generate-label">{t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Label')}</label>
            <VoiceSamplePicker
              value={voiceSampleId()}
              onChange={setVoiceSampleId}
              ttsProvider={provider()}
            />
          </div>
        </Show>

        <Show when={provider() === 'cloud' && !settings.cloudAuthAccessToken}>
          <p class="tts-generate-warning">{t('mlearn.CardEditor.NoCloudAuth')}</p>
        </Show>

        <Show when={showReadingToggle()}>
          <div class="tts-generate-option">
            <ToggleSwitch
              checked={useReadingForTts()}
              onChange={setUseReadingForTts}
              label={t('mlearn.CardEditor.UseReadingForTts')}
            />
          </div>
        </Show>

        <Show when={props.cardBack}>
          <div class="tts-generate-separator" />
          <div class="tts-generate-option">
            <Btn
              variant="secondary"
              onClick={handleRegenerateExample}
              disabled={regeneratingExample()}
            >
              <Show when={regeneratingExample()} fallback={t('mlearn.CardEditor.RegenerateExample')}>
                <Spinner size={16} />
                <span>{t('mlearn.CardEditor.RegeneratingExample')}</span>
              </Show>
            </Btn>
          </div>
        </Show>
      </div>
    </Modal>
  );
};
