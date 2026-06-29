// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';

const cleanup = () => undefined;

const translations: Record<string, string> = {
  'mlearn.Installer.Instructions.ClickToBegin': 'Click Install to begin.',
  'mlearn.Installer.Status.NotStarted': 'Waiting to start installation...',
  'mlearn.Installer.Status.Complete': 'Installation complete! Choose your language to finish setup.',
  'mlearn.Installer.Status.InstallingLanguageData': 'Installing language data...',
  'mlearn.Installer.Status.Installing': 'Installing, please wait...',
  'mlearn.Installer.Instructions.ChooseComponents': 'Choose what you want to learn and how mLearn should speak to you.',
  'mlearn.Installer.Instructions.LanguageUnlocks': 'Language data is installed only after you explicitly request it.',
  'mlearn.Installer.Instructions.ForgetSomething': 'If you forget to install something, delete mLearn and restart the installer again.',
  'mlearn.Installer.Instructions.DownloadNote': 'All downloads are handled automatically. A stable connection is recommended.',
  'mlearn.Installer.SetupSentence.LearnPrefix': 'I want to learn',
  'mlearn.Installer.SetupSentence.AppLanguagePrefix': 'with mLearn in',
  'mlearn.Installer.SetupSentence.AppLanguageSuffix': '.',
  'mlearn.Installer.SetupSentence.DictionaryPrefix': 'Dictionary definitions should be in',
  'mlearn.Installer.Advanced.Title': 'Advanced',
  'mlearn.Installer.Summary.LearningLanguage': 'Learning language: {language}',
  'mlearn.Installer.Summary.DisplayLanguage': 'Display language: {language}',
  'mlearn.Installer.Summary.DictionaryLanguage': 'Dictionary language: {language}',
  'mlearn.Installer.Summary.NotAvailable': 'not available',
  'mlearn.Installer.DictionaryTarget.Label': 'Dictionary language',
  'mlearn.Installer.DictionaryTarget.ChooseAvailable': 'Choose an available dictionary language',
  'mlearn.Installer.DictionaryTarget.Unavailable': 'No {language} dictionary is available. Choose one of: {available}.',
  'mlearn.Installer.Components.ExplainAi.Title': 'Install mLearn Explain AI Module',
  'mlearn.Installer.Components.ExplainAi.Description': 'Explain AI',
  'mlearn.Installer.Components.Reader.Title': 'Install mLearn Reader Module',
  'mlearn.Installer.Components.Reader.Description': 'Reader',
  'mlearn.Installer.Components.Voice.Title': 'Install Voice & TTS Module',
  'mlearn.Installer.Components.Voice.Description': 'Voice',
  'mlearn.Installer.Buttons.StartInstallation': 'Start Installation',
  'mlearn.Installer.Buttons.Installing': 'Installing...',
  'mlearn.Installer.Buttons.Continue': 'Continue',
  'mlearn.Installer.Buttons.InstallLanguageData': 'Install Selected Language Data',
  'mlearn.Installer.Buttons.FinishSetup': 'Finish Setup',
  'mlearn.Installer.Alerts.NetworkError': 'Network error',
  'mlearn.LocaleNames.en': 'English',
  'mlearn.LocaleNames.de': 'German',
  'mlearn.LocaleNames.fr': 'French',
};

type TestSettings = {
  language: string;
  uiLanguage?: string;
  dictionaryTargetLanguages?: Record<string, string>;
  llmEnabled?: boolean;
  ocrEnabled?: boolean;
};

type LanguageRecord = Record<string, { name: string; name_translated?: string }>;
type LanguageDataStatus = {
  language: string;
  name: string;
  installed: boolean;
  missingRequiredAssets: string[];
  dictionaryPacks?: Array<{ targetLanguage: string; name: string; installed: boolean }>;
};

let testSettings: TestSettings;
let testLanguages: LanguageRecord;
let languageDataCatalog: () => LanguageDataStatus[];
let setLanguageDataCatalog: (value: LanguageDataStatus[]) => LanguageDataStatus[];
let installerStateHandler: ((state: { success?: boolean; inProgress?: boolean; waiting?: boolean; options?: { includeLLM?: boolean; includeOCR?: boolean; includeVoice?: boolean } }) => void) | undefined;
let settingsHandler: ((settings: TestSettings) => void) | undefined;
const saveSettingsMock = vi.fn();
const updateSettingsMock = vi.fn();
const installLanguageDataMock = vi.fn();
const changeLanguageMock = vi.fn();

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translation = translations[key] ?? key;
      return translation.replace(/\{(\w+)\}/g, (_, name) => (
        params?.[name] === undefined ? `{${name}}` : String(params[name])
      ));
    },
    changeLanguage: changeLanguageMock,
    isLoaded: () => true,
  }),
  useLanguage: () => ({
    langData: testLanguages,
    supportedLanguages: () => Object.keys(testLanguages),
    languageDataCatalog,
    getLanguageDataStatus: (language: string) => languageDataCatalog().find((status) => status.language === language),
    installLanguageData: installLanguageDataMock,
    languageDataInstallError: () => null,
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    installer: {
      startInstall: vi.fn(),
      onPythonSuccess: vi.fn(() => cleanup),
      onPipProgress: vi.fn(() => cleanup),
      onInstallStarted: vi.fn(() => cleanup),
      onInstallerAwaitingChoice: vi.fn(() => cleanup),
      onInstallerNetworkError: vi.fn(() => cleanup),
      onInstallerState: vi.fn((callback: typeof installerStateHandler) => {
        installerStateHandler = callback;
        return cleanup;
      }),
      requestInstallerState: vi.fn(),
    },
    server: {
      onServerStatusUpdate: vi.fn(() => cleanup),
      isSuccess: vi.fn(),
      forceRestartApp: vi.fn(),
    },
    settings: {
      saveSettings: saveSettingsMock,
      onSettingsSaved: vi.fn(() => cleanup),
      onSettings: vi.fn((callback: typeof settingsHandler) => {
        settingsHandler = callback;
        return cleanup;
      }),
      getSettings: vi.fn(),
    },
  }),
}));

vi.mock('../../components/common', () => ({
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
  Btn: (props: { children?: JSX.Element; disabled?: boolean; onClick?: () => void; class?: string }) => (
    <button class={props.class} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  SelectableCard: (props: { selected?: boolean; onClick?: () => void; title: string; subtitle?: string; icon?: JSX.Element }) => (
    <div role="button" aria-pressed={props.selected} onClick={props.onClick}>
      {props.icon}
      <span>{props.title}</span>
      <span>{props.subtitle}</span>
    </div>
  ),
  AlertBanner: (props: { title?: string; message?: string }) => <div>{props.title}{props.message}</div>,
  LogConsole: (props: { title?: string; logs?: Array<{ message: string }> }) => (
    <div>
      <div>{props.title}</div>
      {props.logs?.map((entry) => <div data-testid="log-entry">{entry.message}</div>)}
    </div>
  ),
  CheckboxCard: (props: { title: string; description: string }) => <div>{props.title}{props.description}</div>,
  ProgressBar: () => <div>progress</div>,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { options?: Array<{ value: string; label: string }>; placeholder?: string }) => (
    <select {...props}>
      {props.placeholder ? <option value="" disabled>{props.placeholder}</option> : null}
      {props.options?.map((option) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('../../../shared/bridges/bundledLanguageAssets', () => ({
  getBundledLocaleCodes: () => ['en', 'de', 'fr'],
}));

describe('WelcomeApp', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    testSettings = { language: 'fr' };
    testLanguages = {
      ja: { name: 'Japanese', name_translated: '日本語' },
      de: { name: 'German', name_translated: 'Deutsch' },
    };
    [languageDataCatalog, setLanguageDataCatalog] = createSignal([
      { language: 'ja', name: 'Japanese', installed: true, missingRequiredAssets: [] },
      {
        language: 'de',
        name: 'German',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [{ targetLanguage: 'en', name: 'German -> English', installed: false }],
      },
    ]);
    installerStateHandler = undefined;
    settingsHandler = undefined;
    saveSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    installLanguageDataMock.mockReset();
    changeLanguageMock.mockReset();
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 1 as unknown as ReturnType<typeof setTimeout>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('shows only languages that are actually supported by language data before installation starts', async () => {
    testLanguages = {};

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Japanese');
      expect(container.textContent).toContain('German');
      expect(container.textContent).not.toContain('Chinese');
      expect(container.textContent).not.toContain('Coming soon');
    });

    dispose();
  });

  it('disables continue when installation completes without any supported languages', async () => {
    testLanguages = {};
    setLanguageDataCatalog([]);

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      const continueButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Finish Setup'));
      expect(continueButton).toBeTruthy();
      expect(continueButton?.disabled).toBe(true);
    });

    dispose();
  });

  it('does not keep the pre-localization placeholder or duplicate completion logs', async () => {
    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('mlearn.Installer.Instructions.ClickToBegin');
      const logMessages = Array.from(container.querySelectorAll('[data-testid="log-entry"]'))
        .map((entry) => entry.textContent);
      expect(logMessages).toEqual(['Installation complete! Choose your language to finish setup.']);
    });

    dispose();
  });

  it('does not install language data automatically when Python installation completes', async () => {
    setLanguageDataCatalog([
      {
        language: 'ja',
        name: 'Japanese',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [{ targetLanguage: 'en', name: 'Japanese -> English', installed: false }],
      },
      {
        language: 'de',
        name: 'German',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [{ targetLanguage: 'en', name: 'German -> English', installed: false }],
      },
    ]);

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Install Selected Language Data');
    });
    expect(installLanguageDataMock).not.toHaveBeenCalled();

    dispose();
  });

  it('keeps dictionary language in advanced options and summarizes the selected languages', async () => {
    setLanguageDataCatalog([
      {
        language: 'ja',
        name: 'Japanese',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [
          { targetLanguage: 'en', name: 'Japanese -> English', installed: false },
          { targetLanguage: 'de', name: 'Japanese -> German', installed: false },
        ],
      },
      {
        language: 'de',
        name: 'German',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [{ targetLanguage: 'en', name: 'German -> English', installed: false }],
      },
    ]);

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Learning language: Japanese');
      expect(container.textContent).toContain('Display language: English');
      expect(container.textContent).toContain('Dictionary language: Japanese→English');
    });

    const advanced = container.querySelector('details.welcome-window__advanced') as HTMLDetailsElement | null;
    expect(advanced).toBeTruthy();
    expect(advanced?.open).toBe(false);

    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(3);
    selects[1]!.value = 'de';
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(changeLanguageMock).toHaveBeenCalledWith('de');
      expect(container.textContent).toContain('Display language: German');
      expect(container.textContent).toContain('Dictionary language: Japanese→German');
    });

    dispose();
  });

  it('opens advanced options and blocks install when the display-language dictionary is unavailable', async () => {
    setLanguageDataCatalog([
      {
        language: 'ja',
        name: 'Japanese',
        installed: false,
        missingRequiredAssets: ['language-metadata'],
        dictionaryPacks: [
          { targetLanguage: 'en', name: 'Japanese -> English', installed: false },
          { targetLanguage: 'de', name: 'Japanese -> German', installed: false },
        ],
      },
    ]);

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Dictionary language: Japanese→English');
    });

    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(3);
    selects[1]!.value = 'fr';
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      const advanced = container.querySelector('details.welcome-window__advanced') as HTMLDetailsElement | null;
      expect(advanced?.open).toBe(true);
      expect(container.textContent).toContain('No French dictionary is available. Choose one of: Japanese -> English, Japanese -> German.');
      expect(container.textContent).toContain('Dictionary language: Japanese→not available');
    });

    let continueButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Install Selected Language Data'));
    expect(continueButton?.disabled).toBe(true);
    continueButton?.click();
    expect(installLanguageDataMock).not.toHaveBeenCalled();

    selects[2]!.value = 'de';
    selects[2]!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      continueButton = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Install Selected Language Data'));
      expect(continueButton?.disabled).toBe(false);
      expect(container.textContent).toContain('Dictionary language: Japanese→German');
    });

    continueButton?.click();
    expect(installLanguageDataMock).toHaveBeenCalledWith('ja', 'de');
    expect(installLanguageDataMock).not.toHaveBeenCalledWith('ja', 'en');

    dispose();
  });

  it('installs only the selected language data before saving settings and restarting', async () => {
    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    const languageSelect = container.querySelector('select');
    expect(languageSelect).toBeDefined();
    languageSelect!.value = 'de';
    languageSelect!.dispatchEvent(new Event('change', { bubbles: true }));

    let continueButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      continueButton = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Install Selected Language Data'));
      expect(continueButton).toBeDefined();
      expect(continueButton?.disabled).toBe(false);
    });
    continueButton?.click();

    expect(installLanguageDataMock).toHaveBeenCalledWith('de', 'en');
    expect(installLanguageDataMock).not.toHaveBeenCalledWith('ja');
    expect(updateSettingsMock).not.toHaveBeenCalled();

    setLanguageDataCatalog([
      { language: 'ja', name: 'Japanese', installed: true, missingRequiredAssets: [] },
      {
        language: 'de',
        name: 'German',
        installed: true,
        missingRequiredAssets: [],
        dictionaryPacks: [{ targetLanguage: 'en', name: 'German -> English', installed: true }],
      },
    ]);

    await vi.waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
        language: 'de',
        uiLanguage: 'en',
        dictionaryTargetLanguages: { de: 'en' },
      }));
    });

    dispose();
  });
});
