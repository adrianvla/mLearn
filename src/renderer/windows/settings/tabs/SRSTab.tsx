/**
 * SRS Settings Tab
 */

import { Component, createSignal, Show } from 'solid-js';
import { useSettings, useLocalization, useFlashcards } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, Btn, Select } from '../../../components/common';

export const SRSTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { store, updateMeta } = useFlashcards();
  const [ankiStatus, setAnkiStatus] = createSignal<'unchecked' | 'connected' | 'error'>('unchecked');

  const checkAnkiConnection = async () => {
    try {
      const response = await fetch(settings.ankiConnectUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'version', version: 6 }),
      });
      if (response.ok) {
        setAnkiStatus('connected');
      } else {
        setAnkiStatus('error');
      }
    } catch {
      setAnkiStatus('error');
    }
  };

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
        icon: '🃏',
      }}
      padding="lg"
    >

      {/* Learning Limits - New Section */}
      <SettingGroup title={t('mlearn.Settings.SRS.LearningLimits.Title')}>
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
            <input
              type="text"
              class="setting-input"
              style={{ width: "200px" }}
              value={settings.ankiConnectUrl}
              onChange={(e) => updateSettings({ ankiConnectUrl: e.currentTarget.value })}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ConnectionStatus.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ConnectionStatus.Description')}
          >
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Btn size="sm" onClick={checkAnkiConnection}>
                {t('mlearn.Settings.SRS.AnkiIntegration.Test')}
              </Btn>
              <Show when={ankiStatus() === 'connected'}>
                <span style={{ color: "#4ade80" }}>{t('mlearn.Settings.SRS.AnkiIntegration.Connected')}</span>
              </Show>
              <Show when={ankiStatus() === 'error'}>
                <span style={{ color: "#ef4444" }}>{t('mlearn.Settings.SRS.AnkiIntegration.Failed')}</span>
              </Show>
            </div>
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Description')}
          >
            <input
              type="text"
              class="setting-input"
              style={{ width: "150px" }}
              value={settings.flashcard_deck || ''}
              onChange={(e) => updateSettings({ flashcard_deck: e.currentTarget.value })}
              placeholder={t('mlearn.Settings.SRS.AnkiIntegration.DeckName.Placeholder')}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.ModelName.Description')}
          >
            <input
              type="text"
              class="setting-input"
              style={{ width: "150px" }}
              value={settings.ankiModelName}
              onChange={(e) => updateSettings({ ankiModelName: e.currentTarget.value })}
            />
          </SettingRow>

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
            <option value="5">{t('mlearn.Settings.SRS.BuiltInFlashcards.ExamLevels.N5')}</option>
            <option value="4">{t('mlearn.Settings.SRS.BuiltInFlashcards.ExamLevels.N4')}</option>
            <option value="3">{t('mlearn.Settings.SRS.BuiltInFlashcards.ExamLevels.N3')}</option>
            <option value="2">{t('mlearn.Settings.SRS.BuiltInFlashcards.ExamLevels.N2')}</option>
            <option value="1">{t('mlearn.Settings.SRS.BuiltInFlashcards.ExamLevels.N1')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Description')}
        >
          <ToggleSwitch
            checked={settings.createUnseenCards}
            onChange={(checked) => updateSettings({ createUnseenCards: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.SRS.DataManagement.Title')}>
        <SettingRow
          label={t('mlearn.Settings.SRS.DataManagement.ResetSRS.Label')}
          description={t('mlearn.Settings.SRS.DataManagement.ResetSRS.Description')}
        >
          <Btn size="sm" variant="danger" onClick={() => {
            if (confirm(t('mlearn.Settings.BuiltInFlashcards.ResetSrsConfirm'))) {
              if (confirm(t('mlearn.Settings.BuiltInFlashcards.ResetSrsConfirm2'))) {
                // TODO: Implement SRS reset
                console.log('Reset SRS');
              }
            }
          }}>
            {t('mlearn.Settings.SRS.DataManagement.ResetButton')}
          </Btn>
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
