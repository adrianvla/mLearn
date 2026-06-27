// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const updateSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
const restartBackendMock = vi.fn();
const onSettingsSavedMock = vi.fn();
const settingsSavedCleanupMock = vi.fn();
const installLanguageDataMock = vi.fn();

let settingsSavedHandler: (() => void) | undefined;
let mockLanguageDataCatalog = [
  { language: 'ja', name: 'Japanese', installed: true, missingRequiredAssets: [] },
  { language: 'de', name: 'German', installed: false, missingRequiredAssets: ['dictionary'] },
];
let mockLanguageDataInstallError: { language: string; error: string } | null = null;

const testSettings = {
  uiLanguage: 'en',
  language: 'ja',
  theme: 'light',
  devMode: false,
};

const mockLangData = {
  ja: { name: 'Japanese', name_translated: '日本語' },
  de: { name: 'German', name_translated: 'Deutsch' },
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
    saveSettings: saveSettingsMock,
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useLanguage: () => ({
    langData: mockLangData,
    supportedLanguages: () => Object.keys(mockLangData),
    languageDataCatalog: () => mockLanguageDataCatalog,
    getLanguageDataStatus: (language: string) => mockLanguageDataCatalog.find((status) => status.language === language),
    installLanguageData: installLanguageDataMock,
    languageDataInstallError: () => mockLanguageDataInstallError,
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    settings: {
      onSettingsSaved: onSettingsSavedMock,
    },
    server: {
      restartBackend: restartBackendMock,
      restartApp: vi.fn(),
    },
    data: {
      dataExport: vi.fn().mockResolvedValue({ success: true }),
      dataImport: vi.fn().mockResolvedValue({ success: true }),
    },
  }),
}));

vi.mock('../../../../shared/bridges/bundledLanguageAssets', () => ({
  getBundledLocaleCodes: () => ['en', 'ja', 'de', 'fr', 'ru'],
}));

vi.mock('../../../components/common', () => ({
  SettingRow: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  SettingGroup: (props: { children?: JSX.Element }) => <section>{props.children}</section>,
  ToggleSwitch: () => <div />,
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button>,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props}>{props.children}</select>,
  SettingsIcon: () => <div />,
}));

describe('GeneralTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    restartBackendMock.mockReset();
    onSettingsSavedMock.mockReset();
    installLanguageDataMock.mockReset();
    settingsSavedCleanupMock.mockReset();
    settingsSavedHandler = undefined;
    testSettings.language = 'ja';
    mockLanguageDataCatalog = [
      { language: 'ja', name: 'Japanese', installed: true, missingRequiredAssets: [] },
      { language: 'de', name: 'German', installed: false, missingRequiredAssets: ['dictionary'] },
    ];
    mockLanguageDataInstallError = null;
    onSettingsSavedMock.mockImplementation((callback: () => void) => {
      settingsSavedHandler = callback;
      return settingsSavedCleanupMock;
    });
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it('restarts backend after learning language settings are saved', async () => {
    const { GeneralTab } = await import('./GeneralTab');
    const dispose = render(() => <GeneralTab />, container);

    const selects = Array.from(container.querySelectorAll('select'));
    const learningLanguageSelect = selects[1] as HTMLSelectElement;
    learningLanguageSelect.innerHTML = '<option value="ja">Japanese</option><option value="de">German</option>';
    learningLanguageSelect.value = 'de';
    learningLanguageSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateSettingsMock).toHaveBeenCalledWith({ language: 'de' });
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(onSettingsSavedMock).toHaveBeenCalledOnce();
    expect(restartBackendMock).not.toHaveBeenCalled();

    expect(settingsSavedHandler).toBeTypeOf('function');
    settingsSavedHandler?.();

    expect(settingsSavedCleanupMock).toHaveBeenCalledOnce();
    expect(restartBackendMock).toHaveBeenCalledOnce();
    dispose();
  });

  it('offers to install missing language data for the selected learning language', async () => {
    testSettings.language = 'de';
    const { GeneralTab } = await import('./GeneralTab');
    const dispose = render(() => <GeneralTab />, container);

    const installButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.Settings.Language.LanguageData.Install');
    expect(installButton).toBeDefined();

    installButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(installLanguageDataMock).toHaveBeenCalledWith('de');
    testSettings.language = 'ja';
    dispose();
  });
});
