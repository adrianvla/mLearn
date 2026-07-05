/**
 * TTS Generate Modal
 * Modal dialog for regenerating flashcard content: word TTS, example TTS,
 * translation, and example phrase. Each option has its own toggle.
 * A single progress toast shows per-task status with spinners.
 */

import { Component, Show, createSignal, createMemo } from 'solid-js';
import { Modal, Btn, Select, VoiceSamplePicker, ToggleSwitch, TaskProgressContent, type TaskState, type TaskStatus } from '../common';
import { ConfirmDialog } from '../common/Modal/ConfirmDialog';
import { useSettings, useLocalization, useLanguage, useFlashcards, useLowPowerGate } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { resolveCloudApiUrl } from '../../../shared/backends';
import { stripHtmlForTts, getLanguageDisplayName } from '../../../shared/utils/textUtils';
import { showToast, updateToast, removeToast } from '../common/Feedback/Toast';
import { colorizeTokenizedText, textToReadingText } from '../../utils/languageTokenization';
import { withCloudAuth } from '../../services/cloudSessionManager';
import { DEFAULT_SETTINGS, type LanguageData, type TTSProvider } from '../../../shared/types';
import { getReadingAnnotationScripts } from '../../../shared/languageFeatures';
import { resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';
import { resolveTtsLanguageData } from './ttsLanguageData';
import './TtsGenerateModal.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.ttsGenerateModal");

export interface TtsGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardId: string;
  language?: string;
  languageData?: LanguageData | null;
  wordText: string;
  exampleText?: string;
  reading?: string;
  cardBack?: string;
  onGenerated?: () => void;
  onExampleGenerated?: (example: string, exampleMeaning: string) => void;
}

export const TtsGenerateModal: Component<TtsGenerateModalProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { langData, currentLangData } = useLanguage();
  const { generateExampleSentenceWithLLM, updateFlashcardContent, translateExampleSentence } = useFlashcards();
  const { requestAccess } = useLowPowerGate();

  const [provider, setProvider] = createSignal<TTSProvider>(settings.flashcardTtsProvider);
  const [voiceSampleId, setVoiceSampleId] = createSignal(settings.flashcardVoiceSampleId || DEFAULT_SETTINGS.flashcardVoiceSampleId!);

  // Task toggles
  const [doWordTts, setDoWordTts] = createSignal(true);
  const [doExampleTts, setDoExampleTts] = createSignal(!!props.exampleText);
  const [doTranslation, setDoTranslation] = createSignal(false);
  const [doExamplePhrase, setDoExamplePhrase] = createSignal(false);

  // Reading sub-toggles
  const [useReadingForWord, setUseReadingForWord] = createSignal(true);
  const [useReadingForExample, setUseReadingForExample] = createSignal(true);

  const [confirmOpen, setConfirmOpen] = createSignal(false);
  let confirmResolve: ((result: boolean) => void) | null = null;
  const cardLanguage = () => props.language || settings.language;
  const cardLanguageData = () => resolveTtsLanguageData(cardLanguage(), {
    explicitLanguageData: props.languageData,
    installedLanguageData: langData,
    activeLanguage: settings.language,
    activeLanguageData: currentLangData(),
  });

  const askContinueAfterLLMFailure = (): Promise<boolean> => {
    setConfirmOpen(true);
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  };

  const handleConfirmContinue = () => {
    setConfirmOpen(false);
    confirmResolve?.(true);
    confirmResolve = null;
  };

  const handleConfirmCancel = () => {
    setConfirmOpen(false);
    confirmResolve?.(false);
    confirmResolve = null;
  };

  const showReadingToggles = createMemo(() => {
    return getReadingAnnotationScripts(cardLanguageData()).length > 0;
  });

  const hasExample = createMemo(() => {
    const ex = stripHtmlForTts(props.exampleText || '', false, cardLanguageData());
    return !!ex && ex !== '-';
  });

  const hasAnySelected = createMemo(() =>
    doWordTts() || doExampleTts() || doTranslation() || doExamplePhrase()
  );

  const providerOptions = () => [
    { value: 'kokoro', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Kokoro') },
    { value: 'qwen3', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Qwen3') },
    { value: 'cloud', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Cloud') },
  ];

  const buildReadingText = async (text: string): Promise<string> => {
    // Strip all HTML and reading annotations to get the raw surface text
    const plainText = stripHtmlForTts(text, false, cardLanguageData());
    if (!plainText) return '';

    // Re-tokenize plain text so we can extract readings for each token
    return textToReadingText({
      text: plainText,
      language: cardLanguage(),
      languageData: cardLanguageData(),
      settings,
    });
  };

  const handleGenerate = async () => {
    if (!hasAnySelected()) return;

    const bridge = getBridge();
    const prov = provider();
    const sampleId = voiceSampleId() || undefined;
    const language = cardLanguage();
    const cloudApiUrl = resolveCloudApiUrl(settings);

    // Build task list
    const taskList: TaskState[] = [];
    if (doWordTts()) taskList.push({ key: 'wordTts', label: t('mlearn.CardEditor.Regenerate.WordTts'), status: 'pending' });
    if (doExampleTts() && hasExample()) taskList.push({ key: 'exampleTts', label: t('mlearn.CardEditor.Regenerate.ExampleTts'), status: 'pending' });
    if (doExamplePhrase() && props.cardBack) taskList.push({ key: 'examplePhrase', label: t('mlearn.CardEditor.Regenerate.ExamplePhrase'), status: 'pending' });
    if (doTranslation() && (hasExample() || doExamplePhrase())) taskList.push({ key: 'translation', label: t('mlearn.CardEditor.Regenerate.Translation'), status: 'pending' });

    if (taskList.length === 0) {
      return;
    }

    const [tasks, setTasks] = createSignal<TaskState[]>(taskList);
    const toastId = showToast({
      variant: 'info',
      title: t('mlearn.CardEditor.Regenerate.Title'),
      content: <TaskProgressContent tasks={tasks} />,
      duration: 0,
    });

    props.onClose();

    const updateTask = (key: string, status: TaskStatus) => {
      setTasks(prev => prev.map(tk => tk.key === key ? { ...tk, status } : tk));
      updateToast(toastId, {
        content: <TaskProgressContent tasks={tasks} />,
      });
    };

    let hadError = false;
    let latestExampleText = props.exampleText;
    let examplePhraseFailed = false;
    const skippedTasks = new Set<string>();

    if (taskList.some(t => t.key === 'examplePhrase')) {
      updateTask('examplePhrase', 'running');
      try {
        const result = await generateExampleSentenceWithLLM(props.wordText, props.cardBack!, language);
        if (result.sentence) {
          const languageData = cardLanguageData();
          const exampleHtml = await colorizeTokenizedText({
            text: result.sentence,
            language,
            languageData,
            settings,
            colourCodes: resolveFlashcardColourCodes(languageData, settings.colour_codes),
            targetWord: props.wordText,
          });
          updateFlashcardContent(props.cardId, {
            example: exampleHtml,
            exampleMeaning: result.meaning || undefined,
          });
          latestExampleText = exampleHtml;
          props.onExampleGenerated?.(exampleHtml, result.meaning || '');
          updateTask('examplePhrase', 'done');
        } else {
          updateTask('examplePhrase', 'error');
          hadError = true;
          examplePhraseFailed = true;
        }
      } catch (e) {
        log.error("error", e);
        updateTask('examplePhrase', 'error');
        hadError = true;
        examplePhraseFailed = true;
      }

      const hasExampleDependentTasks =
        taskList.some(t => t.key === 'exampleTts') ||
        taskList.some(t => t.key === 'translation');

      if (examplePhraseFailed && hasExampleDependentTasks) {
        const shouldContinue = await askContinueAfterLLMFailure();
        if (!shouldContinue) {
          taskList
            .filter(t => t.key === 'exampleTts' || t.key === 'translation')
            .forEach(t => {
              updateTask(t.key, 'error');
              skippedTasks.add(t.key);
            });
          hadError = true;

          if (!taskList.some(t => t.key === 'wordTts')) {
            removeToast(toastId);
            showToast({ message: t('mlearn.CardEditor.Regenerate.SomeFailed'), variant: 'warning' });
            props.onGenerated?.();
            return;
          }
        }
      }
    }

    if (taskList.some(t => t.key === 'wordTts')) {
      updateTask('wordTts', 'running');
      try {
        let wordForTts = props.wordText;
        if (useReadingForWord() && showReadingToggles() && props.reading) {
          wordForTts = props.reading;
        }
        const clean = stripHtmlForTts(wordForTts, false, cardLanguageData());
        if (clean && clean !== '-') {
          let wordGateAllowed = true;
          if (prov !== 'cloud') {
            wordGateAllowed = await requestAccess('tts');
          }
          if (!wordGateAllowed) {
            updateTask('wordTts', 'error');
            hadError = true;
          } else {
            const result = prov === 'cloud'
              ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(props.cardId, clean, language, 'word', prov, sampleId, cloudToken, cloudApiUrl))
              : await bridge.flashcards.generateFlashcardTts(props.cardId, clean, language, 'word', prov, sampleId, undefined, cloudApiUrl);
              if (result) {
                updateTask('wordTts', 'done');
              } else {
                updateTask('wordTts', 'error');
                hadError = true;
              }
          }
        } else {
          updateTask('wordTts', 'done');
        }
      } catch (e) {
        log.error("error", e);
        updateTask('wordTts', 'error');
        hadError = true;
      }
    }

    if (taskList.some(t => t.key === 'exampleTts') && !skippedTasks.has('exampleTts')) {
      updateTask('exampleTts', 'running');
      try {
        const exText = latestExampleText || props.exampleText || '';
        let textForTts: string;
        if (useReadingForExample() && showReadingToggles()) {
          textForTts = await buildReadingText(exText);
        } else {
          textForTts = stripHtmlForTts(exText, false, cardLanguageData());
        }
        if (textForTts && textForTts !== '-') {
          let exGateAllowed = true;
          if (prov !== 'cloud') {
            exGateAllowed = await requestAccess('tts');
          }
          if (!exGateAllowed) {
            updateTask('exampleTts', 'error');
            hadError = true;
          } else {
            const result = prov === 'cloud'
              ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(props.cardId, textForTts, language, 'example', prov, sampleId, cloudToken, cloudApiUrl))
              : await bridge.flashcards.generateFlashcardTts(props.cardId, textForTts, language, 'example', prov, sampleId, undefined, cloudApiUrl);
              if (result) {
                updateTask('exampleTts', 'done');
              } else {
                updateTask('exampleTts', 'error');
                hadError = true;
              }
          }
        } else {
          updateTask('exampleTts', 'done');
        }
      } catch (e) {
        log.error("error", e);
        updateTask('exampleTts', 'error');
        hadError = true;
      }
    }

    if (taskList.some(t => t.key === 'translation') && !skippedTasks.has('translation')) {
      updateTask('translation', 'running');
      try {
        const exText = latestExampleText || props.exampleText || '';
        const plain = stripHtmlForTts(exText, false, cardLanguageData());
        if (plain && plain !== '-') {
          const sourceLangName = getLanguageDisplayName(
            language,
            cardLanguageData(),
            settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage,
          );
          const translated = await translateExampleSentence(plain, sourceLangName, language);
          if (translated) {
            updateFlashcardContent(props.cardId, { exampleMeaning: translated });
          }
        }
        updateTask('translation', 'done');
      } catch (e) {
        log.error("error", e);
        updateTask('translation', 'error');
        hadError = true;
      }
    }

    // Persist TTS provider/voice settings if we did any TTS
    if (doWordTts() || doExampleTts()) {
      updateSettings({
        flashcardTtsProvider: prov,
        flashcardVoiceSampleId: sampleId || '',
      });
    }

    // Final toast state
    removeToast(toastId);
    if (hadError) {
      showToast({ message: t('mlearn.CardEditor.Regenerate.SomeFailed'), variant: 'warning' });
    } else {
      showToast({ message: t('mlearn.CardEditor.Regenerate.AllCompleted'), variant: 'success' });
    }

    props.onGenerated?.();
  };

  return (
    <>
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.CardEditor.Regenerate.Title')}
      size="md"
      footer={
        <>
          <Btn onClick={props.onClose}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={handleGenerate} disabled={!hasAnySelected()}>
            {t('mlearn.CardEditor.GenerateTtsAction')}
          </Btn>
        </>
      }
    >
      <div class="tts-generate-modal-body">
        {/* TTS Provider */}
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

        <div class="tts-generate-separator" />

        {/* Word TTS toggle */}
        <div class="tts-generate-task">
          <ToggleSwitch
            checked={doWordTts()}
            onChange={setDoWordTts}
            label={t('mlearn.CardEditor.Regenerate.WordTts')}
          />
          <Show when={doWordTts() && showReadingToggles() && props.reading}>
            <div class="tts-generate-sub-option">
              <ToggleSwitch
                checked={useReadingForWord()}
                onChange={setUseReadingForWord}
                label={t('mlearn.CardEditor.Regenerate.UseReadings')}
              />
            </div>
          </Show>
        </div>

        {/* Example TTS toggle */}
        <Show when={hasExample()}>
          <div class="tts-generate-task">
            <ToggleSwitch
              checked={doExampleTts()}
              onChange={setDoExampleTts}
              label={t('mlearn.CardEditor.Regenerate.ExampleTts')}
            />
            <Show when={doExampleTts() && showReadingToggles()}>
              <div class="tts-generate-sub-option">
                <ToggleSwitch
                  checked={useReadingForExample()}
                  onChange={setUseReadingForExample}
                  label={t('mlearn.CardEditor.Regenerate.UseReadings')}
                />
              </div>
            </Show>
          </div>
        </Show>

        {/* Translation toggle */}
        <Show when={hasExample() || props.cardBack}>
          <div class="tts-generate-task">
            <ToggleSwitch
              checked={doTranslation()}
              onChange={setDoTranslation}
              label={t('mlearn.CardEditor.Regenerate.Translation')}
            />
          </div>
        </Show>

        {/* Example Phrase toggle */}
        <Show when={props.cardBack}>
          <div class="tts-generate-task">
            <ToggleSwitch
              checked={doExamplePhrase()}
              onChange={setDoExamplePhrase}
              label={t('mlearn.CardEditor.Regenerate.ExamplePhrase')}
            />
          </div>
        </Show>
      </div>
    </Modal>
    <ConfirmDialog
      isOpen={confirmOpen()}
      onClose={handleConfirmCancel}
      onConfirm={handleConfirmContinue}
      title={t('mlearn.CardEditor.Regenerate.LLMFailedTitle')}
      message={t('mlearn.CardEditor.Regenerate.LLMFailedContinue')}
      variant="warning"
      confirmText={t('mlearn.CardEditor.Regenerate.LLMFailedYes')}
      cancelText={t('mlearn.CardEditor.Regenerate.LLMFailedNo')}
    />
    </>
  );
};
