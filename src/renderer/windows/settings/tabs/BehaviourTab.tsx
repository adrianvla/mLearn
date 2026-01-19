/**
 * Behaviour Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow } from './components/SettingRow';
import { SettingGroup } from './components/SettingGroup';
import { ToggleSwitch, TabContent } from '../../../components/common';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings } = useSettings();

  return (
    <TabContent
      header={{
        title: 'Behaviour',
        description: 'Configure how mLearn interacts with content',
        icon: '🎯',
      }}
      padding="lg"
    >

      <SettingGroup title="Word Status">
        <SettingRow
          label="Known Ease Threshold"
          description="Minimum ease factor to consider a word 'known' from SRS"
        >
          <input
            type="number"
            class="setting-input"
            value={settings.known_ease_threshold}
            min={1000}
            max={5000}
            step={100}
            onChange={(e) => updateSettings({ known_ease_threshold: parseInt(e.currentTarget.value) })}
          />
        </SettingRow>

        <SettingRow
          label="Colour Known Words"
          description="Highlight words you've learned"
        >
          <ToggleSwitch
            checked={settings.do_colour_known}
            onChange={(checked) => updateSettings({ do_colour_known: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Known Word Colour"
          description="Colour used to highlight known words"
        >
          <div class="color-input-wrapper">
            <input
              type="color"
              class="setting-color"
              value={settings.colour_known}
              onChange={(e) => updateSettings({ colour_known: e.currentTarget.value })}
            />
            <span class="color-value">{settings.colour_known}</span>
          </div>
        </SettingRow>

        <SettingRow
          label="Colour by Part of Speech"
          description="Colour words based on their grammatical type"
        >
          <ToggleSwitch
            checked={settings.do_colour_codes}
            onChange={(checked) => updateSettings({ do_colour_codes: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Blur Effect">
        <SettingRow
          label="Blur Unknown Words"
          description="Blur words you haven't learned yet"
        >
          <ToggleSwitch
            checked={settings.blur_words}
            onChange={(checked) => updateSettings({ blur_words: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Blur Known Subtitles"
          description="Blur subtitles that are mostly known words"
        >
          <ToggleSwitch
            checked={settings.blur_known_subtitles}
            onChange={(checked) => updateSettings({ blur_known_subtitles: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Blur Amount"
          description="Intensity of the blur effect (pixels)"
        >
          <input
            type="range"
            class="setting-range"
            min={1}
            max={20}
            value={settings.blur_amount}
            onChange={(e) => updateSettings({ blur_amount: parseInt(e.currentTarget.value) })}
          />
          <span style={{ "margin-left": "8px" }}>{settings.blur_amount}px</span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Display Options">
        <SettingRow
          label="Show Furigana"
          description="Display reading above kanji"
        >
          <ToggleSwitch
            checked={settings.furigana}
            onChange={(checked) => updateSettings({ furigana: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Show Pitch Accent"
          description="Display pitch accent patterns"
        >
          <ToggleSwitch
            checked={settings.showPitchAccent}
            onChange={(checked) => updateSettings({ showPitchAccent: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Show Part of Speech"
          description="Display grammatical information in popups"
        >
          <ToggleSwitch
            checked={settings.show_pos}
            onChange={(checked) => updateSettings({ show_pos: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Auto-open Word Panel"
          description="Automatically show the live word translator"
        >
          <ToggleSwitch
            checked={settings.openAside}
            onChange={(checked) => updateSettings({ openAside: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Performance">
        <SettingRow
          label="Immediate Fetch"
          description="Pre-load translations for all words (uses more bandwidth)"
        >
          <ToggleSwitch
            checked={settings.immediateFetch}
            onChange={(checked) => updateSettings({ immediateFetch: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Fetch Dictionary for Known"
          description="Look up known words in dictionary on hover"
        >
          <ToggleSwitch
            checked={settings.hover_known_get_from_dictionary}
            onChange={(checked) => updateSettings({ hover_known_get_from_dictionary: checked })}
          />
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
