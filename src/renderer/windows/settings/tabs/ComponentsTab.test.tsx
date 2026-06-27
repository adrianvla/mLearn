// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const updateSettingsMock = vi.fn();
const startInstallMock = vi.fn();

const testSettings = {
  llmEnabled: true,
  ocrEnabled: true,
  voiceEnabled: false,
};

const translations: Record<string, string> = {
  'mlearn.Settings.Tabs.Components': 'Components',
  'mlearn.ComponentsTab.Description': 'Review installed components individually.',
  'mlearn.ComponentsTab.Reinstall': 'Reinstall Components',
  'mlearn.ComponentsTab.RestartNote': 'The app will restart after installation completes.',
  'mlearn.ComponentsTab.Enabled': 'Enabled',
  'mlearn.ComponentsTab.Disabled': 'Disabled',
  'mlearn.ComponentsTab.Groups.AI.Title': 'AI components',
  'mlearn.ComponentsTab.Groups.AI.Description': 'Local model runtime and Python model tooling.',
  'mlearn.ComponentsTab.Groups.Reader.Title': 'Reader and OCR components',
  'mlearn.ComponentsTab.Groups.Reader.Description': 'Image text recognition models used by reader OCR.',
  'mlearn.ComponentsTab.Groups.Voice.Title': 'Voice components',
  'mlearn.ComponentsTab.Groups.Voice.Description': 'Speech recognition, speech synthesis, and voice activity detection.',
  'mlearn.ComponentsTab.Items.BuiltinChatRuntime.Title': 'Built-in chat model runtime',
  'mlearn.ComponentsTab.Items.BuiltinChatRuntime.Description': 'Runs downloaded GGUF chat models locally.',
  'mlearn.ComponentsTab.Items.TransformersSupport.Title': 'Transformers and PyTorch support',
  'mlearn.ComponentsTab.Items.TransformersSupport.Description': 'Python model dependencies used by legacy local LLM tooling.',
  'mlearn.ComponentsTab.Items.RapidOCR.Title': 'RapidOCR models',
  'mlearn.ComponentsTab.Items.RapidOCR.Description': 'Fast OCR recognition for reader screenshots.',
  'mlearn.ComponentsTab.Items.PaddleOCR.Title': 'PaddleOCR models',
  'mlearn.ComponentsTab.Items.PaddleOCR.Description': 'Accurate OCR recognition and detection models.',
  'mlearn.ComponentsTab.Items.MangaOCR.Title': 'MangaOCR model',
  'mlearn.ComponentsTab.Items.MangaOCR.Description': 'Japanese manga and vertical-text recognition.',
  'mlearn.ComponentsTab.Items.WhisperSmall.Title': 'Whisper small STT model',
  'mlearn.ComponentsTab.Items.WhisperSmall.Description': 'Local speech-to-text for voice conversations.',
  'mlearn.ComponentsTab.Items.KokoroTts.Title': 'Kokoro TTS model',
  'mlearn.ComponentsTab.Items.KokoroTts.Description': 'Local text-to-speech for supported languages.',
  'mlearn.ComponentsTab.Items.SileroVad.Title': 'Silero VAD model',
  'mlearn.ComponentsTab.Items.SileroVad.Description': 'Voice activity detection for hands-free calls.',
  'mlearn.ComponentsTab.Items.QwenTts.Title': 'Qwen3 TTS model',
  'mlearn.ComponentsTab.Items.QwenTts.Description': 'Optional local voice cloning and multilingual TTS.',
  'mlearn.Installer.Buttons.Installing': 'Installing...',
  'mlearn.Installer.Alerts.NetworkError': 'Network error',
  'mlearn.Installer.Status.CouldNotStart': 'Could not start installation.',
};

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    installer: {
      startInstall: startInstallMock,
    },
  }),
}));

vi.mock('../../../components/common', () => ({
  Panel: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={props.onClick} disabled={props.disabled}>{props.children}</button>
  ),
  AlertBanner: (props: { title?: string; message?: string }) => (
    <div>{props.title}{props.message}</div>
  ),
}));

describe('ComponentsTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
    startInstallMock.mockReset();
    testSettings.llmEnabled = true;
    testSettings.ocrEnabled = true;
    testSettings.voiceEnabled = false;
  });

  afterEach(() => {
    container.remove();
  });

  it('lists individual installed model/runtime components without raw installer localization keys', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('Built-in chat model runtime');
    expect(container.textContent).toContain('PaddleOCR models');
    expect(container.textContent).toContain('Whisper small STT model');
    expect(container.textContent).not.toContain('mlearn.Installer.Components');

    dispose();
  });

  it('keeps group toggles wired to reinstall options', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    toggles[2].checked = true;
    toggles[2].dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateSettingsMock).toHaveBeenCalledWith({ voiceEnabled: true });

    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === 'Reinstall Components');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(startInstallMock).toHaveBeenCalledWith({
      includeLLM: true,
      includeOCR: true,
      includeVoice: false,
    });

    dispose();
  });
});
