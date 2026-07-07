// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageDataMap } from '../../../../shared/types';

const updateSettingsMock = vi.fn();
const startInstallMock = vi.fn();

const testSettings = {
  llmEnabled: true,
  ocrEnabled: true,
  voiceEnabled: false,
};

let testLangData: LanguageDataMap = {
  ja: {
    name: 'Japanese',
    settings: { fixed: {} },
    runtime: {
      ocr: {
        recognitionEngine: 'mangaocr',
      },
      tts: {
        engine: 'kokoro',
        kokoroLangCode: 'j',
      },
      stt: {
        whisperLanguage: 'ja',
      },
    },
  },
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
  'mlearn.ComponentsTab.Groups.Voice.Description': 'Speech recognition (STT), synthesis (TTS), and voice activity detection (VAD). Models are auto-selected based on your hardware.',
  'mlearn.ComponentsTab.Groups.Dictionaries.Title': 'Installed dictionaries',
  'mlearn.ComponentsTab.Groups.Dictionaries.Description': 'Downloaded dictionary packs available on this computer.',
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
  'mlearn.ComponentsTab.Items.GenericOCR.Title': '{engine} OCR runtime',
  'mlearn.ComponentsTab.Items.GenericOCR.Description': 'OCR runtime declared by installed language data.',
  'mlearn.ComponentsTab.Items.WhisperSmall.Title': 'Whisper STT engine',
  'mlearn.ComponentsTab.Items.WhisperSmall.Description': 'Local speech recognition for voice conversations. Uses MLX acceleration on Apple Silicon, faster-whisper on other platforms.',
  'mlearn.ComponentsTab.Items.KokoroTts.Title': 'Kokoro TTS model',
  'mlearn.ComponentsTab.Items.KokoroTts.Description': 'Fast lightweight text-to-speech (82M) for everyday narration.',
  'mlearn.ComponentsTab.Items.SileroVad.Title': 'Silero VAD model',
  'mlearn.ComponentsTab.Items.SileroVad.Description': 'Voice activity detection for hands-free calls. Runs via ONNX runtime for low latency.',
  'mlearn.ComponentsTab.Items.QwenTts.Title': 'Qwen3 TTS model',
  'mlearn.ComponentsTab.Items.QwenTts.Description': 'Voice cloning and expressive text-to-speech (0.6B). Higher quality, slower than Kokoro.',
  'mlearn.ComponentsTab.Items.GenericTTS.Title': '{engine} TTS runtime',
  'mlearn.ComponentsTab.Items.GenericTTS.Description': 'Speech synthesis runtime declared by installed language data.',
  'mlearn.ComponentsTab.Items.DictionaryPack.Description': 'Definitions for {language}.',
  'mlearn.Installer.Buttons.Installing': 'Installing...',
  'mlearn.Installer.Alerts.NetworkError': 'Network error',
  'mlearn.Installer.Status.CouldNotStart': 'Could not start installation.',
};

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translation = translations[key] ?? key;
      return translation.replace(/\{(\w+)\}/g, (_, name) => (
        params?.[name] === undefined ? `{${name}}` : String(params[name])
      ));
    },
  }),
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
  }),
  useLanguage: () => ({
    langData: testLangData,
    languageDataCatalog: () => [
      {
        language: 'ja',
        name: 'Japanese',
        nameTranslated: '日本語',
        installed: true,
        missingRequiredAssets: [],
        dictionaryPacks: [
          { targetLanguage: 'en', name: 'Japanese -> English', installed: true },
          { targetLanguage: 'fr', name: 'Japanese -> French', installed: false },
        ],
      },
    ],
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
    testLangData = {
      ja: {
        name: 'Japanese',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'mangaocr',
          },
          tts: {
            engine: 'kokoro',
            kokoroLangCode: 'j',
          },
          stt: {
            whisperLanguage: 'ja',
          },
        },
      },
    };
  });

  afterEach(() => {
    container.remove();
  });

  it('lists individual installed model/runtime components without raw installer localization keys', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('Built-in chat model runtime');
    expect(container.textContent).toContain('MangaOCR model');
    expect(container.textContent).not.toContain('PaddleOCR models');
    expect(container.textContent).not.toContain('RapidOCR models');
    expect(container.textContent).toContain('Whisper STT engine');
    expect(container.textContent).toContain('Installed dictionaries');
    expect(container.textContent).toContain('Japanese -> English');
    expect(container.textContent).toContain('Definitions for 日本語.');
    expect(container.textContent).not.toContain('Japanese -> French');
    expect(container.textContent).not.toContain('mlearn.Installer.Components');
    expect(container.textContent).not.toContain('mlearn.ComponentsTab');

    dispose();
  });

  it('lists only OCR engines declared by installed language metadata', async () => {
    testLangData = {
      ja: {
        name: 'Japanese',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'rapidocr',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('RapidOCR models');
    expect(container.textContent).not.toContain('PaddleOCR models');
    expect(container.textContent).not.toContain('MangaOCR model');

    dispose();
  });

  it('lists multiple declared OCR engines from installed language metadata', async () => {
    testLangData = {
      de: {
        name: 'German',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'rapidocr',
          },
        },
      },
      ja: {
        name: 'Japanese',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'mangaocr',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('RapidOCR models');
    expect(container.textContent).toContain('MangaOCR model');
    expect(container.textContent).not.toContain('PaddleOCR models');

    dispose();
  });

  it('detects OCR components from installed local metadata even when absent from the catalog', async () => {
    testLangData = {
      xx: {
        name: 'Example Language',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'mangaocr',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('MangaOCR model');

    dispose();
  });

  it('shows future OCR engines declared by installed language metadata', async () => {
    testLangData = {
      ar: {
        name: 'Arabic',
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'arabic-transformer-ocr',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('Arabic Transformer OCR runtime');
    expect(container.textContent).toContain('OCR runtime declared by installed language data.');

    dispose();
  });

  it('shows future TTS engines declared by installed language metadata', async () => {
    testLangData = {
      ar: {
        name: 'Arabic',
        settings: { fixed: {} },
        runtime: {
          tts: {
            engine: 'arabic-tts-adapter',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('Arabic TTS Adapter TTS runtime');
    expect(container.textContent).toContain('Speech synthesis runtime declared by installed language data.');

    dispose();
  });

  it('normalizes variant qwen3 TTS engine names to a single Qwen3 entry', async () => {
    testLangData = {
      ja: {
        name: 'Japanese',
        settings: { fixed: {} },
        runtime: {
          tts: {
            engine: 'qwen3-tts',
            qwen3LanguageName: 'ja',
          },
          stt: {
            whisperLanguage: 'ja',
          },
        },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const text = container.textContent ?? '';
    const qwenMatches = text.match(/Qwen3 TTS model/gu) ?? [];
    expect(qwenMatches.length).toBe(1);

    dispose();
  });

  it('only lists TTS runtimes declared by installed language metadata', async () => {
    testLangData = {
      de: {
        name: 'German',
        settings: { fixed: {} },
      },
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).not.toContain('Kokoro TTS model');
    expect(container.textContent).not.toContain('Qwen3 TTS model');
    expect(container.textContent).not.toContain('Whisper STT engine');
    expect(container.textContent).not.toContain('Silero VAD model');

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
