// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const updateSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
const restartBackendMock = vi.fn();
const onSettingsSavedMock = vi.fn();
const settingsSavedCleanupMock = vi.fn();

let settingsSavedHandler: (() => void) | undefined;

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
    settingsSavedCleanupMock.mockReset();
    settingsSavedHandler = undefined;
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
});
