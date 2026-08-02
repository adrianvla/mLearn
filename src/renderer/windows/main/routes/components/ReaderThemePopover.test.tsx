// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

const updateSettingsMock = vi.fn();
let mockSupportsReadings = true;

const testSettings: Record<string, unknown> = {
  readerTextSize: 1.05,
  readerTextFontStyle: 'language',
  readerTextTheme: 'paper',
  readingAnnotationMoreContrast: false,
  readingAnnotationSizePercent: 100,
  readerTextFontFamily: '',
  readerTextFontWeight: 400,
};

const translations: Record<string, string> = {
  'mlearn.Reader.Themes.Button': 'Themes & Settings',
  'mlearn.Reader.Themes.FontSize': 'Text size',
  'mlearn.Reader.Themes.FontStyle': 'Font',
  'mlearn.Reader.Themes.CustomFont': 'Custom font',
  'mlearn.Reader.Themes.CustomFontDefault': 'System default',
  'mlearn.Reader.Themes.FontWeight': 'Font weight',
  'mlearn.Reader.Themes.FontWeightOptions.Regular': 'Regular',
  'mlearn.Reader.Themes.FontWeightOptions.Medium': 'Medium',
  'mlearn.Reader.Themes.FontWeightOptions.SemiBold': 'Semi-bold',
  'mlearn.Reader.Themes.FontWeightOptions.Bold': 'Bold',
  'mlearn.Reader.Themes.Original': 'Original',
  'mlearn.Reader.Themes.Paper': 'Paper',
  'mlearn.Reader.Themes.Calm': 'Calm',
  'mlearn.Reader.Themes.Quiet': 'Quiet',
  'mlearn.Reader.Themes.Night': 'Night',
  'mlearn.Reader.Themes.Focus': 'Focus',
  'mlearn.Settings.Reader.TextAppearance.Font.Options.Language': 'Language default',
  'mlearn.Settings.Reader.TextAppearance.Font.Options.Sans': 'Sans',
  'mlearn.Settings.Reader.TextAppearance.Font.Options.Serif': 'Serif',
  'mlearn.Settings.Reader.TextAppearance.Font.Options.Mono': 'Mono',
  'mlearn.Settings.Reader.TextAppearance.Font.Options.Custom': 'Custom…',
  'mlearn.Settings.ReadingAppearance.MoreContrast.Label': 'More contrast in reading text',
  'mlearn.Settings.ReadingAppearance.Size.Label': 'Reading size',
};

vi.mock('../../../../context', () => ({
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
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
    currentLangData: () => null,
    getLanguageFeatures: () => ({ supportsReadings: mockSupportsReadings }),
  }),
}));

vi.mock('../../../../services/systemFonts', () => ({
  listInstalledSystemFonts: vi.fn(async () => [{ family: 'Test Font' }]),
}));

import { ReaderThemePopover } from './ReaderThemePopover';

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

const panel = () => document.body.querySelector('.reader-theme-popover');

describe('ReaderThemePopover', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  let open: () => boolean;
  let setOpen: (v: boolean) => void;
  let onCloseMock: ReturnType<typeof vi.fn<() => void>>;
  let triggerRef: HTMLButtonElement | undefined;

  const mount = () => {
    dispose = render(() => (
      <ReaderThemePopover
        open={open}
        onClose={onCloseMock}
        anchor={() => triggerRef}
      />
    ), container);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    [open, setOpen] = createSignal(false);
    onCloseMock = vi.fn<() => void>();
    updateSettingsMock.mockReset();
    mockSupportsReadings = true;
    triggerRef = undefined;
  });

  afterEach(() => {
    dispose?.();
    container.remove();
    document.body.querySelectorAll('.popover-panel').forEach((el) => {
      el.remove();
    });
  });

  it('is closed by default and does not render the panel', () => {
    mount();
    expect(panel()).toBeNull();
    expect(document.body.textContent).not.toContain('Text size');
  });

  it('opens and renders the panel contents when open flips to true', () => {
    mount();
    setOpen(true);
    expect(panel()).not.toBeNull();
    expect(panel()?.getAttribute('role')).toBe('dialog');
    expect(document.body.textContent).toContain('Text size');
    expect(document.body.textContent).toContain('Font');
    expect(document.body.textContent).toContain('ああ');
  });

  it('renders all six theme tiles with their names', () => {
    setOpen(true);
    mount();
    const tiles = document.body.querySelectorAll('.theme-tile');
    expect(tiles).toHaveLength(6);
    for (const name of ['Original', 'Paper', 'Calm', 'Quiet', 'Night', 'Focus']) {
      expect(document.body.textContent).toContain(name);
    }
  });

  it('marks the current theme tile as active', () => {
    setOpen(true);
    mount();
    const active = document.body.querySelector('.theme-tile.active');
    expect(active).not.toBeNull();
    expect(active?.className).toContain('theme-tile-paper');
  });

  it('marks the original tile active when the setting is missing', () => {
    delete testSettings.readerTextTheme;
    setOpen(true);
    mount();
    const active = document.body.querySelector('.theme-tile.active');
    expect(active?.className).toContain('theme-tile-original');
    testSettings.readerTextTheme = 'paper';
  });

  it('calls updateSettings with an increased clamped size on A+', () => {
    setOpen(true);
    mount();
    const buttons = document.body.querySelectorAll('.reader-theme-popover button');
    const increase = Array.from(buttons).find((b) => b.textContent?.includes('A+'));
    click(increase!);
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextSize: 1.1 });
  });

  it('calls updateSettings with a decreased clamped size on A−', () => {
    testSettings.readerTextSize = 1.05;
    setOpen(true);
    mount();
    const buttons = document.body.querySelectorAll('.reader-theme-popover button');
    const decrease = Array.from(buttons).find((b) => b.textContent?.includes('A−'));
    click(decrease!);
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextSize: 1.0 });
  });

  it('clamps A+ at 1.6', () => {
    testSettings.readerTextSize = 1.6;
    setOpen(true);
    mount();
    const buttons = document.body.querySelectorAll('.reader-theme-popover button');
    const increase = Array.from(buttons).find((b) => b.textContent?.includes('A+'));
    click(increase!);
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextSize: 1.6 });
  });

  it('shows the current size as a percentage between the stepper buttons', () => {
    testSettings.readerTextSize = 1.05;
    setOpen(true);
    mount();
    expect(document.body.textContent).toContain('105%');
  });

  it('calls updateSettings with the selected font style on Select change', () => {
    setOpen(true);
    mount();
    const select = document.body.querySelector('select') as HTMLSelectElement;
    select.value = 'serif';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextFontStyle: 'serif' });
  });

  it('offers a custom font style option', () => {
    setOpen(true);
    mount();
    const select = document.body.querySelector('select') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toContain('Custom…');
  });

  it('shows the custom-family row with the current family when the custom style is active', async () => {
    testSettings.readerTextFontStyle = 'custom';
    testSettings.readerTextFontFamily = 'Test Font';
    setOpen(true);
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const selects = document.body.querySelectorAll('.reader-theme-popover select');
    expect(document.body.textContent).toContain('Custom font');
    const familySelect = selects[1] as HTMLSelectElement;
    expect(familySelect.value).toBe('Test Font');
    testSettings.readerTextFontStyle = 'language';
    testSettings.readerTextFontFamily = '';
  });

  it('calls updateSettings with the chosen family on custom-family change', async () => {
    testSettings.readerTextFontStyle = 'custom';
    setOpen(true);
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const selects = document.body.querySelectorAll('.reader-theme-popover select');
    const familySelect = selects[1] as HTMLSelectElement;
    familySelect.value = 'Test Font';
    familySelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextFontFamily: 'Test Font' });
    testSettings.readerTextFontStyle = 'language';
  });

  it('shows the current font weight in the weight row', async () => {
    testSettings.readerTextFontWeight = 600;
    setOpen(true);
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const selects = document.body.querySelectorAll('.reader-theme-popover select');
    const weightSelect = selects[1] as HTMLSelectElement;
    expect(weightSelect.value).toBe('600');
    testSettings.readerTextFontWeight = 400;
  });

  it('calls updateSettings with the selected font weight on change', () => {
    setOpen(true);
    mount();
    const selects = document.body.querySelectorAll('.reader-theme-popover select');
    const weightSelect = selects[1] as HTMLSelectElement;
    weightSelect.value = '700';
    weightSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextFontWeight: 700 });
  });

  it('calls updateSettings with the theme id on tile click', () => {
    setOpen(true);
    mount();
    const night = document.body.querySelector('.theme-tile-night') as HTMLButtonElement;
    click(night);
    expect(updateSettingsMock).toHaveBeenCalledWith({ readerTextTheme: 'night' });
  });

  it('shows reading-appearance controls when the language supports readings', () => {
    setOpen(true);
    mount();
    expect(document.body.textContent).toContain('More contrast in reading text');
    expect(document.body.textContent).toContain('Reading size');
    expect(document.body.textContent).toContain('100%');
  });

  it('hides reading-appearance controls when the language has no reading annotations', () => {
    mockSupportsReadings = false;
    setOpen(true);
    mount();
    expect(document.body.textContent).not.toContain('More contrast in reading text');
    expect(document.body.textContent).not.toContain('Reading size');
  });

  it('calls updateSettings when the more-contrast toggle is clicked', () => {
    setOpen(true);
    mount();
    const toggle = document.body.querySelector('.toggle-switch input[type="checkbox"]') as HTMLInputElement;
    click(toggle);
    expect(updateSettingsMock).toHaveBeenCalledWith({ readingAnnotationMoreContrast: true });
  });

  it('calls updateSettings with the reading size on slider input', () => {
    setOpen(true);
    mount();
    const slider = document.body.querySelector('.reader-theme-reading-size input[type="range"]') as HTMLInputElement;
    slider.value = '120';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ readingAnnotationSizePercent: 120 });
  });

  it('closes on Escape', () => {
    setOpen(true);
    mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('closes on outside pointerdown', () => {
    setOpen(true);
    mount();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('does not close on pointerdown inside the panel', () => {
    setOpen(true);
    mount();
    const p = panel() as HTMLElement;
    p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).not.toHaveBeenCalled();
  });
});
