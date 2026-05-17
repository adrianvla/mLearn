// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const getFreqLevelNamesMock = vi.fn((): Record<string, string> => ({}));
const localizationMock = vi.fn((key: string) => key);

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useLanguage: () => ({
    wordFrequency: {
      '日本語': { raw_level: 5 },
    },
    getFreqLevelNames: getFreqLevelNamesMock,
    getFrequency: (word: string) => word === '日本語' ? { raw_level: 5 } : null,
    currentLangData: () => ({ hasFrequencyLevels: true }),
  }),
  useLocalization: () => ({
    t: localizationMock,
  }),
  useSettings: () => ({
    settings: { language: 'ja' },
  }),
  useFlashcards: () => ({
    store: {
      wordKnowledge: {},
      flashcards: {},
      ignoredWords: {},
    },
    isWordKnownByText: () => false,
    isWordLearningByText: () => false,
  }),
}));

vi.mock('../../components/common', () => ({
  Spinner: (props: { text?: string }) => <div>{props.text}</div>,
  PillLabel: (props: { children?: JSX.Element; class?: string; onMouseEnter?: () => void; onMouseLeave?: () => void }) => (
    <span class={props.class} onMouseEnter={props.onMouseEnter} onMouseLeave={props.onMouseLeave}>{props.children}</span>
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

describe('KanjiGridContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    localizationMock.mockImplementation((key: string) => {
      switch (key) {
        case 'mlearn.KanjiGrid.Title':
          return 'Character Knowledge Overview';
        case 'mlearn.KanjiGrid.Description':
          return 'Description';
        case 'mlearn.KanjiGrid.CharactersByExamLevel':
          return 'Characters by exam level:';
        case 'mlearn.KanjiGrid.Disclaimer.Title':
          return 'JLPT kanji are estimated';
        case 'mlearn.KanjiGrid.Disclaimer.Description':
          return 'JLPT disclaimer';
        case 'mlearn.KanjiGrid.Legend.Learning':
          return 'Learning';
        case 'mlearn.KanjiGrid.Legend.Known':
          return 'Known';
        case 'mlearn.KanjiGrid.Legend.Unknown':
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

  it('shows the disclaimer when the level labels are JLPT-based', async () => {
    getFreqLevelNamesMock.mockReturnValue({ '5': 'JLPT N5' });

    const { KanjiGridContent } = await import('./App');
    const dispose = render(() => <KanjiGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('JLPT kanji are estimated');
      expect(container.textContent).toContain('JLPT disclaimer');
    });

    dispose();
  });

  it('hides the disclaimer for non-JLPT level labels', async () => {
    getFreqLevelNamesMock.mockReturnValue({ '1': 'Level 1' });

    const { KanjiGridContent } = await import('./App');
    const dispose = render(() => <KanjiGridContent />, container);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('JLPT kanji are estimated');
      expect(container.textContent).not.toContain('JLPT disclaimer');
    });

    dispose();
  });
});