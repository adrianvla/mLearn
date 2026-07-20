// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createStore, reconcile, type SetStoreFunction } from 'solid-js/store';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

const updateSettingsMock = vi.fn();
let settings: Settings;
let setSettings: SetStoreFunction<Settings>;
let supportsReadings = true;
let readingDisplay: 'ruby' | 'inline' | 'replace' = 'ruby';
let supportsColoredProsody = false;

const translations: Record<string, string> = {
  'mlearn.Settings.Groups.ReadingAppearance': 'Reading text',
  'mlearn.Settings.ReadingAppearance.MoreContrast.Label': 'More contrast in reading text',
  'mlearn.Settings.ReadingAppearance.MoreContrast.Description': 'Use the primary text color for reading annotations',
  'mlearn.Settings.ReadingAppearance.Size.Label': 'Reading size',
  'mlearn.Settings.ReadingAppearance.Size.Description': 'Adjust reading annotations relative to their default size',
  'mlearn.Settings.ReadingAppearance.Preview.Surface': 'Example',
  'mlearn.Settings.ReadingAppearance.Preview.Reading': 'reading',
  'mlearn.Settings.Groups.ColoredProsody': 'Colored Prosody',
  'mlearn.Settings.ColoredProsody.Enabled.Label': 'Colored prosody',
  'mlearn.Settings.ColoredProsody.Enabled.Description': 'Overrides POS colors',
  'mlearn.Settings.ColoredProsody.StatusLimit.Label': 'Color through status',
  'mlearn.Settings.ColoredProsody.StatusLimit.Description': 'Use POS above this status',
  'mlearn.Settings.ColoredProsody.StatusLimit.Learning': 'Learning',
  'mlearn.Settings.ColoredProsody.StatusLimit.Known': 'Known',
  'mlearn.Settings.ColoredProsody.EaseMix.Label': 'Fade colors by ease',
  'mlearn.Settings.ColoredProsody.EaseMix.Description': 'Fade known words',
  'mlearn.Settings.ColoredProsody.MixTarget.Label': 'Fade toward',
  'mlearn.Settings.ColoredProsody.MixTarget.Description': 'Mix target',
  'mlearn.Settings.ColoredProsody.MixTarget.White': 'White',
  'mlearn.Settings.ColoredProsody.MixTarget.PartOfSpeech': 'Part-of-speech color',
  'mlearn.Settings.ColoredProsody.Saturation.Label': 'Color saturation',
  'mlearn.Settings.ColoredProsody.Saturation.Description': 'Color intensity',
  'mlearn.Settings.ColoredProsody.Palette.Description': 'Customize palette',
  'mlearn.Settings.ColoredProsody.Preview': 'Colored prosody preview',
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings,
    updateSettings: (partial: Partial<Settings>) => {
      updateSettingsMock(partial);
      setSettings(reconcile({ ...settings, ...partial }));
    },
  }),
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
  useLanguage: () => ({
    currentLangData: () => ({
      name: 'Test Language',
      prosody: supportsColoredProsody ? {
        coloring: {
          renderer: 'tone-marked-syllables',
          paletteId: 'test-tones',
          colors: { 'tone-1': '#ff00ff', neutral: '#006eff' },
          labels: { 'tone-1': 'Tone 1', neutral: 'Neutral' },
        },
      } : undefined,
      textProcessing: {
        readingAnnotation: {
          type: 'script-reading',
          display: readingDisplay,
          annotationScripts: ['Han'],
        },
      },
    }),
    getLanguageFeatures: () => ({ supportsReadings }),
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
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  ToggleSwitch: (props: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <button type="button" data-checked={props.checked ? 'true' : 'false'} onClick={() => props.onChange?.(!props.checked)} />
  ),
  RangeInput: (props: { min?: number; max?: number; step?: number; value: number; onChange: (value: number) => void }) => (
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onInput={(event) => props.onChange(Number(event.currentTarget.value))}
    />
  ),
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props}>{props.children}</select>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button>,
}));

vi.mock('../../../components/common/Icons/Icon', () => ({
  default: () => <span />,
}));

describe('CustomizationTab reading appearance', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'ja' });
    supportsReadings = true;
    readingDisplay = 'ruby';
    supportsColoredProsody = false;
    updateSettingsMock.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  it('shows capability-gated controls and updates one live preview', async () => {
    const { CustomizationTab } = await import('./CustomizationTab');
    const dispose = render(() => <CustomizationTab />, container);

    expect(container.textContent).toContain('More contrast in reading text');
    expect(container.textContent).toContain('Reading size');
    expect(container.querySelectorAll('.reading-appearance-preview')).toHaveLength(1);

    const preview = container.querySelector('.reading-appearance-preview') as HTMLElement;
    expect(preview.style.getPropertyValue('--reading-annotation-color')).toBe('var(--text-secondary)');
    expect(preview.style.getPropertyValue('--reading-annotation-scale')).toBe('1');
    expect(container.textContent).toContain('100%');

    const contrastToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('More contrast in reading text')) as HTMLButtonElement;
    contrastToggle.click();

    expect(updateSettingsMock).toHaveBeenCalledWith({ readingAnnotationMoreContrast: true });
    expect(preview.style.getPropertyValue('--reading-annotation-color')).toBe('var(--text-primary)');

    const sizeSlider = container.querySelector('input[type="range"]') as HTMLInputElement;
    sizeSlider.value = '130';
    sizeSlider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(updateSettingsMock).toHaveBeenCalledWith({ readingAnnotationSizePercent: 130 });
    expect(preview.style.getPropertyValue('--reading-annotation-scale')).toBe('1.3');
    expect(container.textContent).toContain('130%');

    dispose();
  });

  it('hides controls when the language has no separately styled reading text', async () => {
    supportsReadings = false;

    const { CustomizationTab } = await import('./CustomizationTab');
    const dispose = render(() => <CustomizationTab />, container);

    expect(container.textContent).not.toContain('More contrast in reading text');
    expect(container.querySelector('.reading-appearance-preview')).toBeNull();

    dispose();
  });

  it('hides controls for replacement-style readings', async () => {
    readingDisplay = 'replace';

    const { CustomizationTab } = await import('./CustomizationTab');
    const dispose = render(() => <CustomizationTab />, container);

    expect(container.textContent).not.toContain('More contrast in reading text');
    expect(container.querySelector('.reading-appearance-preview')).toBeNull();

    dispose();
  });

  it('shows package-driven palette and updates colored prosody controls', async () => {
    supportsReadings = false;
    supportsColoredProsody = true;

    const { CustomizationTab } = await import('./CustomizationTab');
    const dispose = render(() => <CustomizationTab />, container);

    expect(container.textContent).toContain('Colored Prosody');
    expect(container.textContent).toContain('Tone 1');
    expect(container.textContent).toContain('Neutral');
    expect(container.querySelectorAll('.pos-colors__card')).toHaveLength(2);

    const colorInput = container.querySelector<HTMLInputElement>('.pos-colors__color-input');
    expect(colorInput).not.toBeNull();
    colorInput!.value = '#123456';
    colorInput!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({
      coloredProsodyPalettes: { 'test-tones': { 'tone-1': '#123456' } },
    });

    const statusSelect = Array.from(container.querySelectorAll('select'))
      .find((select) => select.parentElement?.textContent?.includes('Color through status'))!;
    statusSelect.value = 'learning';
    statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ coloredProsodyStatusLimit: 'learning' });

    const easeToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.parentElement?.textContent?.includes('Fade colors by ease'))!;
    easeToggle.click();
    expect(updateSettingsMock).toHaveBeenCalledWith({ coloredProsodyEaseMixEnabled: true });
    expect(container.textContent).toContain('Part-of-speech color');

    const saturation = container.querySelector<HTMLInputElement>('.prosody-colors__saturation-control input');
    saturation!.value = '70';
    saturation!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ coloredProsodySaturation: 70 });

    dispose();
  });
});
