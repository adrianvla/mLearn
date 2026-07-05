// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

let languageDataMock: LanguageData | null = null;
let settingsLanguageMock = 'ar';
const addLevelStudyFlashcardsMock = vi.fn();

vi.mock('../../components/common', () => ({
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element; title?: string }) => (
    <section data-testid="modal">
      <h1>{props.title}</h1>
      {props.children}
      {props.footer}
    </section>
  ),
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
}));

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => params?.count ?? params?.status ?? key,
  }),
  useFlashcards: () => ({
    store: {
      flashcards: {},
      wordToCardMap: {},
      wordKnowledge: {},
      knownUntracked: {},
      ignoredWords: {},
      wordCandidates: {},
    },
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
  }),
  useLanguage: () => ({
    currentLangData: () => languageDataMock,
    langData: settingsLanguageMock && languageDataMock ? { [settingsLanguageMock]: languageDataMock } : {},
  }),
  useSettings: () => ({
    settings: {
      language: settingsLanguageMock,
      known_ease_threshold: 3500,
      srsLearningThreshold: 1500,
    },
  }),
}));

vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: (options: { count: number; estimateSize: () => number }) => {
    const rowHeight = options.estimateSize();
    return {
      getTotalSize: () => options.count * rowHeight,
      getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
        index,
        start: index * rowHeight,
        size: rowHeight,
      })),
    };
  },
}));

vi.mock('../../components/common/Feedback/Toast', () => ({
  showToast: vi.fn(),
}));

function makeLanguageData(overrides: Partial<LanguageData>): LanguageData {
  return {
    name: 'Test language',
    settings: { fixed: {} },
    frequencyLevels: {
      rowLevelIndex: 2,
      names: { '1': 'Level 1' },
    },
    ...overrides,
  };
}

describe('LevelDetailModal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    settingsLanguageMock = 'ar';
    addLevelStudyFlashcardsMock.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  it('uses metadata-driven inline reading annotations for non-Japanese level words', async () => {
    languageDataMock = makeLanguageData({
      name: 'Arabic',
      freq: [
        ['بيت', 'bayt', 1],
      ],
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab', 'Latn'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Latn'],
        },
        readingAnnotation: {
          type: 'script-reading',
          display: 'inline',
          annotationScripts: ['Arab'],
        },
      },
    });
    const { LevelDetailModal } = await import('./LevelDetailModal');

    const dispose = render(() => (
      <LevelDetailModal
        level={1}
        levelName="Level 1"
        language="ar"
        languageData={languageDataMock}
        onClose={() => undefined}
      />
    ), container);

    expect(container.querySelector('.ruby-text-inline')).not.toBeNull();
    expect(container.querySelector('.level-detail-word-reading')).toBeNull();
    expect(container.textContent).toContain('بيت');
    expect(container.textContent).toContain('bayt');

    dispose();
  });

  it('keeps the separate reading line for languages without reading annotation metadata', async () => {
    settingsLanguageMock = 'de';
    languageDataMock = makeLanguageData({
      name: 'German',
      freq: [
        ['Haus', 'haʊs', 1],
      ],
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });
    const { LevelDetailModal } = await import('./LevelDetailModal');

    const dispose = render(() => (
      <LevelDetailModal
        level={1}
        levelName="Level 1"
        language="de"
        languageData={languageDataMock}
        onClose={() => undefined}
      />
    ), container);

    expect(container.querySelector('.ruby-text-inline')).toBeNull();
    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.level-detail-word-reading')?.textContent).toBe('haʊs');
    expect(container.textContent).toContain('Haus');

    dispose();
  });
});
