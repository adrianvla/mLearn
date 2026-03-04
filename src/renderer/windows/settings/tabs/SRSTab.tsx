/**
 * SRS Settings Tab
 */

import { Component, createSignal, Show, For, createMemo, createEffect, on } from 'solid-js';
import { useSettings, useLocalization, useFlashcards, useLanguage } from '../../../context';
import {
  SettingRow,
  SettingGroup,
  ToggleSwitch,
  TabContent,
  Btn,
  Select,
  Input,
  Modal,
  ModalFooter,
  VoiceSamplePicker
} from '../../../components/common';
import { showToast } from '../../../components/common/Feedback/Toast';
import { useAnki, type AnkiNoteInfo } from '../../../hooks/useAnki';
import '../SettingsForm.css';
import './AnkiFieldPreview.css';
import Icon from "@renderer/components/common/Icons/Icon";
import type {TTSProvider} from "@shared/types";

export const SRSTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { store, updateMeta, resetSRS, nukeAllFlashcards } = useFlashcards();
  const { getFreqLevelNames, getLanguageFeatures } = useLanguage();
  const anki = useAnki();
  const [ankiStatus, setAnkiStatus] = createSignal<'unchecked' | 'connected' | 'error'>('unchecked');

  // Anki metadata fetched from AnkiConnect
  const [ankiDecks, setAnkiDecks] = createSignal<string[]>([]);
  const [ankiModels, setAnkiModels] = createSignal<string[]>([]);
  const [ankiFields, setAnkiFields] = createSignal<string[]>([]);
  const [sampleNote, setSampleNote] = createSignal<AnkiNoteInfo | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);

  // SRS reset modal state
  const [showResetModal, setShowResetModal] = createSignal(false);
  const [resetConfirmPhrase, setResetConfirmPhrase] = createSignal('');

  // Nuke all flashcards modal state
  const [showNukeModal, setShowNukeModal] = createSignal(false);
  const [nukeConfirmPhrase, setNukeConfirmPhrase] = createSignal('');

  const RESET_PHRASE = 'RESET';
  const NUKE_PHRASE = 'DELETE';
  const canConfirmReset = () => resetConfirmPhrase().trim().toUpperCase() === RESET_PHRASE;
  const canConfirmNuke = () => nukeConfirmPhrase().trim().toUpperCase() === NUKE_PHRASE;

  const handleResetSRS = () => {
    if (!canConfirmReset()) return;
    resetSRS();
    setShowResetModal(false);
    setResetConfirmPhrase('');
    showToast({ message: t('mlearn.Settings.SRS.DataManagement.ResetSRS.Success'), variant: 'success' });
  };

  const handleNukeFlashcards = () => {
    if (!canConfirmNuke()) return;
    nukeAllFlashcards();
    setShowNukeModal(false);
    setNukeConfirmPhrase('');
    showToast({ message: t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Success'), variant: 'success' });
  };

  const freqLevels = createMemo(() => {
    const names = getFreqLevelNames();
    return Object.entries(names).sort((a, b) => Number(b[0]) - Number(a[0]));
  });

  const hasFreqLevels = createMemo(() => getLanguageFeatures().supportsFrequencyLevels);

  const checkAnkiConnection = async () => {
    const connected = await anki.checkConnection();
    if (connected) {
      setAnkiStatus('connected');
      // Fetch decks, models upon successful connection
      const [fetchedDecks, fetchedModels] = await Promise.all([
        anki.fetchDecks(),
        anki.fetchModels(),
      ]);
      setAnkiDecks(fetchedDecks);
      setAnkiModels(fetchedModels);
      // If a model is already selected, fetch its fields
      const currentModel = settings.anki_model_name;
      if (currentModel && fetchedModels.includes(currentModel)) {
        const fields = await anki.getModelFields(currentModel);
        setAnkiFields(fields);
        loadSampleNote(currentModel);
      }
    } else {
      setAnkiStatus('error');
    }
  };

  const handleModelChange = async (modelName: string) => {
    updateSettings({ anki_model_name: modelName });
    if (modelName) {
      const fields = await anki.getModelFields(modelName);
      setAnkiFields(fields);
      // Reset field mappings if the current ones don't exist in the new model
      if (!fields.includes(settings.anki_field_expression)) {
        updateSettings({ anki_field_expression: fields[0] || 'Expression' });
      }
      if (!fields.includes(settings.anki_field_reading)) {
        updateSettings({ anki_field_reading: '' });
      }
      if (!fields.includes(settings.anki_field_meaning)) {
        updateSettings({ anki_field_meaning: fields.length > 1 ? fields[1] : '' });
      }
      loadSampleNote(modelName);
    } else {
      setAnkiFields([]);
      setSampleNote(null);
    }
  };

  const loadSampleNote = async (modelName: string) => {
    setPreviewLoading(true);
    const note = await anki.fetchSampleNote(modelName);
    setSampleNote(note);
    setPreviewLoading(false);
  };

  // Auto-connect when Anki is enabled
  createEffect(on(() => settings.use_anki, (enabled) => {
    if (enabled && ankiStatus() === 'unchecked') {
      checkAnkiConnection();
    }
  }));

  // Parse input value for limit settings
  const parseLimitInput = (value: string): number => {
    const parsed = parseInt(value);
    if (isNaN(parsed) || parsed < -1) return -1;
    return parsed;
  };

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.SRS.Title'),
        description: t('mlearn.Settings.SRS.Description'),
        icon: <Icon icon='cards' color="currentColor" class={""}/>,
      }}
      padding="lg"
    >

      {/* Learning Limits - New Section */}
      <SettingGroup title={t('mlearn.Settings.SRS.LearningLimits.Title')}>
        <SettingRow
          label={t('mlearn.Settings.SRS.LearningLimits.NewDayHour.Label')}
          description={t('mlearn.Settings.SRS.LearningLimits.NewDayHour.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.newDayHour ?? 4}
            min={0}
            max={23}
            onChange={(e) => {
              const val = parseInt(e.currentTarget.value);
              if (!isNaN(val) && val >= 0 && val <= 23) {
                updateSettings({ newDayHour: val });
              }
            }}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.LearningLimits.MaxNewCardsLearning.Label')}
          description={t('mlearn.Settings.SRS.LearningLimits.MaxNewCardsLearning.Description')}
        >
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <input
              type="number"
              class="setting-input"
              value={store.meta.maxNewCardsPerDayLearning}
              min={-1}
              max={1000}
              onChange={(e) => updateMeta({ maxNewCardsPerDayLearning: parseLimitInput(e.currentTarget.value) })}
            />
            <span class="setting-hint">{t('mlearn.Settings.SRS.LearningLimits.UnlimitedHint')}</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.LearningLimits.MaxReviews.Label')}
          description={t('mlearn.Settings.SRS.LearningLimits.MaxReviews.Description')}
        >
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <input
              type="number"
              class="setting-input"
              value={store.meta.maxReviewsPerDay}
              min={-1}
              max={10000}
              onChange={(e) => updateMeta({ maxReviewsPerDay: parseLimitInput(e.currentTarget.value) })}
            />
            <span class="setting-hint">{t('mlearn.Settings.SRS.LearningLimits.UnlimitedHint')}</span>
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.SRS.AnkiIntegration.Title')}>
        <SettingRow
          label={t('mlearn.Settings.SRS.AnkiIntegration.Enable.Label')}
          description={t('mlearn.Settings.SRS.AnkiIntegration.Enable.Description')}
        >
          <ToggleSwitch
            checked={settings.use_anki}
            onChange={(checked) => updateSettings({ use_anki: checked })}
          />
        </SettingRow>

        <Show when={settings.use_anki}>
          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ConnectUrl.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ConnectUrl.Description')}
          >
            <Input
              type="text"
              size="md"
              value={settings.ankiConnectUrl}
              onChange={(e) => updateSettings({ ankiConnectUrl: e.currentTarget.value })}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ConnectionStatus.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ConnectionStatus.Description')}
          >
            <Btn size="sm" onClick={checkAnkiConnection}>
              {t('mlearn.Settings.SRS.AnkiIntegration.Test')}
            </Btn>
            <Show when={ankiStatus() === 'connected'}>
              <span class="anki-status-text--connected">{t('mlearn.Settings.SRS.AnkiIntegration.Connected')}</span>
            </Show>
            <Show when={ankiStatus() === 'error'}>
              <span class="anki-status-text--error">{t('mlearn.Settings.SRS.AnkiIntegration.Failed')}</span>
            </Show>
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Description')}
          >
            <Show when={ankiDecks().length > 0} fallback={
              <Input
                type="text"
                size="md"
                value={settings.flashcard_deck || ''}
                onChange={(e) => updateSettings({ flashcard_deck: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Placeholder')}
              />
            }>
              <Select
                class="setting-select"
                value={settings.flashcard_deck || ''}
                onChange={(e) => updateSettings({ flashcard_deck: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Placeholder')}
                options={ankiDecks().map(d => ({ value: d, label: d }))}
              />
            </Show>
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Description')}
          >
            <Show when={ankiModels().length > 0} fallback={
              <Input
                type="text"
                size="md"
                value={settings.anki_model_name || ''}
                onChange={(e) => updateSettings({ anki_model_name: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Placeholder')}
              />
            }>
              <Select
                class="setting-select"
                value={settings.anki_model_name || ''}
                onChange={(e) => handleModelChange(e.currentTarget.value)}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Placeholder')}
                options={ankiModels().map(m => ({ value: m, label: m }))}
              />
            </Show>
          </SettingRow>

          <Show when={ankiFields().length > 0}>
            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Expression.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Expression.Description')}
            >
              <Select
                class="setting-select"
                value={settings.anki_field_expression}
                onChange={(e) => updateSettings({ anki_field_expression: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Placeholder')}
                options={ankiFields().map(f => ({ value: f, label: f }))}
              />
            </SettingRow>

            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Reading.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Reading.Description')}
            >
              <Select
                class="setting-select"
                value={settings.anki_field_reading}
                onChange={(e) => updateSettings({ anki_field_reading: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Placeholder')}
                options={[
                  { value: '', label: t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.None') },
                  ...ankiFields().map(f => ({ value: f, label: f })),
                ]}
              />
            </SettingRow>

            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Meaning.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Meaning.Description')}
            >
              <Select
                class="setting-select"
                value={settings.anki_field_meaning}
                onChange={(e) => updateSettings({ anki_field_meaning: e.currentTarget.value })}
                placeholder={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Placeholder')}
                options={ankiFields().map(f => ({ value: f, label: f }))}
              />
            </SettingRow>

            {/* Card Preview */}
            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.Preview.Title')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.FieldMapping.Description')}
            >
              <Show when={!previewLoading()} fallback={
                <span class="anki-field-preview__empty">{t('mlearn.Settings.SRS.AnkiIntegration.Preview.Loading')}</span>
              }>
                <Show when={sampleNote()} fallback={
                  <span class="anki-field-preview__empty">{t('mlearn.Settings.SRS.AnkiIntegration.Preview.NoCard')}</span>
                }>
                  {(note) => {
                    const fields = note().fields;
                    const exprField = settings.anki_field_expression;
                    const readField = settings.anki_field_reading;
                    const meanField = settings.anki_field_meaning;
                    return (
                      <div class="anki-field-preview">
                        <div class="anki-field-preview__grid">
                          <Show when={exprField && fields[exprField]}>
                            <span class="anki-field-preview__label">{exprField}:</span>
                            <span class="anki-field-preview__value">{fields[exprField]?.value || ''}</span>
                          </Show>
                          <Show when={readField && fields[readField]}>
                            <span class="anki-field-preview__label">{readField}:</span>
                            <span class="anki-field-preview__value">{fields[readField]?.value || ''}</span>
                          </Show>
                          <Show when={meanField && fields[meanField]}>
                            <span class="anki-field-preview__label">{meanField}:</span>
                            <span class="anki-field-preview__value">{fields[meanField]?.value || ''}</span>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </Show>
              </Show>
            </SettingRow>
          </Show>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.AddScreenshots.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.AddScreenshots.Description')}
          >
            <ToggleSwitch
              checked={settings.flashcards_add_picture}
              onChange={(checked) => updateSettings({ flashcards_add_picture: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.SRS.BuiltInFlashcards.Title')}>
        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.Enable.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.Enable.Description')}
        >
          <ToggleSwitch
            checked={settings.enable_flashcard_creation}
            onChange={(checked) => updateSettings({ enable_flashcard_creation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.AutomaticCreation.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.AutomaticCreation.Description')}
        >
          <ToggleSwitch
            checked={settings.automaticFlashcardCreation}
            onChange={(checked) => updateSettings({ automaticFlashcardCreation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.MaxNewCards.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.MaxNewCards.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.maxNewCardsPerDay}
            min={0}
            max={100}
            onChange={(e) => updateSettings({ maxNewCardsPerDay: parseInt(e.currentTarget.value) })}
          />
        </SettingRow>

        <Show when={hasFreqLevels()}>
          <SettingRow
            label={t('mlearn.Settings.SRS.BuiltInFlashcards.ExamCardProportion.Label')}
            description={t('mlearn.Settings.SRS.BuiltInFlashcards.ExamCardProportion.Description')}
          >
            <input
              type="number"
              class="setting-input"
              value={settings.proportionOfExamCards}
              min={0}
              max={1}
              step={0.1}
              onChange={(e) => updateSettings({ proportionOfExamCards: parseFloat(e.currentTarget.value) })}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.BuiltInFlashcards.PreparedExamLevel.Label')}
            description={t('mlearn.Settings.SRS.BuiltInFlashcards.PreparedExamLevel.Description')}
          >
            <Select
              class="setting-select"
              value={settings.preparedExam.toString()}
              onChange={(e) => updateSettings({ preparedExam: parseInt(e.currentTarget.value) })}
            >
              <For each={freqLevels()}>
                {([level, name]) => (
                  <option value={level}>{name}</option>
                )}
              </For>
            </Select>
          </SettingRow>
        </Show>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Description')}
        >
          <ToggleSwitch
            checked={settings.createUnseenCards}
            onChange={(checked) => updateSettings({ createUnseenCards: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.LLMExamples.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.LLMExamples.Description')}
        >
          <ToggleSwitch
            checked={settings.flashcardLLMExamples}
            onChange={(checked) => updateSettings({ flashcardLLMExamples: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.FlipAnimation.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.FlipAnimation.Description')}
        >
          <ToggleSwitch
            checked={settings.flashcardFlipAnimation}
            onChange={(checked) => updateSettings({ flashcardFlipAnimation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.LeechThreshold.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.LeechThreshold.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.leechThreshold ?? 10}
            min={0}
            max={100}
            onChange={(e) => {
              const val = parseInt(e.currentTarget.value);
              if (!isNaN(val) && val >= 0) {
                updateSettings({ leechThreshold: val });
              }
            }}
          />
        </SettingRow>
      </SettingGroup>
      {/* Flashcard TTS */}
      <SettingGroup title={t('mlearn.AI.Settings.FlashcardTTS.Title')}>
        <SettingRow
            label={t('mlearn.AI.Settings.FlashcardTTS.AutoPlay.Label')}
            description={t('mlearn.AI.Settings.FlashcardTTS.AutoPlay.Description')}
        >
          <ToggleSwitch
              checked={settings.flashcardAutoTts}
              onChange={(v) => updateSettings({ flashcardAutoTts: v })}
          />
        </SettingRow>

        <SettingRow
            label={t('mlearn.AI.Settings.FlashcardTTS.Provider.Label')}
            description={t('mlearn.AI.Settings.FlashcardTTS.Provider.Description')}
        >
          <Select
              value={settings.flashcardTtsProvider}
              onChange={(e) => updateSettings({ flashcardTtsProvider: e.currentTarget.value as TTSProvider })}
              options={[
                { value: 'kokoro', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Kokoro') },
                { value: 'qwen3', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Qwen3') },
                { value: 'cloud', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Cloud') },
              ]}
          />
        </SettingRow>

        <Show when={settings.flashcardTtsProvider !== 'kokoro' && settings.flashcardTtsProvider !== 'cloud'}>
          <SettingRow
              label={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Label')}
              description={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Description')}
          >
            <VoiceSamplePicker
                value={settings.flashcardVoiceSampleId}
                onChange={(id) => updateSettings({ flashcardVoiceSampleId: id })}
                ttsProvider={settings.flashcardTtsProvider}
            />
          </SettingRow>
        </Show>

        <SettingRow
            label={t('mlearn.AI.Settings.FlashcardTTS.AutoGenerate.Label')}
            description={t('mlearn.AI.Settings.FlashcardTTS.AutoGenerate.Description')}
        >
          <ToggleSwitch
              checked={settings.flashcardAutoGenerateAudio}
              onChange={(v) => updateSettings({ flashcardAutoGenerateAudio: v })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.SRS.DataManagement.Title')}>
        <SettingRow
          label={t('mlearn.Settings.SRS.DataManagement.ResetSRS.Label')}
          description={t('mlearn.Settings.SRS.DataManagement.ResetSRS.Description')}
        >
          <Btn size="sm" variant="danger" onClick={() => setShowResetModal(true)}>
            {t('mlearn.Settings.SRS.DataManagement.ResetButton')}
          </Btn>
        </SettingRow>
        <SettingRow
          label={t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Label')}
          description={t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Description')}
        >
          <Btn size="sm" variant="danger" onClick={() => setShowNukeModal(true)}>
            {t('mlearn.Settings.SRS.DataManagement.NukeButton')}
          </Btn>
        </SettingRow>
      </SettingGroup>

      <Modal
        isOpen={showResetModal()}
        onClose={() => { setShowResetModal(false); setResetConfirmPhrase(''); }}
        title={t('mlearn.Settings.SRS.DataManagement.ResetSRS.Label')}
        size="sm"
        footer={
          <ModalFooter
            cancelText={t('mlearn.Global.Cancel')}
            onCancel={() => { setShowResetModal(false); setResetConfirmPhrase(''); }}
            confirmText={t('mlearn.Settings.SRS.DataManagement.ResetButton')}
            onConfirm={handleResetSRS}
            confirmVariant="danger"
            confirmDisabled={!canConfirmReset()}
          />
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('mlearn.Settings.SRS.DataManagement.ResetSRS.ModalWarning')}
          </p>
          <p style={{ margin: 0, color: 'var(--text-secondary)', 'font-size': 'var(--font-size-sm)' }}>
            {t('mlearn.Settings.SRS.DataManagement.ResetSRS.TypePhrase', { phrase: RESET_PHRASE })}
          </p>
          <Input
            value={resetConfirmPhrase()}
            onInput={(e) => setResetConfirmPhrase(e.currentTarget.value)}
            placeholder={RESET_PHRASE}
            onKeyDown={(e) => { if (e.key === 'Enter' && canConfirmReset()) handleResetSRS(); }}
          />
        </div>
      </Modal>
      <Modal
        isOpen={showNukeModal()}
        onClose={() => { setShowNukeModal(false); setNukeConfirmPhrase(''); }}
        title={t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Label')}
        size="sm"
        footer={
          <ModalFooter
            cancelText={t('mlearn.Global.Cancel')}
            onCancel={() => { setShowNukeModal(false); setNukeConfirmPhrase(''); }}
            confirmText={t('mlearn.Settings.SRS.DataManagement.NukeButton')}
            onConfirm={handleNukeFlashcards}
            confirmVariant="danger"
            confirmDisabled={!canConfirmNuke()}
          />
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.ModalWarning')}
          </p>
          <p style={{ margin: 0, color: 'var(--text-secondary)', 'font-size': 'var(--font-size-sm)' }}>
            {t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.TypePhrase', { phrase: NUKE_PHRASE })}
          </p>
          <Input
            value={nukeConfirmPhrase()}
            onInput={(e) => setNukeConfirmPhrase(e.currentTarget.value)}
            placeholder={NUKE_PHRASE}
            onKeyDown={(e) => { if (e.key === 'Enter' && canConfirmNuke()) handleNukeFlashcards(); }}
          />
        </div>
      </Modal>
    </TabContent>
  );
};
