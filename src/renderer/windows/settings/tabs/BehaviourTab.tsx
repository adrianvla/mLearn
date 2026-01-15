/**
 * Behaviour Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow } from './components/SettingRow';
import { SettingGroup } from './components/SettingGroup';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings } = useSettings();

  return (
    <div class="tab-content">
      <div class="tab-header">
        <h2>Behaviour</h2>
        <p>Configure how mLearn interacts with content</p>
      </div>

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
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.do_colour_known}
              onChange={(e) => updateSettings({ do_colour_known: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
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
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.do_colour_codes}
              onChange={(e) => updateSettings({ do_colour_codes: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Blur Effect">
        <SettingRow
          label="Blur Unknown Words"
          description="Blur words you haven't learned yet"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.blur_words}
              onChange={(e) => updateSettings({ blur_words: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>

        <SettingRow
          label="Blur Known Subtitles"
          description="Blur subtitles that are mostly known words"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.blur_known_subtitles}
              onChange={(e) => updateSettings({ blur_known_subtitles: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
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
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.furigana}
              onChange={(e) => updateSettings({ furigana: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>

        <SettingRow
          label="Show Pitch Accent"
          description="Display pitch accent patterns"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.showPitchAccent}
              onChange={(e) => updateSettings({ showPitchAccent: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>

        <SettingRow
          label="Show Part of Speech"
          description="Display grammatical information in popups"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.show_pos}
              onChange={(e) => updateSettings({ show_pos: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>

        <SettingRow
          label="Auto-open Word Panel"
          description="Automatically show the live word translator"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.openAside}
              onChange={(e) => updateSettings({ openAside: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Performance">
        <SettingRow
          label="Immediate Fetch"
          description="Pre-load translations for all words (uses more bandwidth)"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.immediateFetch}
              onChange={(e) => updateSettings({ immediateFetch: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>

        <SettingRow
          label="Fetch Dictionary for Known"
          description="Look up known words in dictionary on hover"
        >
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.hover_known_get_from_dictionary}
              onChange={(e) => updateSettings({ hover_known_get_from_dictionary: e.currentTarget.checked })}
            />
            <span class="toggle-slider" />
          </label>
        </SettingRow>
      </SettingGroup>
    </div>
  );
};
