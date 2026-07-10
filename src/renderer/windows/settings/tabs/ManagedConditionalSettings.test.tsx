// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../../shared/types';

const managedKeys = new Set<string>();
const settings = {
  ...DEFAULT_SETTINGS,
  showLiveTranslator: false,
  showReadingAnnotations: false,
  blur_words: false,
  blurKnownWords: false,
  blur_known_subtitles: false,
  readerWordHoverTrigger: 'hover' as const,
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings,
    updateSettings: vi.fn(),
    showProsody: () => false,
    setProsodyVisible: vi.fn(),
    isSettingManaged: (key: string) => managedKeys.has(key),
  }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({
    getLanguageFeatures: () => ({ supportsReadings: false, supportsProsody: false }),
    currentLangData: () => null,
  }),
}));

vi.mock('../../../components/common', () => ({
  SettingRow: (props: { children?: JSX.Element; settingKey?: string }) => (
    <div data-setting-key={props.settingKey}>{props.children}</div>
  ),
  SettingGroup: (props: { children?: JSX.Element }) => <section>{props.children}</section>,
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  ToggleSwitch: () => <input type="checkbox" />,
  Select: () => <select />,
  RangeInput: () => <input type="range" />,
  Input: () => <input />,
  KeybindInput: () => <input />,
  VideoIcon: () => <span />,
  BookIcon: () => <span />,
  formatKeybindDisplay: (value: string) => value,
}));

describe('managed conditional setting visibility', () => {
  beforeEach(() => managedKeys.clear());
  afterEach(() => document.body.replaceChildren());

  it('keeps video child settings visible when their ordinary parents are off', async () => {
    managedKeys.add('liveTranslatorIncludeKnown');
    managedKeys.add('hideReadingForKnownWords');
    managedKeys.add('blur_amount');
    managedKeys.add('showReadingAnnotations');
    managedKeys.add('showProsody');
    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => <VideoPlayerTab />, document.body);

    for (const key of managedKeys) {
      expect(document.querySelector(`[data-setting-key="${key}"]`), key).not.toBeNull();
    }
    dispose();
  });

  it('keeps the managed reader hover key visible outside key-hover mode', async () => {
    managedKeys.add('readerWordHoverKey');
    managedKeys.add('ocrReadingAnnotationFiltering');
    managedKeys.add('readerReadingAnnotationHider');
    const { ReaderTab } = await import('./ReaderTab');
    const dispose = render(() => <ReaderTab />, document.body);

    expect(document.querySelector('[data-setting-key="readerWordHoverKey"]')).not.toBeNull();
    dispose();
  });
});
