// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const getFreqLevelNamesMock = vi.fn((): Record<string, string> => ({}));
const localizationMock = vi.fn((key: string) => key);
const getComprehensiveWordStatusSyncMock = vi.fn(() => 'unknown');
let currentLangDataMock: Record<string, unknown> = {};
let flashcardStoreMock: {
  wordKnowledge: Record<string, { word: string; language: string }>;
  flashcards: Record<string, { language: string; content: { front?: string; word?: string } }>;
  ignoredWords: Record<string, { word: string; language: string }>;
};
let wordFrequencyMock: Record<string, { raw_level?: number }> = {
  '日本語': { raw_level: 5 },
};
let languageMock = 'ja';

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useLanguage: () => ({
    wordFrequency: wordFrequencyMock,
    getWordFrequency: () => wordFrequencyMock,
    getFreqLevelNames: getFreqLevelNamesMock,
    getFrequency: (word: string) => wordFrequencyMock[word] ?? null,
    currentLangData: () => currentLangDataMock,
  }),
  useLocalization: () => ({
    t: localizationMock,
  }),
  useSettings: () => ({
    settings: { language: languageMock },
  }),
  useFlashcards: () => ({
    store: flashcardStoreMock,
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    isWordKnownByText: () => false,
    isWordLearningByText: () => false,
  }),
}));

vi.mock('../../components/common', () => ({
  Spinner: (props: { text?: string }) => <div>{props.text}</div>,
  PillLabel: (props: { children?: JSX.Element; class?: string; level?: number; onMouseEnter?: () => void; onMouseLeave?: () => void }) => (
    <span class={props.class} data-level={props.level} onMouseEnter={props.onMouseEnter} onMouseLeave={props.onMouseLeave}>{props.children}</span>
  ),
  LegendItem: (props: { label: string }) => <div>{props.label}</div>,
  BookIcon: () => <span>book</span>,
  AlertBanner: (props: { title?: string; message: string; class?: string }) => (
    <div class={props.class}>
      <span>{props.title}</span>
      <span>{props.message}</span>
    </div>
  ),
}));

describe('CharacterGridContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    currentLangDataMock = { hasFrequencyLevels: true };
    wordFrequencyMock = {
      '日本語': { raw_level: 5 },
    };
    languageMock = 'ja';
    getFreqLevelNamesMock.mockReturnValue({});
    getComprehensiveWordStatusSyncMock.mockReturnValue('unknown');
    flashcardStoreMock = {
      wordKnowledge: {},
      flashcards: {},
      ignoredWords: {},
    };

    localizationMock.mockImplementation((key: string) => {
      switch (key) {
        case 'mlearn.CharacterGrid.Title':
          return 'Character Knowledge Overview';
        case 'mlearn.CharacterGrid.Description':
          return 'Description';
        case 'mlearn.CharacterGrid.CharactersByLevel':
          return 'Characters by level:';
        case 'mlearn.CharacterGrid.Disclaimer.Title':
          return 'Character levels are estimated';
        case 'mlearn.CharacterGrid.Disclaimer.Description':
          return 'Level disclaimer';
        case 'mlearn.CharacterGrid.EmptyState.Title':
          return 'No tracked characters yet';
        case 'mlearn.CharacterGrid.EmptyState.Description':
          return 'Characters will appear here as you encounter them.';
        case 'mlearn.CharacterGrid.EmptyState.Hint':
          return 'Start reading.';
        case 'mlearn.CharacterGrid.Unsupported.Title':
          return 'Character study is not available';
        case 'mlearn.CharacterGrid.Unsupported.Description':
          return 'This language package does not define character-study scripts.';
        case 'mlearn.CharacterGrid.Legend.Learning':
          return 'Learning';
        case 'mlearn.CharacterGrid.Legend.Known':
          return 'Known';
        case 'mlearn.CharacterGrid.Legend.Unknown':
          return 'Unknown';
        default:
          return key;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    container.remove();
  });

  it('uses neutral character-grid DOM naming', async () => {
    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.querySelector('.character-grid-window')).not.toBeNull();
      expect(container.querySelector('.kanji-grid-window')).toBeNull();
    });

    dispose();
  });

  it('shows the level disclaimer when language metadata enables it', async () => {
    currentLangDataMock = { hasFrequencyLevels: true, characterStudy: { scripts: ['Han'], levelDisclaimer: true } };
    getFreqLevelNamesMock.mockReturnValue({ '5': 'Beginner Set' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Character levels are estimated');
      expect(container.textContent).toContain('Level disclaimer');
    });

    dispose();
  });

  it('does not infer the level disclaimer from JLPT label text', async () => {
    currentLangDataMock = { hasFrequencyLevels: true, characterStudy: { levelDisclaimer: false } };
    getFreqLevelNamesMock.mockReturnValue({ '5': 'JLPT N5' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('Character levels are estimated');
      expect(container.textContent).not.toContain('Level disclaimer');
    });

    dispose();
  });

  it('sorts level pills using the language metadata order', async () => {
    currentLangDataMock = { hasFrequencyLevels: true, characterStudy: { scripts: ['Han'], levelOrder: 'ascending' } };
    getFreqLevelNamesMock.mockReturnValue({ '3': 'Band 3', '1': 'Band 1', '2': 'Band 2' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      const levels = Array.from(container.querySelectorAll('[data-level]'))
        .map((node) => node.getAttribute('data-level'));
      expect(levels).toEqual(['1', '2', '3']);
    });

    dispose();
  });

  it('builds study characters from non-Japanese script metadata and frequency data', async () => {
    languageMock = 'ar';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      characterStudy: { scripts: ['Arab'], levelOrder: 'ascending' },
      frequencyLevels: { difficulty: 'higher-is-harder' },
    };
    wordFrequencyMock = {
      'سلام': { raw_level: 1 },
      'سفر': { raw_level: 6 },
    };
    getFreqLevelNamesMock.mockReturnValue({ '1': 'A1', '6': 'C2' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      const characters = Array.from(container.querySelectorAll('.study-character'))
        .map((node) => node.textContent);
      expect(characters).toEqual(expect.arrayContaining(['س', 'ل', 'ا', 'م', 'ف', 'ر']));
      expect(characters).not.toContain('日');
    });

    dispose();
  });

  it('uses package-defined character study labels', async () => {
    languageMock = 'ar';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      characterStudy: {
        scripts: ['Arab'],
        labels: {
          title: 'Letter Knowledge',
          description: 'Track letters from studied words.',
          byLevel: 'Letters by level:',
        },
      },
    };
    wordFrequencyMock = {
      'سلام': { raw_level: 1 },
    };
    getFreqLevelNamesMock.mockReturnValue({ '1': 'A1' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Letter Knowledge');
      expect(container.textContent).toContain('Track letters from studied words.');
      expect(container.textContent).toContain('Letters by level:');
      expect(container.textContent).not.toContain('Character Knowledge Overview');
      expect(container.textContent).not.toContain('Characters by level:');
    });

    dispose();
  });

  it('does not group frequency-only character study entries into invented levels', async () => {
    languageMock = 'ar';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      characterStudy: { scripts: ['Arab'], levelOrder: 'ascending' },
    };
    wordFrequencyMock = {
      'سلام': { raw_level: -1 },
      'سفر': { raw_level: -1 },
    };
    getFreqLevelNamesMock.mockReturnValue({});

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      const characters = Array.from(container.querySelectorAll('.study-character'))
        .map((node) => node.textContent);
      expect(characters).toEqual(expect.arrayContaining(['س', 'ل', 'ا', 'م', 'ف', 'ر']));
      expect(container.querySelector('[data-level="-1"]')).toBeNull();
      expect(container.textContent).not.toContain('Characters by level:');
    });

    dispose();
  });

  it('groups character study entries into declared zero-based frequency levels', async () => {
    languageMock = 'zz';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
      characterStudy: { scripts: ['Latn'], levelOrder: 'ascending' },
      frequencyLevels: {
        names: { '0': 'Starter', '1': 'A1' },
        difficulty: 'higher-is-harder',
      },
    };
    wordFrequencyMock = {
      alpha: { raw_level: 0 },
      beta: { raw_level: 1 },
      ignored: { raw_level: -1 },
    };
    getFreqLevelNamesMock.mockReturnValue({ '0': 'Starter', '1': 'A1' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      const levels = Array.from(container.querySelectorAll('[data-level]'))
        .map((node) => node.getAttribute('data-level'));
      expect(levels).toEqual(['0', '1']);
      expect(container.querySelector('[data-level="-1"]')).toBeNull();
      const characters = Array.from(container.querySelectorAll('.study-character'))
        .map((node) => node.textContent);
      expect(characters).toEqual(expect.arrayContaining(['a', 'l', 'p', 'h', 'b', 'e', 't']));
    });

    dispose();
  });

  it('checks tracked character words against the current language explicitly', async () => {
    languageMock = 'ar';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      characterStudy: { scripts: ['Arab'], levelOrder: 'ascending' },
      frequencyLevels: { difficulty: 'higher-is-harder' },
    };
    wordFrequencyMock = {
      'سلام': { raw_level: 1 },
    };
    flashcardStoreMock = {
      wordKnowledge: {
        seen: { word: 'سلام', language: 'ar' },
      },
      flashcards: {},
      ignoredWords: {},
    };
    getFreqLevelNamesMock.mockReturnValue({ '1': 'A1' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(getComprehensiveWordStatusSyncMock).toHaveBeenCalledWith('سلام', 'ar');
    });

    dispose();
  });

  it('respects metadata that disables character study for a language', async () => {
    languageMock = 'en';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
      characterStudy: { enabled: false, scripts: ['Latn'] },
    };
    wordFrequencyMock = {
      hello: { raw_level: 1 },
      world: { raw_level: 2 },
    };
    getFreqLevelNamesMock.mockReturnValue({ '1': 'A1', '2': 'A2' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.study-character')).toHaveLength(0);
      expect(container.textContent).toContain('Character study is not available');
      expect(container.textContent).not.toContain('No tracked characters yet');
      expect(container.textContent).not.toContain('Characters by level:');
    });

    dispose();
  });

  it('shows an unsupported state when the language package has no character-study scripts', async () => {
    languageMock = 'de';
    currentLangDataMock = {
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
      characterStudy: { enabled: false },
    };
    wordFrequencyMock = {
      Haus: { raw_level: 1 },
    };
    getFreqLevelNamesMock.mockReturnValue({ '1': 'A1' });

    const { CharacterGridContent } = await import('./App');
    const dispose = render(() => <CharacterGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Character study is not available');
      expect(container.textContent).toContain('This language package does not define character-study scripts.');
      expect(container.textContent).not.toContain('No tracked characters yet');
      expect(container.querySelector('.study-character')).toBeNull();
    });

    dispose();
  });
});
