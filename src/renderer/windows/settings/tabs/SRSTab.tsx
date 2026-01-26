/**
 * SRS Settings Tab
 */

import { Component, createSignal, Show } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, GlassBtn } from '../../../components/common';

export const SRSTab: Component = () => {
  const { settings, updateSettings } = useSettings();
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

  return (
    <TabContent
      header={{
        title: 'Spaced Repetition',
        description: 'Configure flashcard and Anki settings',
        icon: '🃏',
      }}
      padding="lg"
    >

      <SettingGroup title="Anki Integration">
        <SettingRow
          label="Enable Anki"
          description="Send flashcards to Anki via AnkiConnect"
        >
          <ToggleSwitch
            checked={settings.use_anki}
            onChange={(checked) => updateSettings({ use_anki: checked })}
          />
        </SettingRow>

        <Show when={settings.use_anki}>
          <SettingRow
            label="AnkiConnect URL"
            description="URL of your AnkiConnect server"
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
            label="Connection Status"
            description="Test your AnkiConnect connection"
          >
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <GlassBtn size="sm" onClick={checkAnkiConnection}>
                Test
              </GlassBtn>
              <Show when={ankiStatus() === 'connected'}>
                <span style={{ color: "#4ade80" }}>✓ Connected</span>
              </Show>
              <Show when={ankiStatus() === 'error'}>
                <span style={{ color: "#ef4444" }}>✗ Failed</span>
              </Show>
            </div>
          </SettingRow>

          <SettingRow
            label="Deck Name"
            description="Anki deck for new cards"
          >
            <input
              type="text"
              class="setting-input"
              style={{ width: "150px" }}
              value={settings.flashcard_deck || ''}
              onChange={(e) => updateSettings({ flashcard_deck: e.currentTarget.value })}
              placeholder="Default"
            />
          </SettingRow>

          <SettingRow
            label="Model Name"
            description="Anki note type to use"
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
            label="Add Screenshots"
            description="Include video screenshots in flashcards"
          >
            <ToggleSwitch
              checked={settings.flashcards_add_picture}
              onChange={(checked) => updateSettings({ flashcards_add_picture: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title="Built-in Flashcards">
        <SettingRow
          label="Enable Flashcard Creation"
          description="Allow creating flashcards within mLearn"
        >
          <ToggleSwitch
            checked={settings.enable_flashcard_creation}
            onChange={(checked) => updateSettings({ enable_flashcard_creation: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Max New Cards Per Day"
          description="Limit for auto-created flashcards"
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
          label="Exam Card Proportion"
          description="Percentage of cards from exam levels (0-1)"
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
          label="Prepared Exam Level"
          description="Target JLPT level (5=N5, 1=N1)"
        >
          <select
            class="setting-select"
            value={settings.preparedExam}
            onChange={(e) => updateSettings({ preparedExam: parseInt(e.currentTarget.value) })}
          >
            <option value={5}>N5 (Beginner)</option>
            <option value={4}>N4</option>
            <option value={3}>N3</option>
            <option value={2}>N2</option>
            <option value={1}>N1 (Advanced)</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Create Unseen Cards"
          description="Auto-create cards for new exam-level words"
        >
          <ToggleSwitch
            checked={settings.createUnseenCards}
            onChange={(checked) => updateSettings({ createUnseenCards: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Data Management">
        <SettingRow
          label="Reset SRS Data"
          description="Clear all flashcard progress (cannot be undone!)"
        >
          <GlassBtn size="sm" variant="danger" onClick={() => resetSRS()}>
            Reset SRS
          </GlassBtn>
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};

function resetSRS() {
  if (confirm('Are you sure you want to reset all SRS data? This cannot be undone!')) {
    if (confirm('This will delete all your flashcard progress. Really continue?')) {
      // TODO: Implement SRS reset
      console.log('Reset SRS');
    }
  }
}
