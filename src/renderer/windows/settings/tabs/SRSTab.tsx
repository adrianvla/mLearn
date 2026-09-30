import { flashcardAudioProvider } from '../../../../shared/utils/flashcardAudioPreset';
import { FlashcardAudioPresetSelect } from '../../../components/flashcard/FlashcardAudioPresetSelect';
/**
 * SRS Settings Tab
 */

import { Component, createSignal, Show, createMemo, createEffect, on } from 'solid-js';
import { useSettings, useLocalization, useFlashcards, useLanguage } from '../../../context';
import { Button, SettingRow, SettingGroup, ToggleSwitch, TabContent, Select, Input, Textarea, VoiceSamplePicker, SafeHtml, useConfirmDialog } from '../../../components/common';
import { showToast } from '../../../components/common/Feedback/Toast';
import {
  buildDestructiveDataConfirm,
  confirmDestructiveDataAction,
  destructiveDataAction,
} from '../destructiveDataAction';
import { useAnki, type AnkiNoteInfo } from '../../../hooks/useAnki';
import { importAnkiReviewHistory } from '../../../services/ankiReviewImport';
import '../SettingsForm.css';
import './AnkiFieldPreview.css';
import Icon from "@renderer/components/common/Icons/Icon";
import { DEFAULT_SETTINGS, type TTSProvider } from "@shared/types";
import { shouldShowAnkiSettings, shouldShowFrequencySettings } from './managedSettingVisibility';

export const SRSTab: Component = () => {
  const { settings, updateSettings, isSettingManaged } = useSettings();
  const { t } = useLocalization();
  const { store, updateMeta, resetSRS, nukeAllFlashcards } = useFlashcards();
  const { recomputeWordKnowledgeFromEvidence } = useFlashcards();

  const { getLanguageFeatures, currentLangData } = useLanguage();
  const usesFastFlashcardAudio = () => (settings.flashcardCreationAudioPreset ?? DEFAULT_SETTINGS.flashcardCreationAudioPreset) === 'fast'
    || (settings.flashcardRegenerationAudioPreset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset) === 'fast';
  const anki = useAnki();
  const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
  const [ankiStatus, setAnkiStatus] = createSignal<'unchecked' | 'connected' | 'error'>('unchecked');

  // Anki metadata fetched from AnkiConnect
  const [ankiDecks, setAnkiDecks] = createSignal<string[]>([]);
  const [ankiModels, setAnkiModels] = createSignal<string[]>([]);
  const [ankiFields, setAnkiFields] = createSignal<string[]>([]);
  const [sampleNote, setSampleNote] = createSignal<AnkiNoteInfo | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);

  const [importingHistory, setImportingHistory] = createSignal(false);

  const importReviewHistory = async () => {
    if (importingHistory()) return;
    setImportingHistory(true);
    try {
      const result = await importAnkiReviewHistory(settings.language, {
        fetchReviews: (ids: number[]) => anki.getReviewsOfCards(ids),
        fetchCards: (ids: number[]) => anki.getCardsInfo(ids),
        fields: {
          expression: settings.anki_field_expression ?? DEFAULT_SETTINGS.anki_field_expression,
          reading: settings.anki_field_reading ?? DEFAULT_SETTINGS.anki_field_reading,
          meaning: settings.anki_field_meaning ?? DEFAULT_SETTINGS.anki_field_meaning,
        },
        grammar: currentLangData()?.grammar,
      });
      // Refresh materialized projections from the appended Anki evidence.
      for (const word of result.importedWords) {
        void recomputeWordKnowledgeFromEvidence(word, settings.language);
      }
      showToast({
        message: t('mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Success', {
          imported: result.imported,
          words: result.words,
          skipped: result.skipped,
        }),
        variant: 'success',
      });
    } catch {
      showToast({ message: t('mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Failed'), variant: 'error' });
    } finally {
      setImportingHistory(false);
    }
  };

  /**
   * Everything the given action would take away, not just the cards.
   *
   * `nukeAllFlashcards` reconciles the store back to a fresh one, so it clears
   * the knowledge and statistics a profile accumulates from reading as well as
   * the cards it holds. A profile that has read a year of material and built no
   * cards still has something to lose, and skipping the prompt because
   * `flashcards` is empty would take it away silently.
   */
  const destroyedCount = (id: 'resetSrs' | 'deleteAllFlashcards') => {
    const sized = (record: unknown) => (record && typeof record === 'object' ? Object.keys(record).length : 0);
    if (id === 'resetSrs') {
      // Scheduling lives on the cards themselves, so cards are the subject.
      return sized(store.flashcards);
    }
    return sized(store.flashcards) + sized(store.wordKnowledge) + sized(store.grammarKnowledge)
      + sized(store.dailyStats) + sized(store.wordCandidates) + sized(store.knownUntracked)
      + sized(store.wordStatsMap);
  };

  /**
   * Both controls go through the same prompt, the same severity ranking and the
   * same success toast. The typed phrase they used to demand carried no
   * information the body did not already state - a user who wants the action
   * types it, and a user who does not was never going to read the list of what
   * disappears. What protects the destructive one is that the body is still
   * read, and the difference between the two is now expressed as severity
   * rather than as two separately invented dialogs.
   *
   * The prompt is shown whenever there is something to destroy, and skipped
   * only when the profile is empty - the rule lives in
   * `confirmDestructiveDataAction` so a third tab cannot decide it differently.
   */
  const confirmThen = async (id: 'resetSrs' | 'deleteAllFlashcards', run: () => void) => {
    const action = destructiveDataAction(id);
    if (confirmDestructiveDataAction(destroyedCount(id)) && !await showConfirm(buildDestructiveDataConfirm(action, t))) return;
    run();
    showToast({ message: t(action.successKey), variant: 'success' });
  };

  const handleResetSRS = () => { void confirmThen('resetSrs', resetSRS); };
  const handleNukeFlashcards = () => { void confirmThen('deleteAllFlashcards', nukeAllFlashcards); };

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
          settingKey="newDayHour"
        >
          <input
            type="number"
            class="setting-input"
            value={settings.newDayHour ?? DEFAULT_SETTINGS.newDayHour}
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
          settingKey="use_anki"
        >
          <ToggleSwitch
            checked={settings.use_anki}
            onChange={(checked) => updateSettings({ use_anki: checked })}
          />
        </SettingRow>

        <Show when={shouldShowAnkiSettings(settings.use_anki, isSettingManaged)}>
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
            <Button size="sm" onClick={checkAnkiConnection}>
              {t('mlearn.Settings.SRS.AnkiIntegration.Test')}
            </Button>
            <Show when={ankiStatus() === 'connected'}>
              <span class="anki-status-text--connected">{t('mlearn.Settings.SRS.AnkiIntegration.Connected')}</span>
            </Show>
            <Show when={ankiStatus() === 'error'}>
              <span class="anki-status-text--error">{t('mlearn.Settings.SRS.AnkiIntegration.Failed')}</span>
            </Show>
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Description')}
          >
            <Button size="sm" disabled={importingHistory()} onClick={importReviewHistory}>
              {t(importingHistory()
                ? 'mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Running'
                : 'mlearn.Settings.SRS.AnkiIntegration.ImportHistory.Button')}
            </Button>
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Description')}
            settingKey="flashcard_deck"
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

            {/* Field Templates */}
            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Expression.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Description')}
            >
              <Textarea
                value={settings.ankiTemplateExpression}
                onInput={(e) => updateSettings({ ankiTemplateExpression: e.currentTarget.value })}
                rows={2}
              />
            </SettingRow>

            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Reading.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Description')}
            >
              <Textarea
                value={settings.ankiTemplateReading}
                onInput={(e) => updateSettings({ ankiTemplateReading: e.currentTarget.value })}
                rows={2}
              />
            </SettingRow>

            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Meaning.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Description')}
            >
              <Textarea
                value={settings.ankiTemplateMeaning}
                onInput={(e) => updateSettings({ ankiTemplateMeaning: e.currentTarget.value })}
                rows={3}
              />
            </SettingRow>

            <SettingRow
              label={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Preview.Label')}
              description={t('mlearn.Settings.SRS.AnkiIntegration.Templates.Preview.Description')}
            >
              <div class="anki-field-preview">
                <div class="anki-field-preview__grid">
                  <span class="anki-field-preview__label">{settings.anki_field_expression}:</span>
                  <span class="anki-field-preview__value">
                    {(settings.ankiTemplateExpression || DEFAULT_SETTINGS.ankiTemplateExpression)
                      .replace(/\{word\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Word'))
                      .replace(/\{reading\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Reading'))
                      .replace(/\{meaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Meaning'))
                      .replace(/\{example\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Example'))
                      .replace(/\{exampleMeaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.ExampleMeaning'))}
                  </span>
                  <Show when={settings.anki_field_reading}>
                    <span class="anki-field-preview__label">{settings.anki_field_reading}:</span>
                    <span class="anki-field-preview__value">
                      {(settings.ankiTemplateReading || DEFAULT_SETTINGS.ankiTemplateReading)
                        .replace(/\{word\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Word'))
                        .replace(/\{reading\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Reading'))
                        .replace(/\{meaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Meaning'))
                        .replace(/\{example\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Example'))
                        .replace(/\{exampleMeaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.ExampleMeaning'))}
                    </span>
                  </Show>
                  <span class="anki-field-preview__label">{settings.anki_field_meaning}:</span>
                  <span class="anki-field-preview__value">
                    {(settings.ankiTemplateMeaning || DEFAULT_SETTINGS.ankiTemplateMeaning)
                      .replace(/\{word\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Word'))
                      .replace(/\{reading\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Reading'))
                      .replace(/\{meaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Meaning'))
                      .replace(/\{example\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.Example'))
                      .replace(/\{exampleMeaning\}/g, t('mlearn.Settings.SRS.AnkiIntegration.Templates.Sample.ExampleMeaning'))}
                  </span>
                </div>
              </div>
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
                            <SafeHtml tag="span" class="anki-field-preview__value" html={fields[exprField]?.value || ''} />
                          </Show>
                          <Show when={readField && fields[readField]}>
                            <span class="anki-field-preview__label">{readField}:</span>
                            <SafeHtml tag="span" class="anki-field-preview__value" html={fields[readField]?.value || ''} />
                          </Show>
                          <Show when={meanField && fields[meanField]}>
                            <span class="anki-field-preview__label">{meanField}:</span>
                            <SafeHtml tag="span" class="anki-field-preview__value" html={fields[meanField]?.value || ''} />
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
            settingKey="flashcards_add_picture"
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
          settingKey="enable_flashcard_creation"
        >
          <ToggleSwitch
            checked={settings.enable_flashcard_creation}
            onChange={(checked) => updateSettings({ enable_flashcard_creation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.AutomaticCreation.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.AutomaticCreation.Description')}
          settingKey="automaticFlashcardCreation"
        >
          <ToggleSwitch
            checked={settings.automaticFlashcardCreation}
            onChange={(checked) => updateSettings({ automaticFlashcardCreation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.MaxNewCards.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.MaxNewCards.Description')}
          settingKey="maxNewCardsPerDay"
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

        <Show when={shouldShowFrequencySettings(hasFreqLevels(), isSettingManaged)}>
          <SettingRow
            label={t('mlearn.Settings.SRS.BuiltInFlashcards.LevelCardProportion.Label')}
            description={t('mlearn.Settings.SRS.BuiltInFlashcards.LevelCardProportion.Description')}
            settingKey="proportionOfLevelCards"
          >
            <input
              type="number"
              class="setting-input"
              value={settings.proportionOfLevelCards}
              min={0}
              max={1}
              step={0.1}
              onChange={(e) => updateSettings({ proportionOfLevelCards: parseFloat(e.currentTarget.value) })}
            />
          </SettingRow>


        </Show>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Description')}
          settingKey="createUnseenCards"
        >
          <ToggleSwitch
            checked={settings.createUnseenCards}
            onChange={(checked) => updateSettings({ createUnseenCards: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.LLMExamples.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.LLMExamples.Description')}
          settingKey="flashcardLLMExamples"
        >
          <ToggleSwitch
            checked={settings.flashcardLLMExamples}
            onChange={(checked) => updateSettings({ flashcardLLMExamples: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.FlipAnimation.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.FlipAnimation.Description')}
          settingKey="flashcardFlipAnimation"
        >
          <ToggleSwitch
            checked={settings.flashcardFlipAnimation}
            onChange={(checked) => updateSettings({ flashcardFlipAnimation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.LeechThreshold.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.LeechThreshold.Description')}
          settingKey="leechThreshold"
        >
          <input
            type="number"
            class="setting-input"
            value={settings.leechThreshold ?? DEFAULT_SETTINGS.leechThreshold}
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

        <Show when={usesFastFlashcardAudio() || (settings.flashcardTtsProvider !== 'kokoro' && settings.flashcardTtsProvider !== 'cloud')}>
          <SettingRow
              label={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Label')}
              description={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Description')}
          >
            <VoiceSamplePicker
                value={settings.flashcardVoiceSampleId}
                onChange={(id) => updateSettings({ flashcardVoiceSampleId: id })}
                ttsProvider={flashcardAudioProvider(usesFastFlashcardAudio() ? 'fast' : 'high-quality', settings.flashcardTtsProvider)}
            />
          </SettingRow>
        </Show>
        <Show when={settings.flashcardTtsProvider !== 'kokoro' && settings.flashcardTtsProvider !== 'cloud'}>
          <SettingRow
            label={t('mlearn.AI.Settings.FlashcardLLM.Label')}
            description={t('mlearn.AI.Settings.FlashcardLLM.Description')}
          >
            <input
              class="setting-input"
              type="number"
              min="0"
              max="5000"
              step="25"
              value={settings.llmBulkExampleBatchSize}
              onChange={(e) => updateSettings({ llmBulkExampleBatchSize: Math.max(0, Math.floor(e.currentTarget.valueAsNumber || 0)) })}
            />
          </SettingRow>
        </Show>

        <SettingRow
          label={t('mlearn.AI.Settings.FlashcardTTS.CreationPreset.Label')}
          description={t('mlearn.AI.Settings.FlashcardTTS.CreationPreset.Description')}
        >
          <FlashcardAudioPresetSelect
            ariaLabel={t('mlearn.AI.Settings.FlashcardTTS.CreationPreset.Label')}
            value={settings.flashcardCreationAudioPreset ?? DEFAULT_SETTINGS.flashcardCreationAudioPreset}
            onChange={(value) => updateSettings({ flashcardCreationAudioPreset: value })}
          />
        </SettingRow>
        <SettingRow
          label={t('mlearn.AI.Settings.FlashcardTTS.RegenerationPreset.Label')}
          description={t('mlearn.AI.Settings.FlashcardTTS.RegenerationPreset.Description')}
        >
          <FlashcardAudioPresetSelect
            ariaLabel={t('mlearn.AI.Settings.FlashcardTTS.RegenerationPreset.Label')}
            value={settings.flashcardRegenerationAudioPreset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset}
            onChange={(value) => updateSettings({ flashcardRegenerationAudioPreset: value })}
          />
        </SettingRow>

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
          <Button size="sm" variant="danger" onClick={handleResetSRS}>
            {t('mlearn.Settings.SRS.DataManagement.ResetButton')}
          </Button>
        </SettingRow>
        <SettingRow
          label={t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Label')}
          description={t('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Description')}
        >
          <Button size="sm" variant="danger" onClick={handleNukeFlashcards}>
            {t('mlearn.Settings.SRS.DataManagement.NukeButton')}
          </Button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialogElement />
    </TabContent>
  );
};
