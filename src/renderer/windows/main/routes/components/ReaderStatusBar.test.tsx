// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const updateSettingsMock = vi.fn();

const testSettings = {
  ocrEnabled: true,
  ocrReadingAnnotationFiltering: true,
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'Meta',
};

const translations: Record<string, string> = {
  'mlearn.Reader.StatusBar.ShowTooltipOn': 'Show popup on',
  'mlearn.Reader.StatusBar.TriggerTitle': 'Choose trigger',
  'mlearn.Reader.StatusBar.TriggerHover': 'Hover',
  'mlearn.Reader.StatusBar.TriggerLongHover': 'Long hover',
  'mlearn.Reader.StatusBar.TriggerKeyHover': 'Hold {key}',
  'mlearn.Reader.StatusBar.OpenConversationAgent': 'AI Tutor',
  'mlearn.Reader.StatusBar.OpenConversationAgentTitle': 'Open AI tutor',
  'mlearn.Reader.StatusBar.CropModeOff': 'Crop: Off',
  'mlearn.Reader.StatusBar.CropModeOn': 'Crop: On',
  'mlearn.Reader.StatusBar.CropModeAddTitle': 'Crop add mode',
  'mlearn.Reader.StatusBar.CropModeCursorTitle': 'Cursor mode',
  'mlearn.Reader.StatusBar.CropModeTitle': 'Drag to recognize a crop',
  'mlearn.Settings.Reader.OcrSettings.ReadingAnnotationDetection.Description': 'Detect reading annotations',
  'mlearn.Reader.StatusBar.ReadingAnnotationDetectionOn': 'Reading annotations: On',
  'mlearn.Reader.StatusBar.ReadingAnnotationDetectionOff': 'Reading annotations: Off',
  'mlearn.Reader.StatusBar.Ready': 'Ready',
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
    getLanguageFeatures: () => ({
      supportsReadings: true,
    }),
  }),
  useLowPowerGate: () => ({
    isActive: () => false,
  }),
}));

vi.mock('../../../../components/common', () => ({
  StatusBar: (props: { children?: JSX.Element; class?: string }) => (
    <div class={props.class}>{props.children}</div>
  ),
  RangeInput: () => <input type="range" />,
  BatteryLowIcon: () => <span />,
  CursorPointerIcon: () => <span data-icon="cursor" />,
  PlusIcon: () => <span data-icon="plus" />,
  formatKeybindDisplay: (key: string) => key,
}));

describe('ReaderStatusBar reading annotation controls', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  it('uses generic reading annotation labels instead of Furigana labels', async () => {
    const { ReaderStatusBar } = await import('./ReaderStatusBar');
    const dispose = render(() => (
      <ReaderStatusBar
        bookTitle={() => 'Book'}
        progressString={() => '1 / 2'}
        ocrStatus={() => ''}
        ocrProgress={() => 0}
        isProcessingOcr={() => false}
        hasOcrResult={() => false}
        hasPages={() => true}
        onRunOcr={() => undefined}
        onOpenConversationAgent={() => undefined}
      />
    ), container);

    expect(container.textContent).toContain('Reading annotations: On');
    expect(container.textContent).not.toContain('Furigana');

    dispose();
  });
});
