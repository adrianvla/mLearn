import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../../shared/types';

const updateSettings = vi.fn();
const settings = {
  ...DEFAULT_SETTINGS,
  language: 'cu',
  readerTextFontStyle: 'language' as const,
  readerContentFontSelections: {} as Record<string, string>,
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings,
    updateSettings,
    isSettingManaged: () => false,
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useLanguage: () => ({
    currentLangData: () => ({
      typography: {
        contentFontFamily: "'Noto Serif', serif",
        contentFontOptions: [{
          id: 'ponomar',
          name: 'Ponomar',
          fontFamily: 'Ponomar',
          assetId: 'font-ponomar',
        }],
      },
    }),
    getLanguageFeatures: () => ({ supportsReadings: false }),
  }),
}));

vi.mock('../../../components/common', () => ({
  SettingRow: (props: { children?: JSX.Element; settingKey?: string }) => (
    <div data-setting-key={props.settingKey}>{props.children}</div>
  ),
  SettingGroup: (props: { children?: JSX.Element }) => <section>{props.children}</section>,
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { options?: Array<{ value: string; label: string }> }) => (
    <select {...props}>
      {props.options?.map((option) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  ToggleSwitch: () => <div />,
  KeybindInput: () => <div />,
  RangeInput: () => <div />,
  BookIcon: () => <div />,
  formatKeybindDisplay: (value: string) => value,
}));

import { ReaderTab } from './ReaderTab';

describe('ReaderTab language font options', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    updateSettings.mockReset();
    settings.readerContentFontSelections = {};
    dispose = render(() => <ReaderTab />, container);
  });

  afterEach(() => {
    dispose();
    container.remove();
  });

  it('shows Ponomar and stores it only for the active language', () => {
    const select = container.querySelector('[data-setting-key="readerTextFontStyle"] select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toContain('Ponomar');

    select.value = 'language-font:ponomar';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateSettings).toHaveBeenCalledWith({
      readerTextFontStyle: 'language',
      readerContentFontSelections: { cu: 'ponomar' },
    });
  });
});
