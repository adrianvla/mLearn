/**
 * Settings Modal Component
 * Comprehensive settings dialog with 7 tabs ported from the original mLearn app
 * Matches legacy layout: navbar on top with icons, scrollable content below
 */

import { Component, createSignal, Show, For, onMount, createEffect } from 'solid-js';
import { useSettings, useLanguage } from '../../context';
import { GlassModal, GlassBtn } from '../common';
import type { Settings } from '../../../shared/types';
import { SUBTITLE_THEMES, type SubtitleTheme } from '../../../shared/constants';
import './settings.css';

// Settings categories with their fields - matches old IN_SETTINGS_CATEGORY
const SETTINGS_CATEGORIES = {
  General: [
    'language',
    'stats',
    'install_languages',
    'activate_license',
    'save',
    'restoreDefaults',
  ],
  Behaviour: [
    'known_ease_threshold',
    'blur_words',
    'blur_known_subtitles',
    'blur_amount',
    'immediateFetch',
    'do_colour_known',
    'colour_known',
    'do_colour_codes',
    'show_pos',
    'hover_known_get_from_dictionary',
    'furigana',
    'openAside',
    'showPitchAccent',
    'devMode',
    'save',
    'restoreDefaults',
  ],
  Customization: [
    'dark_mode',
    'subtitleTheme',
    'subtitle_font_size',
    'subtitle_font_weight',
    'save',
    'restoreDefaults',
  ],
  SRS: [
    'use_anki',
    'ankiConnectUrl',
    'enable_flashcard_creation',
    'flashcards_add_picture',
    'flashcard_deck',
    'anki_model_display',
    'anki_field_expression',
    'anki_field_reading',
    'anki_field_meaning',
    'maxNewCardsPerDay',
    'proportionOfExamCards',
    'preparedExam',
    'createUnseenCards',
    'resetSRS',
    'save',
    'restoreDefaults',
  ],
  Reader: ['ocr_crop_padding', 'save', 'restoreDefaults'],
  Stats: [],
  About: [],
} as const;

type CategoryName = keyof typeof SETTINGS_CATEGORIES;

// Icon paths for categories - using actual SVG icons instead of emojis
const CATEGORY_ICONS: Record<CategoryName, string> = {
  General: 'assets/icons/cog.svg',
  Behaviour: 'assets/icons/subtitles.svg',
  Customization: 'assets/icons/palette.svg',
  SRS: 'assets/icons/cards.svg',
  Reader: 'assets/icons/book.svg',
  Stats: 'assets/icons/stats.svg',
  About: 'assets/icons/document.svg',
};

// Display names for categories (can differ from key)
const CATEGORY_NAMES: Record<CategoryName, string> = {
  General: 'General',
  Behaviour: 'Behaviour',
  Customization: 'Appearance',
  SRS: 'Flashcards',
  Reader: 'Reader',
  Stats: 'Stats',
  About: 'About',
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: CategoryName;
}

export const SettingsModal: Component<SettingsModalProps> = (props) => {
  const { settings, updateSettings, saveSettings } = useSettings();
  const { isSettingFixed } = useLanguage();
  const [activeTab, setActiveTab] = createSignal<CategoryName>(props.initialTab || 'General');
  const [localSettings, setLocalSettings] = createSignal<Partial<Settings>>({});
  const [requiresRestart, setRequiresRestart] = createSignal(false);
  const [ankiDecks, setAnkiDecks] = createSignal<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [ankiFields, _setAnkiFields] = createSignal<string[]>([]);
  const [version, setVersion] = createSignal('');
  
  // Time watched and stats
  const [timeWatched, setTimeWatched] = createSignal('0h 0m');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [wordsLearned, _setWordsLearned] = createSignal(0);

  // Initialize local settings from current settings
  onMount(() => {
    setLocalSettings({ ...settings });
    
    // Get version
    if (window.mLearnIPC) {
      window.mLearnIPC.getVersion();
      window.mLearnIPC.onVersionReceive((v: string) => setVersion(v));
    }
    
    // Calculate time watched
    if (settings.timeWatched) {
      const hours = Math.floor(settings.timeWatched / 3600);
      const minutes = Math.floor((settings.timeWatched % 3600) / 60);
      setTimeWatched(`${hours}h ${minutes}m`);
    }
  });

  // Update initial tab when props change
  createEffect(() => {
    if (props.initialTab) {
      setActiveTab(props.initialTab);
    }
  });

  // Fetch Anki decks when Anki is enabled
  const fetchAnkiDecks = async () => {
    if (!localSettings().use_anki) return;
    
    try {
      const response = await fetch(localSettings().ankiConnectUrl || 'http://127.0.0.1:8765', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deckNamesAndIds', version: 6 }),
      });
      const data = await response.json();
      if (data.result) {
        setAnkiDecks(Object.keys(data.result));
      }
    } catch (e) {
      console.error('Failed to fetch Anki decks:', e);
    }
  };

  // Update a local setting
  const updateLocal = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    
    // Check if restart is required
    if (['language', 'use_anki', 'ankiConnectUrl'].includes(key)) {
      setRequiresRestart(true);
    }
  };

  // Save all settings
  const handleSave = () => {
    updateSettings(localSettings());
    saveSettings();
    
    if (requiresRestart() && window.mLearnIPC) {
      if (confirm('Some settings require a restart. Restart now?')) {
        window.mLearnIPC.send('restart-app-force', {});
      }
    }
    
    props.onClose();
  };

  // Restore defaults
  const handleRestoreDefaults = () => {
    if (confirm('Are you sure you want to restore default settings?')) {
      // This would reset to DEFAULT_SETTINGS
      window.mLearnIPC?.send('restore-defaults', {});
      props.onClose();
    }
  };

  // Reset SRS data
  const handleResetSRS = () => {
    if (confirm('Are you sure you want to reset all flashcard SRS data? This cannot be undone.')) {
      window.mLearnIPC?.send('reset-flashcards', {});
      alert('SRS Flashcard data was reset successfully.');
    }
  };

  // Open language installation window
  const handleInstallLanguages = () => {
    window.mLearnIPC?.send('open-window', { type: 'language-installation' });
  };

  // Render settings input based on type
  const renderSettingInput = (key: string) => {
    const value = (localSettings() as any)[key];
    
    switch (key) {
      // Numeric inputs
      case 'known_ease_threshold':
        return (
          <div class="setting-row">
            <label>Known Ease Threshold</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 2000}
              onInput={(e) => updateLocal('known_ease_threshold', parseInt(e.currentTarget.value))}
            />
          </div>
        );
      
      case 'blur_amount':
        return (
          <Show when={localSettings().blur_words || localSettings().blur_known_subtitles}>
            <div class="setting-row">
              <label>Blur Amount (px)</label>
              <input
                type="number"
                class="glass-input"
                value={value ?? 5}
                onInput={(e) => updateLocal('blur_amount', parseInt(e.currentTarget.value))}
              />
            </div>
          </Show>
        );

      case 'subtitle_font_size':
        return (
          <div class="setting-row">
            <label>Subtitle Font Size (px)</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 40}
              min={12}
              max={100}
              onInput={(e) => updateLocal('subtitle_font_size', parseInt(e.currentTarget.value))}
            />
          </div>
        );

      case 'subtitle_font_weight':
        return (
          <div class="setting-row">
            <label>Subtitle Font Weight</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 300}
              step={100}
              min={100}
              max={900}
              onInput={(e) => updateLocal('subtitle_font_weight', parseInt(e.currentTarget.value))}
            />
          </div>
        );

      case 'maxNewCardsPerDay':
        return (
          <div class="setting-row">
            <label>Max New Cards Per Day</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 10}
              min={0}
              onInput={(e) => updateLocal('maxNewCardsPerDay', parseInt(e.currentTarget.value))}
            />
          </div>
        );

      case 'proportionOfExamCards':
        return (
          <div class="setting-row">
            <label>Proportion of Exam Cards (0-1)</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 0.5}
              step={0.1}
              min={0}
              max={1}
              onInput={(e) => updateLocal('proportionOfExamCards', parseFloat(e.currentTarget.value))}
            />
            <span class="hint">0.5 = 50% exam cards, 0 = only video words</span>
          </div>
        );

      case 'preparedExam':
        return (
          <div class="setting-row">
            <label>Prepared Exam Level</label>
            <select
              class="glass-select"
              value={value ?? 3}
              onChange={(e) => updateLocal('preparedExam', parseInt(e.currentTarget.value))}
            >
              <option value={1}>N5</option>
              <option value={2}>N4</option>
              <option value={3}>N3</option>
              <option value={4}>N2</option>
              <option value={5}>N1</option>
            </select>
          </div>
        );

      case 'ocr_crop_padding':
        return (
          <div class="setting-row">
            <label>Flashcard Snapshot Crop Padding</label>
            <input
              type="number"
              class="glass-input"
              value={value ?? 200}
              onInput={(e) => updateLocal('ocr_crop_padding', parseInt(e.currentTarget.value))}
            />
          </div>
        );

      // Boolean toggles
      case 'blur_words':
        return (
          <div class="setting-row toggle">
            <label>Blur Unknown Words</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => updateLocal('blur_words', e.currentTarget.checked)}
            />
          </div>
        );

      case 'blur_known_subtitles':
        return (
          <div class="setting-row toggle">
            <label>Blur Known Subtitles</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => updateLocal('blur_known_subtitles', e.currentTarget.checked)}
            />
          </div>
        );

      case 'immediateFetch':
        return (
          <div class="setting-row toggle">
            <label>Translate All Words Immediately</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => updateLocal('immediateFetch', e.currentTarget.checked)}
            />
            <span class="hint">Requires fast internet or local dictionary</span>
          </div>
        );

      case 'do_colour_known':
        return (
          <div class="setting-row toggle">
            <label>Color Known Words</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('do_colour_known', e.currentTarget.checked)}
            />
          </div>
        );

      case 'colour_known':
        return (
          <Show when={localSettings().do_colour_known}>
            <div class="setting-row">
              <label>Known Word Color</label>
              <input
                type="color"
                value={value ?? '#cceec9'}
                onInput={(e) => updateLocal('colour_known', e.currentTarget.value)}
              />
            </div>
          </Show>
        );

      case 'do_colour_codes':
        return (
          <div class="setting-row toggle">
            <label>Color Code by Part of Speech</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('do_colour_codes', e.currentTarget.checked)}
            />
          </div>
        );

      case 'show_pos':
        return (
          <div class="setting-row toggle">
            <label>Show Part of Speech</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('show_pos', e.currentTarget.checked)}
            />
          </div>
        );

      case 'hover_known_get_from_dictionary':
        return (
          <div class="setting-row toggle">
            <label>Find New Definitions for Known Words</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => updateLocal('hover_known_get_from_dictionary', e.currentTarget.checked)}
            />
          </div>
        );

      case 'furigana':
        return (
          <div class={`setting-row toggle ${isSettingFixed('furigana') ? 'disabled' : ''}`}>
            <label>Show Furigana</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('furigana', e.currentTarget.checked)}
              disabled={isSettingFixed('furigana')}
            />
            <Show when={isSettingFixed('furigana')}>
              <span class="hint">Not available for this language</span>
            </Show>
          </div>
        );

      case 'openAside':
        return (
          <div class="setting-row toggle">
            <label>Open Auto Translation Drawer</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('openAside', e.currentTarget.checked)}
            />
            <span class="hint">Requires fast internet or local dictionary</span>
          </div>
        );

      case 'showPitchAccent':
        return (
          <div class={`setting-row toggle ${isSettingFixed('showPitchAccent') ? 'disabled' : ''}`}>
            <label>Show Pitch Accent</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('showPitchAccent', e.currentTarget.checked)}
              disabled={isSettingFixed('showPitchAccent')}
            />
            <Show when={isSettingFixed('showPitchAccent')}>
              <span class="hint">Not available for this language</span>
            </Show>
          </div>
        );

      case 'devMode':
        return (
          <div class="setting-row toggle">
            <label>Developer Mode</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => {
                if (e.currentTarget.checked) {
                  alert('Warning! Developer Mode is for development only.');
                }
                updateLocal('devMode', e.currentTarget.checked);
              }}
            />
          </div>
        );

      case 'dark_mode':
        return (
          <div class="setting-row toggle">
            <label>Dark Mode</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('dark_mode', e.currentTarget.checked)}
            />
          </div>
        );

      case 'use_anki':
        return (
          <div class="setting-row toggle">
            <label>Use Anki (Requires Restart)</label>
            <input
              type="checkbox"
              checked={value ?? false}
              onChange={(e) => {
                updateLocal('use_anki', e.currentTarget.checked);
                if (e.currentTarget.checked) {
                  fetchAnkiDecks();
                }
              }}
            />
          </div>
        );

      case 'enable_flashcard_creation':
        return (
          <Show when={localSettings().use_anki}>
            <div class="setting-row toggle">
              <label>Enable Anki Flashcard Creation</label>
              <input
                type="checkbox"
                checked={value ?? false}
                onChange={(e) => updateLocal('enable_flashcard_creation', e.currentTarget.checked)}
              />
            </div>
          </Show>
        );

      case 'flashcards_add_picture':
        return (
          <Show when={localSettings().use_anki && localSettings().enable_flashcard_creation}>
            <div class="setting-row toggle">
              <label>Add Video Thumbnail to Flashcards</label>
              <input
                type="checkbox"
                checked={value ?? true}
                onChange={(e) => updateLocal('flashcards_add_picture', e.currentTarget.checked)}
              />
            </div>
          </Show>
        );

      case 'createUnseenCards':
        return (
          <div class="setting-row toggle">
            <label>Fill Remaining Cards with Unseen Exam Cards</label>
            <input
              type="checkbox"
              checked={value ?? true}
              onChange={(e) => updateLocal('createUnseenCards', e.currentTarget.checked)}
            />
          </div>
        );

      // Text inputs
      case 'ankiConnectUrl':
        return (
          <Show when={localSettings().use_anki}>
            <div class="setting-row">
              <label>Anki Connect URL (Requires Restart)</label>
              <input
                type="text"
                class="glass-input"
                value={value ?? 'http://127.0.0.1:8765'}
                onInput={(e) => updateLocal('ankiConnectUrl', e.currentTarget.value)}
              />
            </div>
          </Show>
        );

      // Select inputs
      case 'language':
        return (
          <div class="setting-row">
            <label>Subtitle Language (Requires Restart)</label>
            <select
              class="glass-select"
              value={value ?? 'ja'}
              onChange={(e) => updateLocal('language', e.currentTarget.value)}
            >
              <option value="ja">Japanese</option>
              <option value="de">German</option>
            </select>
          </div>
        );

      case 'subtitleTheme':
        return (
          <div class="setting-row">
            <label>Subtitle Theme</label>
            <select
              class="glass-select"
              value={value ?? 'shadow'}
              onChange={(e) => updateLocal('subtitleTheme', e.currentTarget.value as SubtitleTheme)}
            >
              <For each={[...SUBTITLE_THEMES]}>
                {(theme) => <option value={theme}>{theme}</option>}
              </For>
            </select>
          </div>
        );

      case 'flashcard_deck':
        return (
          <Show when={localSettings().use_anki}>
            <div class="setting-row">
              <label>Flashcard Deck</label>
              <select
                class="glass-select"
                value={value ?? ''}
                onChange={(e) => updateLocal('flashcard_deck', e.currentTarget.value)}
              >
                <For each={ankiDecks()}>
                  {(deck) => <option value={deck}>{deck}</option>}
                </For>
              </select>
              <GlassBtn size="sm" onClick={fetchAnkiDecks}>
                Refresh Decks
              </GlassBtn>
            </div>
          </Show>
        );

      case 'anki_field_expression':
      case 'anki_field_reading':
      case 'anki_field_meaning':
        return (
          <Show when={localSettings().use_anki}>
            <div class="setting-row">
              <label>
                Anki Field: {key.replace('anki_field_', '').charAt(0).toUpperCase() + key.slice(12)}
              </label>
              <select
                class="glass-select"
                value={value ?? ''}
                onChange={(e) => updateLocal(key as keyof Settings, e.currentTarget.value)}
              >
                <For each={ankiFields()}>
                  {(field) => <option value={field}>{field}</option>}
                </For>
              </select>
            </div>
          </Show>
        );

      // Action buttons
      case 'install_languages':
        return (
          <div class="setting-row">
            <GlassBtn onClick={handleInstallLanguages}>
              Install Additional Languages...
            </GlassBtn>
          </div>
        );

      case 'restoreDefaults':
        return (
          <div class="setting-row">
            <GlassBtn variant="danger" onClick={handleRestoreDefaults}>
              Restore Defaults
            </GlassBtn>
          </div>
        );

      case 'save':
        return (
          <div class="setting-row">
            <GlassBtn variant="primary" onClick={handleSave}>
              Save Settings
            </GlassBtn>
          </div>
        );

      case 'resetSRS':
        return (
          <div class="setting-row">
            <GlassBtn variant="danger" onClick={handleResetSRS}>
              Reset Flashcard SRS Data
            </GlassBtn>
          </div>
        );

      default:
        return null;
    }
  };

  // Render category content
  const renderCategoryContent = (category: CategoryName) => {
    if (category === 'Stats') {
      return (
        <div class="stats-content">
          <div class="stat-item">
            <span class="stat-label">Time Watched</span>
            <span class="stat-value">{timeWatched()}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Words Learned</span>
            <span class="stat-value">{wordsLearned()}</span>
          </div>
          
          <div class="stats-charts">
            <canvas id="learned-words-pie-chart" width="300" height="200" />
            <canvas id="exam-stats" width="400" height="300" />
          </div>
          
          <div class="stats-actions">
            <GlassBtn onClick={() => window.mLearnIPC?.send(IPC_CHANNELS.OPEN_WORD_DB_EDITOR, {})}>
              Edit Word Database
            </GlassBtn>
            <GlassBtn onClick={() => window.mLearnIPC?.send(IPC_CHANNELS.OPEN_KANJI_GRID, {})}>
              Open Kanji Grid
            </GlassBtn>
          </div>
        </div>
      );
    }

    if (category === 'About') {
      return (
        <div class="about-content">
          <div class="about-logo">🎬</div>
          <h2>mLearn</h2>
          <p class="version">Version {version()}</p>
          <p>
            Developed by <a href="#" onClick={() => window.mLearnIPC?.send('show-contact', {})}>Adrian Vlasov</a>
          </p>
          <p>Contact: admin@morisinc.net</p>
          <div class="about-links">
            <a href="#" onClick={() => window.open('licenses.html', 'LicensesWindow', 'width=800,height=600')}>
              View Licenses
            </a>
          </div>
        </div>
      );
    }

    if (category === 'Customization') {
      return (
        <div class="customization-content">
          {/* Subtitle preview */}
          <div class="subtitle-preview">
            <div class={`subtitles theme-${localSettings().subtitleTheme || 'shadow'}`}>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-noun)' }}>A</span>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-verb)' }}>a</span>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-noun)' }}>あア</span>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-adj)' }}>億</span>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-noun)' }}>ыЦ</span>
              <span class="subtitle_word" style={{ color: 'var(--color-pos-verb)' }}>è</span>
            </div>
          </div>
          
          <For each={SETTINGS_CATEGORIES.Customization}>
            {(key) => renderSettingInput(key)}
          </For>
          
          {/* Color code settings when enabled */}
          <Show when={localSettings().do_colour_codes}>
            <div class="color-codes">
              <h4>Part of Speech Colors</h4>
              {/* Color code inputs would go here */}
            </div>
          </Show>
        </div>
      );
    }

    // Default category rendering - two column layout like old app
    const categoryKeys = SETTINGS_CATEGORIES[category];
    return (
      <div class="settings-list">
        <For each={categoryKeys}>
          {(key) => renderSettingInput(key)}
        </For>
      </div>
    );
  };

  return (
    <GlassModal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Settings"
      size="xl"
      fullHeight
    >
      <div class="settings-outer">
        {/* Navigation bar at top - matches old .nav style with icons */}
        <nav class="settings-nav">
          <For each={Object.keys(SETTINGS_CATEGORIES) as CategoryName[]}>
            {(category) => (
              <button
                class={`nav-item ${activeTab() === category ? 'selected' : ''}`}
                onClick={() => setActiveTab(category)}
              >
                <img class="nav-icon" src={CATEGORY_ICONS[category]} alt={category} />
                <span class="nav-label">{CATEGORY_NAMES[category]}</span>
              </button>
            )}
          </For>
        </nav>

        {/* Content area with scrolling */}
        <div class="settings-container">
          <div class="settings-content">
            {renderCategoryContent(activeTab())}
          </div>
        </div>
      </div>

      {/* Footer with save/cancel */}
      <div class="settings-footer">
        <Show when={requiresRestart()}>
          <span class="restart-warning">⚠️ Some changes require restart</span>
        </Show>
        <GlassBtn onClick={props.onClose}>Cancel</GlassBtn>
        <GlassBtn variant="primary" onClick={handleSave}>
          Save
        </GlassBtn>
      </div>
    </GlassModal>
  );
};

// Also need to import IPC_CHANNELS
import { IPC_CHANNELS } from '../../../shared/constants';

export default SettingsModal;
