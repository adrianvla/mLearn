// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const updateSettingsMock = vi.fn();
const setProsodyVisibleMock = vi.fn();

let supportsReadings = true;
let supportsProsody = false;
let prosodyMetadata = {
  type: 'none',
} as { type: string; toggleLabel?: string; toggleDescription?: string };

const testSettings = {
  ocrEnabled: true,
  ocr_crop_padding: 0,
  ocrTurboMode: true,
  ocrReadingAnnotationFiltering: true,
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'Meta',
  readerReadingAnnotationHider: false,
  readerSepiaEnabled: false,
  readerSharpenEnabled: false,
  readerMagnifierHotkey: 'm',
  readerMagnifierZoom: 2,
  readerMagnifierSize: 200,
  showLiveTranslator: true,
  liveTranslatorIncludeKnown: false,
  showReadingAnnotations: true,
  hideReadingForKnownWords: false,
  showProsody: false,
  show_pos: true,
  blur_words: false,
  blurKnownWords: false,
  blurKnownSubtitles: false,
};

const translations: Record<string, string> = {
  'mlearn.Settings.DisplayOptions.ShowReadingAnnotations.Label': 'Show reading annotations',
  'mlearn.Settings.DisplayOptions.ShowReadingAnnotations.Description': 'Display reading annotations above words',
  'mlearn.Settings.Reader.ReadingAnnotations.Title': 'Reading annotations',
  'mlearn.Settings.DisplayOptions.ShowProsody.Label': 'Show prosody and accent',
  'mlearn.Settings.DisplayOptions.ShowProsody.Description': 'Display prosody, tone, stress, or accent information for words',
  'mlearn.Settings.Reader.ReadingAnnotations.Hide.Label': 'Hide reading annotations',
  'mlearn.Settings.Reader.ReadingAnnotations.Hide.Description': 'Cover detected reading annotations with white boxes',
  'mlearn.Settings.Reader.OcrSettings.ReadingAnnotationDetection.Label': 'Reading annotation detection',
  'mlearn.Settings.Reader.OcrSettings.ReadingAnnotationDetection.Description': 'Detect and filter reading annotations from OCR results',
  'mlearn.Settings.Reader.ImageAppearance.Sepia.Label': 'Sepia',
  'mlearn.Settings.Reader.ImageAppearance.Sepia.Description': 'Apply a sepia filter to page images and thumbnails',
  'mlearn.Settings.Reader.ImageAppearance.Sharpen.Label': 'Sharpen',
  'mlearn.Settings.Reader.ImageAppearance.Sharpen.Description': 'Enhances grayscale images only. Automatically enabled while Sepia is active',
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
    showProsody: () => testSettings.showProsody,
    setProsodyVisible: setProsodyVisibleMock,
    isSettingManaged: () => false,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const value = translations[key] ?? key;
      return value.replace(/\{(\w+)\}/g, (_, name) => (
        params?.[name] === undefined ? `{${name}}` : String(params[name])
      ));
    },
  }),
  useLanguage: () => ({
    getLanguageFeatures: () => ({
      supportsReadings,
      supportsOcrRamSaver: false,
      prosodyRenderer: prosodyMetadata.type === 'none' ? undefined : prosodyMetadata.type,
      supportsProsody,
    }),
    currentLangData: () => ({
      name: 'Test Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: prosodyMetadata,
    }),
  }),
}));

vi.mock('../../../components/common', () => ({
  SettingRow: (props: { children?: JSX.Element; label?: string; description?: string }) => (
    <div>
      <span>{props.label}</span>
      <p>{props.description}</p>
      {props.children}
    </div>
  ),
  SettingGroup: (props: { children?: JSX.Element; title?: string }) => (
    <section>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
  ToggleSwitch: (props: { checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }) => (
    <button
      type="button"
      data-checked={props.checked ? 'true' : 'false'}
      disabled={props.disabled}
      onClick={() => props.onChange?.(!props.checked)}
    />
  ),
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  KeybindInput: () => <input />,
  RangeInput: () => <input type="range" />,
  Input: () => <input />,
  BookIcon: () => <span />,
  VideoIcon: () => <span />,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { options?: Array<{ value: string; label: string }> }) => (
    <select {...props}>
      {props.options?.map((option) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
  formatKeybindDisplay: (key: string) => key,
}));

describe('reading annotation settings', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
    setProsodyVisibleMock.mockReset();
    supportsReadings = true;
    supportsProsody = false;
    prosodyMetadata = { type: 'none' };
    testSettings.readerSepiaEnabled = false;
    testSettings.readerSharpenEnabled = false;
  });

  afterEach(() => {
    container.remove();
  });

  it('shows generic reading annotation controls for languages with reading support', async () => {
    const { ReaderTab } = await import('./ReaderTab');
    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => (
      <>
        <ReaderTab />
        <VideoPlayerTab />
      </>
    ), container);

    expect(container.textContent).toContain('Reading annotation detection');
    expect(container.textContent).toContain('Hide reading annotations');
    expect(container.textContent).toContain('Show reading annotations');
    expect(container.textContent).not.toContain('Furigana');

    dispose();
  });

  it('persists the reader sepia toggle through the settings context', async () => {
    const { ReaderTab } = await import('./ReaderTab');
    const dispose = render(() => <ReaderTab />, container);
    const sepiaToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('Sepia')) as HTMLButtonElement;

    expect(sepiaToggle).toBeTruthy();
    sepiaToggle.click();

    expect(updateSettingsMock).toHaveBeenCalledWith({ readerSepiaEnabled: true });

    dispose();
  });

  it('shows Sharpen as enabled but unavailable while Sepia is active', async () => {
    testSettings.readerSepiaEnabled = true;

    const { ReaderTab } = await import('./ReaderTab');
    const dispose = render(() => <ReaderTab />, container);
    const sharpenToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('Sharpen')) as HTMLButtonElement;

    expect(container.textContent).toContain('Enhances grayscale images only');
    expect(sharpenToggle).toBeTruthy();
    expect(sharpenToggle.dataset.checked).toBe('true');
    expect(sharpenToggle.disabled).toBe(true);

    dispose();
  });

  it('persists the reader Sharpen preference when Sepia is inactive', async () => {
    const { ReaderTab } = await import('./ReaderTab');
    const dispose = render(() => <ReaderTab />, container);
    const sharpenToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('Sharpen')) as HTMLButtonElement;

    expect(sharpenToggle).toBeTruthy();
    sharpenToggle.click();

    expect(updateSettingsMock).toHaveBeenCalledWith({ readerSharpenEnabled: true });

    dispose();
  });

  it('hides reading annotation controls for languages without reading support', async () => {
    supportsReadings = false;

    const { ReaderTab } = await import('./ReaderTab');
    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => (
      <>
        <ReaderTab />
        <VideoPlayerTab />
      </>
    ), container);

    expect(container.textContent).not.toContain('Reading annotation detection');
    expect(container.textContent).not.toContain('Hide reading annotations');
    expect(container.textContent).not.toContain('Show reading annotations');

    dispose();
  });

  it('uses language metadata for the prosody visibility toggle', async () => {
    supportsProsody = true;
    prosodyMetadata = {
      type: 'tone-contour',
      toggleLabel: 'Show tone contours',
      toggleDescription: 'Display tone contour markers for words',
    };

    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => <VideoPlayerTab />, container);

    expect(container.textContent).toContain('Show tone contours');
    expect(container.textContent).toContain('Display tone contour markers for words');
    expect(container.textContent).not.toContain('Show Pitch Accent');

    dispose();
  });

  it('uses generic prosody fallback copy when language metadata has no custom toggle text', async () => {
    supportsProsody = true;
    prosodyMetadata = {
      type: 'tone-contour',
    };

    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => <VideoPlayerTab />, container);

    expect(container.textContent).toContain('Show prosody and accent');
    expect(container.textContent).toContain('Display prosody, tone, stress, or accent information for words');
    expect(container.textContent).not.toContain('Pitch Accent');

    dispose();
  });

  it('updates prosody visibility through the neutral settings helper', async () => {
    supportsProsody = true;
    prosodyMetadata = {
      type: 'tone-contour',
      toggleLabel: 'Show tone contours',
      toggleDescription: 'Display tone contour markers for words',
    };

    const { VideoPlayerTab } = await import('./VideoPlayerTab');
    const dispose = render(() => <VideoPlayerTab />, container);
    const prosodyToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('Show tone contours')) as HTMLButtonElement;

    expect(prosodyToggle).toBeTruthy();
    prosodyToggle.click();

    expect(setProsodyVisibleMock).toHaveBeenCalledWith(true);
    expect(updateSettingsMock).not.toHaveBeenCalledWith({ showProsody: true });

    dispose();
  });
});
