// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const cleanup = () => undefined;

const translations: Record<string, string> = {
  'mlearn.Installer.Instructions.ClickToBegin': 'Click Install to begin.',
  'mlearn.Installer.Status.NotStarted': 'Waiting to start installation...',
  'mlearn.Installer.Status.Complete': 'Installation complete! Choose your language to finish setup.',
  'mlearn.Installer.Status.Installing': 'Installing, please wait...',
  'mlearn.Installer.Instructions.ChooseComponents': 'Choose the components you want to install, then click Install.',
  'mlearn.Installer.Instructions.LanguageUnlocks': 'Language selection unlocks after setup finishes.',
  'mlearn.Installer.Instructions.ForgetSomething': 'If you forget to install something, delete mLearn and restart the installer again.',
  'mlearn.Installer.Instructions.DownloadNote': 'All downloads are handled automatically. A stable connection is recommended.',
  'mlearn.Installer.Components.ExplainAi.Title': 'Install mLearn Explain AI Module',
  'mlearn.Installer.Components.ExplainAi.Description': 'Explain AI',
  'mlearn.Installer.Components.Reader.Title': 'Install mLearn Reader Module',
  'mlearn.Installer.Components.Reader.Description': 'Reader',
  'mlearn.Installer.Components.Voice.Title': 'Install Voice & TTS Module',
  'mlearn.Installer.Components.Voice.Description': 'Voice',
  'mlearn.Installer.Buttons.StartInstallation': 'Start Installation',
  'mlearn.Installer.Buttons.Installing': 'Installing...',
  'mlearn.Installer.Buttons.Continue': 'Continue',
  'mlearn.Installer.Alerts.NetworkError': 'Network error',
};

type TestSettings = {
  language: string;
  llmEnabled?: boolean;
  ocrEnabled?: boolean;
};

type LanguageRecord = Record<string, { name: string; name_translated?: string }>;

let testSettings: TestSettings;
let testLanguages: LanguageRecord;
let installerStateHandler: ((state: { success?: boolean; inProgress?: boolean; waiting?: boolean; options?: { includeLLM?: boolean; includeOCR?: boolean; includeVoice?: boolean } }) => void) | undefined;
let settingsHandler: ((settings: TestSettings) => void) | undefined;
const saveSettingsMock = vi.fn();
const updateSettingsMock = vi.fn();

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
  }),
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
  useLanguage: () => ({
    langData: testLanguages,
    supportedLanguages: () => Object.keys(testLanguages),
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
  LogConsole: (props: { title?: string }) => <div>{props.title}</div>,
  CheckboxCard: (props: { title: string; description: string }) => <div>{props.title}{props.description}</div>,
  ProgressBar: () => <div>progress</div>,
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
    installerStateHandler = undefined;
    settingsHandler = undefined;
    saveSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 1 as unknown as ReturnType<typeof setTimeout>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('shows only languages that are actually supported by language data after installation completes', async () => {
    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Japanese');
      expect(container.textContent).toContain('German');
      expect(container.textContent).not.toContain('Chinese');
      expect(container.textContent).not.toContain('French');
      expect(container.textContent).not.toContain('Coming soon');
    });

    dispose();
  });

  it('disables continue when installation completes without any supported languages', async () => {
    testLanguages = {};

    const { default: WelcomeApp } = await import('./App');
    const dispose = render(() => <WelcomeApp />, container);

    settingsHandler?.(testSettings);
    installerStateHandler?.({ success: true });

    await vi.waitFor(() => {
      const continueButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Continue'));
      expect(continueButton).toBeTruthy();
      expect(continueButton?.disabled).toBe(true);
    });

    dispose();
  });
});
