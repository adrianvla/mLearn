// @vitest-environment happy-dom

/**
 * The Settings window is one window, and it used to hold four independently
 * authored ways to ask "are you sure?".
 *
 * Observed in the running app before this existed, on a 449-card profile:
 *   General > Reset Settings      -> window.confirm, an OS window outside the
 *                                    web contents that no screenshot shows
 *   General > Import All Data     -> window.confirm, then a *second* OS dialog
 *                                    raised from the main process, then a
 *                                    third native alert
 *   SRS > Reset SRS Data          -> Modal + type "RESET"
 *   SRS > Delete All Flashcards   -> Modal + type "DELETE"
 *   Guardian > Restore a point    -> an OS dialog only, never seen in the
 *                                    window that asked for it
 *
 * The strength was inversely related to the blast radius: the action that
 * replaces the entire profile asked the least, and the two that only reset
 * scheduling asked the most.
 *
 * These render the real tabs and assert the app's own ConfirmDialog is in the
 * way for every destructive control, that the two SRS controls have become one
 * mechanism, and that cancelling changes nothing. An implementation that calls
 * the domain operation without gating fails here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { Component } from 'solid-js';

const resetSRS = vi.fn();
const nukeAllFlashcards = vi.fn();
const dataImport = vi.fn().mockResolvedValue({ success: true });
const restartApp = vi.fn();
const saveSettings = vi.fn();
const showToast = vi.fn();
const restoreRecoveryPoint = vi.fn().mockResolvedValue({ success: false });

let cardCount = 449;
/** Passive knowledge a profile can accumulate from reading without any cards. */
let knowledgeCount = 0;

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      uiLanguage: 'en', language: 'ja', dictionaryTargetLanguages: {},
      colorScheme: 'quartz', devMode: false, anki_model_name: '', anki_field_expression: '',
      anki_field_reading: '', anki_field_meaning: '', srs_new_per_day: 20, srs_max_reviews: 200,
      srs_learning_steps: '[1,10]', srs_easy_interval: 4, srs_easy_bonus: 1.3, srs_interval_modifier: 1,
      srs_max_interval: 365, srs_min_ease: 1.3, srs_starting_ease: 2.5, srs_hard_multiplier: 1.2,
      srs_learning_step_seconds: '[1, 10]', llmBulkExampleBatchSize: 5, flashcardAutoGenerateAudio: false,
      ttsProvider: 'system', custom_tts_url: '', custom_tts_voice: '', custom_tts_api_key: '',
      enable_anki: false, ttsSpeed: 1, anki_url: '', dailyNewCards: 20, frequencyLevels: false,
    },
    updateSettings: vi.fn(),
    saveSettings,
    isSettingManaged: () => false,
  }),
  useLocalization: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (!params) return key;
    return `${key} [${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')}]`;
  } }),
  useFlashcards: () => ({
    store: {
      flashcards: Object.fromEntries(Array.from({ length: cardCount }, (_, i) => [`c${i}`, { id: `c${i}` }])),
      wordKnowledge: Object.fromEntries(Array.from({ length: knowledgeCount }, (_, i) => [`k${i}`, {}])),
      grammarKnowledge: {},
      dailyStats: {},
      wordCandidates: {},
      knownUntracked: {},
      wordStatsMap: {},
      meta: { perLanguage: {}, maxNewCardsPerDayLearning: 20, maxReviewsPerDay: 200 },
    },
    updateMeta: vi.fn(),
    resetSRS,
    nukeAllFlashcards,
    recomputeWordKnowledgeFromEvidence: vi.fn(),
  }),
  useLanguage: () => ({
    langData: {},
    supportedLanguages: () => ['ja'],
    languageDataCatalog: () => [],
    getLanguageDataStatus: () => undefined,
    installLanguageData: vi.fn(),
    isLanguageDataInstalling: () => false,
    languageDataInstallError: () => null,
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false }),
    currentLangData: () => undefined,
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    settings: { onSettingsSaved: () => () => {} },
    server: { restartBackend: vi.fn(), restartApp },
    data: {
      dataExport: vi.fn().mockResolvedValue({ success: true }),
      dataImport,
      getProtectionStatus: vi.fn().mockResolvedValue({ state: 'ready', recoveryPoints: 1 }),
      listRecoveryPoints: vi.fn().mockResolvedValue([
        { id: 'snapshot-00000001', createdAt: 1_700_000_000_000, cards: 12, rooms: 2, participants: 3 },
      ]),
      restoreRecoveryPoint,
    },
  }),
}));
// Partial: SRSTab reaches the real OCR hook through the settings context, and
// that hook needs the platform helpers this file does not stub.
// Anki is not the subject here, but useAnki reads the real settings context
// at construction, so it cannot be left unmocked in a tab that renders.
vi.mock('../../hooks/useAnki', () => ({
  useAnki: () => ({
    checkConnection: vi.fn(async () => false),
    getDecks: vi.fn(async () => []),
    getModels: vi.fn(async () => []),
    getModelFields: vi.fn(async () => ['Expression']),
    testNote: vi.fn(),
    status: () => 'unchecked',
  }),
}));
vi.mock('../../services/ankiReviewImport', () => ({ importAnkiReviewHistory: vi.fn() }));

vi.mock('../../../shared/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/platform')>()),
  isElectron: () => true,
}));
vi.mock('../../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
  updateToast: vi.fn(),
  removeToast: vi.fn(),
}));

vi.mock('../../components/common', async () => {
  const passthrough: Component<Record<string, unknown>> = (props) => (props?.children ?? null) as never;
  const Button: Component<Record<string, unknown>> = (props) => (
    <button type="button" disabled={Boolean(props?.disabled)} onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
      {props?.children as never}
    </button>
  );
  const Select: Component<Record<string, unknown>> = (props) => (
    <select
      value={props?.value as string}
      onChange={(e) => (props?.onChange as ((e: unknown) => void) | undefined)?.(e)}
    >
      {((props?.options ?? []) as { value: string; label: string }[]).map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  );
  // Renders the label and description too: the tests find a control by the row
  // that describes it, which is how a user finds it.
  const SettingRow: Component<Record<string, unknown>> = (props) => (
    <div class="setting-row">
      <span class="setting-label">{props?.label as never}</span>
      <span class="setting-description">{props?.description as never}</span>
      {(props?.managedControl ?? null) as never}
      {(props?.children ?? null) as never}
    </div>
  );
  // The real modal machinery: the ConfirmDialog is the mechanism under test,
  // so replacing it with a stub would test nothing.
  const modal = await vi.importActual<typeof import('../../components/common/Modal')>('../../components/common/Modal');
  return {
    useConfirmDialog: modal.useConfirmDialog,
    Modal: modal.Modal,
    Button,
    Select,
    Input: passthrough,
    Textarea: passthrough,
    SettingRow,
    SettingGroup: passthrough,
    TabContent: passthrough,
    ToggleSwitch: passthrough,
    SettingsIcon: passthrough,
    LanguageVariantGate: () => null,
    VoiceSamplePicker: passthrough,
    SafeHtml: passthrough,
  };
});

vi.mock('../SettingsForm.css', () => ({}));
vi.mock('../../tabs/AnkiFieldPreview.css', () => ({}));

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const dialog = () => document.querySelector('[role=dialog]');
const dialogText = () => dialog()?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const dialogButton = (label: string) => {
  const root = dialog();
  if (!root) return null;
  return Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) ?? null;
};
const clickRowButton = (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label);
  if (!button) throw new Error(`no button labelled ${label}`);
  button.click();
};

describe('Settings: every destructive control asks through the same dialog', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    document.querySelectorAll('[role=dialog]').forEach((d) => d.remove());
    cardCount = 449;
    knowledgeCount = 0;
    resetSRS.mockClear();
    nukeAllFlashcards.mockClear();
    dataImport.mockClear().mockResolvedValue({ success: true });
    restartApp.mockClear();
    saveSettings.mockClear();
    showToast.mockClear();
    restoreRecoveryPoint.mockClear().mockResolvedValue({ success: false });
    // Any raw browser prompt that survives this consolidation fails the test
    // by never being resolvable from the page under test.
    vi.stubGlobal('confirm', vi.fn(() => { throw new Error('window.confirm was used'); }));
    vi.stubGlobal('alert', vi.fn(() => { throw new Error('window.alert was used'); }));
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('[role=dialog]').forEach((d) => d.remove());
    vi.unstubAllGlobals();
  });

  it('gates Reset Settings on a dialog inside the window, and cancelling resets nothing', async () => {
    const { GeneralTab } = await import('./tabs/GeneralTab');
    const dispose = render(() => <GeneralTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Global.Reset');
    await flush();

    expect(dialog()).not.toBeNull();
    expect(dialogText()).toContain('mlearn.Settings.Data.ResetSettings.Confirm');
    // Not a red button: the previous values are still on screen behind it.
    expect(dialogButton('mlearn.Global.Reset')).not.toBeNull();

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();

    expect(saveSettings).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    dispose();
  });

  it('gates Import All Data on a prompt that names the recovery point it creates', async () => {
    const { GeneralTab } = await import('./tabs/GeneralTab');
    const dispose = render(() => <GeneralTab />, container);
    await flush();

    const rows = Array.from(container.querySelectorAll('.setting-row'));
    const importRow = rows.find((row) => row.textContent?.includes('mlearn.Settings.Data.ImportAllData.Label'))!;
    (Array.from(importRow.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'mlearn.Global.Import'))!.click();
    await flush();

    // The copy used to claim "this will overwrite all your current data" with
    // no mention that a recovery point is being kept, while one was.
    expect(dialogText()).toContain('mlearn.Settings.Data.ImportAllData.Confirm');
    // The verb names the operation. The dialog's danger default is "Delete",
    // which would tell the learner the run removes things.
    expect(dialogButton('mlearn.Settings.Data.ImportAllData.ConfirmAction')).not.toBeNull();

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();

    expect(dataImport).not.toHaveBeenCalled();
    expect(restartApp).not.toHaveBeenCalled();
    dispose();
  });

  it('imports only after the learner agrees, and reports it with a toast rather than an alert', async () => {
    const { GeneralTab } = await import('./tabs/GeneralTab');
    const dispose = render(() => <GeneralTab />, container);
    await flush();

    const rows = Array.from(container.querySelectorAll('.setting-row'));
    const importRow = rows.find((row) => row.textContent?.includes('mlearn.Settings.Data.ImportAllData.Label'))!;
    (Array.from(importRow.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'mlearn.Global.Import'))!.click();
    await flush();
    dialogButton('mlearn.Settings.Data.ImportAllData.ConfirmAction')!.click();
    await flush();

    expect(dataImport).toHaveBeenCalledOnce();
    expect(restartApp).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'mlearn.Settings.Data.ImportAllData.Success', variant: 'success' }),
    );
    dispose();
  });

  it('gates a recovery-point restore on a prompt that names the point being restored', async () => {
    const { GeneralTab } = await import('./tabs/GeneralTab');
    const dispose = render(() => <GeneralTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.Data.Guardian.View');
    await flush();
    clickRowButton(container, 'mlearn.Settings.Data.Guardian.Restore');
    await flush();

    // The date that identifies the point moved from a row-only format into the
    // prompt, so a user can see which snapshot they are about to swap in.
    expect(dialogText()).toContain('mlearn.Settings.Data.Guardian.ConfirmMessage');
    expect(dialogText()).toContain('[date=Nov 14, 2023');

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
    dispose();
  });

  it('gates Reset SRS on the shared dialog instead of a typed phrase', async () => {
    const { SRSTab } = await import('./tabs/SRSTab');
    const dispose = render(() => <SRSTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.SRS.DataManagement.ResetButton');
    await flush();

    expect(dialog()).not.toBeNull();
    expect(dialogText()).toContain('mlearn.Settings.SRS.DataManagement.ResetSRS.Confirm');
    // The phrase gate is gone: the body carries what the phrase used to.
    expect(dialogText()).not.toContain('mlearn.Settings.SRS.DataManagement.ResetSRS.TypePhrase');
    expect(container.querySelector('input[placeholder]')).toBeNull();

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();
    expect(resetSRS).not.toHaveBeenCalled();
    dispose();
  });

  it('gates Delete All Flashcards on the same dialog, and cancels nothing', async () => {
    const { SRSTab } = await import('./tabs/SRSTab');
    const dispose = render(() => <SRSTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.SRS.DataManagement.NukeButton');
    await flush();

    expect(dialogText()).toContain('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Confirm');
    expect(dialogText()).not.toContain('mlearn.Settings.SRS.DataManagement.NukeFlashcards.TypePhrase');

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();
    expect(nukeAllFlashcards).not.toHaveBeenCalled();
    dispose();
  });

  it('deletes every card once the learner agrees to the irreversible prompt', async () => {
    const { SRSTab } = await import('./tabs/SRSTab');
    const dispose = render(() => <SRSTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.SRS.DataManagement.NukeButton');
    await flush();
    dialogButton('mlearn.Settings.SRS.DataManagement.NukeButton')!.click();
    await flush();

    expect(nukeAllFlashcards).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Success', variant: 'success' }),
    );
    dispose();
  });

  it('does not ask a learner to confirm destroying a profile that has nothing in it', async () => {
    cardCount = 0;
    knowledgeCount = 0;
    const { SRSTab } = await import('./tabs/SRSTab');
    const dispose = render(() => <SRSTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.SRS.DataManagement.NukeButton');
    await flush();

    // A dialog listing everything it is about to destroy, on a profile with
    // nothing to destroy, only teaches the user to click through the next one.
    expect(dialog()).toBeNull();
    expect(nukeAllFlashcards).toHaveBeenCalledOnce();
    dispose();
  });

  it('still asks when the cards are gone but the knowledge they were built from is not', async () => {
    cardCount = 0;
    // `nukeAllFlashcards` reconciles the store back to a fresh one, so it takes
    // the passive word knowledge a year of reading built up. Counting only the
    // cards would skip the prompt on exactly the profile where the loss is
    // invisible in the UI.
    knowledgeCount = 120;
    const { SRSTab } = await import('./tabs/SRSTab');
    const dispose = render(() => <SRSTab />, container);
    await flush();

    clickRowButton(container, 'mlearn.Settings.SRS.DataManagement.NukeButton');
    await flush();

    expect(dialogText()).toContain('mlearn.Settings.SRS.DataManagement.NukeFlashcards.Confirm');
    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();
    expect(nukeAllFlashcards).not.toHaveBeenCalled();
    dispose();
  });
});
