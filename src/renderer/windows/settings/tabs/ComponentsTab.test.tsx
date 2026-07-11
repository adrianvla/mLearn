// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageDataMap } from '../../../../shared/types';

const updateSettingsMock = vi.fn();
const startInstallMock = vi.fn();
const installLanguageDataMock = vi.fn();
let languageDataInstallErrorMock: { language: string; dictionaryTargetLanguage?: string; error: string } | null = null;
let managedSettingKey: string | null = null;

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
  'mlearn.ComponentsTab.Description': 'Review runtime capabilities, installed language packages, and dictionary packs separately.',
  'mlearn.ComponentsTab.Reinstall': 'Reinstall Components',
  'mlearn.ComponentsTab.RestartNote': 'The app will restart after installation completes.',
  'mlearn.ComponentsTab.InstallErrorTitle': 'Install failed',
  'mlearn.ComponentsTab.Enabled': 'Enabled',
  'mlearn.ComponentsTab.Disabled': 'Disabled',
  'mlearn.ComponentsTab.Sections.Runtime.Title': 'App runtime',
  'mlearn.ComponentsTab.Sections.Runtime.Description': 'Python-side optional capabilities.',
  'mlearn.ComponentsTab.Sections.LanguageData.Title': 'Language data',
  'mlearn.ComponentsTab.Sections.LanguageData.Description': 'Installed and available language bundles.',
  'mlearn.ComponentsTab.Actions.Install': 'Install',
  'mlearn.ComponentsTab.Actions.Update': 'Update',
  'mlearn.ComponentsTab.Actions.RepairRuntime': 'Repair runtime components',
  'mlearn.ComponentsTab.Status.installed': 'Installed',
  'mlearn.ComponentsTab.Status.missing': 'Missing',
  'mlearn.ComponentsTab.Status.outdated': 'Outdated',
  'mlearn.ComponentsTab.Status.error': 'Error',
  'mlearn.ComponentsTab.LanguageData.CoreTitle': '{language} language package',
  'mlearn.ComponentsTab.LanguageData.CoreDescription': 'Core runtime data for {language}.',
  'mlearn.ComponentsTab.LanguageData.DictionaryDescription': 'Definitions for {language} in {target}.',
  'mlearn.ComponentsTab.LanguageData.SizeStatus': '{installed} of {total}',
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
    getManagedSettingSource: (key: string) => key === managedSettingKey
      ? { sourceGroupName: 'German', sourceGroupId: 'german', locked: true, value: false }
      : null,
  }),
  useLanguage: () => ({
    langData: testLangData,
    languageDataCatalog: () => [
      {
        language: 'ja',
        name: 'Japanese',
        nameTranslated: '日本語',
        installed: true,
        outdated: false,
        totalBytes: 1024,
        installedBytes: 1024,
        missingRequiredAssets: [],
        assets: [
          {
            id: 'language-metadata',
            path: 'languages/ja.json',
            installed: true,
            sizeBytes: 1024,
          },
        ],
        dictionaryPacks: [
          {
            targetLanguage: 'en',
            name: 'Japanese -> English',
            installed: true,
            outdated: false,
            totalBytes: 4096,
            installedBytes: 4096,
            missingRequiredAssets: [],
            assets: [
              {
                id: 'dictionary',
                path: 'dictionaries/ja/en/dictionary.db',
                installed: true,
                sizeBytes: 4096,
              },
            ],
          },
          {
            targetLanguage: 'fr',
            name: 'Japanese -> French',
            installed: false,
            outdated: false,
            totalBytes: 2048,
            installedBytes: 0,
            missingRequiredAssets: ['dictionary'],
            assets: [
              {
                id: 'dictionary-fr',
                path: 'dictionaries/ja/fr/dictionary.db',
                installed: false,
                sizeBytes: 2048,
              },
            ],
          },
        ],
      },
    ],
    installLanguageData: installLanguageDataMock,
    isLanguageDataInstalling: () => false,
    languageDataInstallError: () => languageDataInstallErrorMock,
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
  ManagedSettingNotice: (props: { sourceGroupName: string }) => <span>Managed by {props.sourceGroupName}</span>,
}));

describe('ComponentsTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
    startInstallMock.mockReset();
    installLanguageDataMock.mockReset();
    languageDataInstallErrorMock = null;
    managedSettingKey = null;
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

  it('lists individual runtime and language-data components without raw installer localization keys', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    expect(container.textContent).toContain('Built-in chat model runtime');
    expect(container.textContent).toContain('MangaOCR model');
    expect(container.textContent).not.toContain('PaddleOCR models');
    expect(container.textContent).not.toContain('RapidOCR models');
    expect(container.textContent).toContain('Whisper STT engine');
    expect(container.textContent).toContain('Language data');
    expect(container.textContent).toContain('日本語 language package');
    expect(container.textContent).toContain('language-metadata');
    expect(container.textContent).toContain('Japanese -> English');
    expect(container.textContent).toContain('Japanese -> French');
    expect(container.textContent).toContain('Definitions for 日本語 in EN.');
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

  it('keeps group toggles wired to runtime repair options', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(toggles.map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
      'AI components: Enabled',
      'Reader and OCR components: Enabled',
      'Voice components: Disabled',
    ]);
    toggles[2].checked = true;
    toggles[2].dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateSettingsMock).toHaveBeenCalledWith({ voiceEnabled: true });

    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === 'Repair runtime components');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(startInstallMock).toHaveBeenCalledWith({
      includeLLM: true,
      includeOCR: true,
      includeVoice: false,
    });

    dispose();
  });

  it('disables a managed runtime toggle and identifies the source group', async () => {
    managedSettingKey = 'llmEnabled';
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(toggles[0]?.disabled).toBe(true);
    expect(container.textContent).toContain('Managed by German');

    dispose();
  });

  it('keeps a managed voice control visible without an installed voice runtime', async () => {
    testLangData = { de: { name: 'German', settings: { fixed: {} } } };
    managedSettingKey = 'voiceEnabled';
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const voiceToggle = Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .find((toggle) => toggle.getAttribute('aria-label')?.startsWith('Voice components:')) as HTMLInputElement;
    expect(voiceToggle?.disabled).toBe(true);
    dispose();
  });

  it('installs a single missing dictionary pack instead of reinstalling all components', async () => {
    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === 'Install');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(installLanguageDataMock).toHaveBeenCalledWith('ja', 'fr');
    expect(startInstallMock).not.toHaveBeenCalled();

    dispose();
  });

  it('shows dictionary install failures on the exact failed pack', async () => {
    languageDataInstallErrorMock = {
      language: 'ja',
      dictionaryTargetLanguage: 'fr',
      error: 'Checksum mismatch',
    };

    const { ComponentsTab } = await import('./ComponentsTab');
    const dispose = render(() => <ComponentsTab />, container);

    const packRows = Array.from(container.querySelectorAll('.components-tab__language-pack'));
    const englishPack = packRows.find((row) => row.textContent?.includes('Japanese -> English'));
    const frenchPack = packRows.find((row) => row.textContent?.includes('Japanese -> French'));

    expect(englishPack?.textContent).not.toContain('Checksum mismatch');
    expect(frenchPack?.textContent).toContain('Checksum mismatch');

    dispose();
  });
});
