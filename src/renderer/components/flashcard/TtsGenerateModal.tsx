/**
 * TTS Generate Modal
 * Modal dialog for regenerating flashcard content: word TTS, example TTS,
 * translation, and example phrase. Each option has its own toggle.
 * A single progress toast shows per-task status with spinners.
 */

import { Component, Show, createSignal, createMemo, For, JSX } from 'solid-js';
import { Modal, Btn, Select, VoiceSamplePicker, ToggleSwitch, Spinner } from '../common';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { getBackend } from '../../../shared/backends';
import { showToast, updateToast, removeToast } from '../common/Feedback/Toast';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import type { TTSProvider } from '../../../shared/types';
import './TtsGenerateModal.css';

export interface TtsGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardId: string;
  wordText: string;
  exampleText?: string;
  reading?: string;
  cardBack?: string;
  onGenerated?: () => void;
  onExampleGenerated?: (example: string, exampleMeaning: string) => void;
}

type TaskStatus = 'pending' | 'running' | 'done' | 'error';

interface TaskState {
  key: string;
  label: string;
  status: TaskStatus;
}

const TaskCheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <polyline points="3 8 7 12 13 4" />
  </svg>
);

const TaskErrorIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <line x1="4" y1="4" x2="12" y2="12" />
    <line x1="12" y1="4" x2="4" y2="12" />
  </svg>
);

function TaskProgressContent(props: { tasks: () => TaskState[] }): JSX.Element {
  return (
    <div class="tts-task-progress">
      <For each={props.tasks()}>
        {(task) => (
          <div class="tts-task-row">
            <span class="tts-task-status">
              {task.status === 'running' && <Spinner size={14} />}
              {task.status === 'done' && <span class="tts-task-check"><TaskCheckIcon /></span>}
              {task.status === 'error' && <span class="tts-task-error"><TaskErrorIcon /></span>}
              {task.status === 'pending' && <span class="tts-task-pending" />}
            </span>
            <span class="tts-task-label">{task.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}

export const TtsGenerateModal: Component<TtsGenerateModalProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { getLanguageFeatures } = useLanguage();
  const { generateExampleSentenceWithLLM, updateFlashcardContent, translateExampleSentence } = useFlashcards();

  const [provider, setProvider] = createSignal<TTSProvider>(settings.flashcardTtsProvider);
  const [voiceSampleId, setVoiceSampleId] = createSignal(settings.flashcardVoiceSampleId || '');
  const [generating, setGenerating] = createSignal(false);

  // Task toggles
  const [doWordTts, setDoWordTts] = createSignal(true);
  const [doExampleTts, setDoExampleTts] = createSignal(!!props.exampleText);
  const [doTranslation, setDoTranslation] = createSignal(false);
  const [doExamplePhrase, setDoExamplePhrase] = createSignal(false);

  // Reading sub-toggles
  const [useReadingForWord, setUseReadingForWord] = createSignal(true);
  const [useReadingForExample, setUseReadingForExample] = createSignal(true);

  const showReadingToggles = createMemo(() => {
    const features = getLanguageFeatures();
    return features.supportsReadings;
  });

  const hasExample = createMemo(() => {
    const ex = props.exampleText?.replace(/<[^>]*>/g, '').trim();
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
    const plain = text.replace(/<[^>]*>/g, '').trim();
    if (!plain) return text;
    try {
      const backend = getBackend({
        mode: settings.backendMode,
        url: settings.backendUrl,
        authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
      });
      const tokens = await backend.tokenize(plain, settings.language);
      if (tokens.length > 0) {
        return tokens.map(tok => tok.reading || tok.word).join('');
      }
    } catch { /* fall through to original */ }
    return plain;
  };

  const handleGenerate = async () => {
    if (generating() || !hasAnySelected()) return;
    setGenerating(true);

    const bridge = getBridge();
    const prov = provider();
    const sampleId = voiceSampleId() || undefined;
    const language = settings.language;
    const cloudAuthToken = settings.cloudAuthAccessToken || undefined;
    const cloudApiUrl = settings.cloudApiUrl || undefined;

    // Build task list
    const taskList: TaskState[] = [];
    if (doWordTts()) taskList.push({ key: 'wordTts', label: t('mlearn.CardEditor.Regenerate.WordTts'), status: 'pending' });
    if (doExampleTts() && hasExample()) taskList.push({ key: 'exampleTts', label: t('mlearn.CardEditor.Regenerate.ExampleTts'), status: 'pending' });
    if (doExamplePhrase() && props.cardBack) taskList.push({ key: 'examplePhrase', label: t('mlearn.CardEditor.Regenerate.ExamplePhrase'), status: 'pending' });
    if (doTranslation() && (hasExample() || doExamplePhrase())) taskList.push({ key: 'translation', label: t('mlearn.CardEditor.Regenerate.Translation'), status: 'pending' });

    if (taskList.length === 0) {
      setGenerating(false);
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

    // Run tasks sequentially (some depend on prior results)
    // 1. Example phrase (generates new example, needed before example TTS/translation)
    if (taskList.some(t => t.key === 'examplePhrase')) {
      updateTask('examplePhrase', 'running');
      try {
        const result = await generateExampleSentenceWithLLM(props.wordText, props.cardBack!, language);
        if (result.sentence) {
          let exampleHtml = result.sentence;
          try {
            const backend = getBackend({
              mode: settings.backendMode,
              url: settings.backendUrl,
              authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
            });
            const tokens = await backend.tokenize(result.sentence, language);
            if (tokens.length > 0) {
              exampleHtml = tokensToColoredHtml(tokens, settings.colour_codes || {}, props.wordText);
            }
          } catch { /* use plain text */ }
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
        }
      } catch {
        updateTask('examplePhrase', 'error');
        hadError = true;
      }
    }

    // 2. Word TTS
    if (taskList.some(t => t.key === 'wordTts')) {
      updateTask('wordTts', 'running');
      try {
        let wordForTts = props.wordText;
        if (useReadingForWord() && showReadingToggles() && props.reading) {
          wordForTts = props.reading;
        }
        const clean = wordForTts.replace(/<[^>]*>/g, '');
        if (clean && clean !== '-') {
          await bridge.flashcards.generateFlashcardTts(props.cardId, clean, language, 'word', prov, sampleId, cloudAuthToken, cloudApiUrl);
        }
        updateTask('wordTts', 'done');
      } catch {
        updateTask('wordTts', 'error');
        hadError = true;
      }
    }

    // 3. Example TTS
    if (taskList.some(t => t.key === 'exampleTts')) {
      updateTask('exampleTts', 'running');
      try {
        const exText = latestExampleText || props.exampleText || '';
        let textForTts = exText.replace(/<[^>]*>/g, '').trim();
        if (useReadingForExample() && showReadingToggles() && textForTts) {
          textForTts = await buildReadingText(textForTts);
        }
        if (textForTts && textForTts !== '-') {
          await bridge.flashcards.generateFlashcardTts(props.cardId, textForTts, language, 'example', prov, sampleId, cloudAuthToken, cloudApiUrl);
        }
        updateTask('exampleTts', 'done');
      } catch {
        updateTask('exampleTts', 'error');
        hadError = true;
      }
    }

    // 4. Translation
    if (taskList.some(t => t.key === 'translation')) {
      updateTask('translation', 'running');
      try {
        const exText = latestExampleText || props.exampleText || '';
        const plain = exText.replace(/<[^>]*>/g, '').trim();
        if (plain && plain !== '-') {
          const langDisplayMap: Record<string, string> = {
            en: 'English', de: 'German', fr: 'French', ja: 'Japanese', ru: 'Russian',
            zh: 'Chinese', ko: 'Korean', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
          };
          const sourceLangName = langDisplayMap[language] || language;
          const translated = await translateExampleSentence(plain, sourceLangName);
          if (translated) {
            updateFlashcardContent(props.cardId, { exampleMeaning: translated });
          }
        }
        updateTask('translation', 'done');
      } catch {
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
    setGenerating(false);
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.CardEditor.Regenerate.Title')}
      size="md"
      footer={
        <>
          <Btn onClick={props.onClose} disabled={generating()}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={handleGenerate} loading={generating()} disabled={!hasAnySelected()}>
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
  );
};
