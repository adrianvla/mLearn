// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../../shared/types';
import { WordStatusPill } from './WordStatusPill';

const ankiMocks = vi.hoisted(() => ({
  findAnkiWordMatchInCacheMock: vi.fn(),
  refreshAnkiWordsCacheMock: vi.fn(() => Promise.resolve(new Set<string>())),
}));

const updateSettingsMock = vi.fn();
const trackWordStatusChangeMock = vi.fn();
const setComprehensiveWordStatusMock = vi.fn();
const updateWordCardsMock = vi.fn(() => Promise.resolve({ updated: 0, repositioned: 0 }));
let skipAnkiModifyWarning = false;

const germanLanguageData: LanguageData = {
  name: 'German',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
  },
};

const japaneseLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
  },
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'ja',
      use_anki: true,
      skipAnkiModifyWarning,
      skipStatusSourceWarning: false,
    },
    updateSettings: updateSettingsMock,
  }),
  useLanguage: () => ({
    langData: {
      de: germanLanguageData,
      ja: japaneseLanguageData,
    },
    currentLangData: () => japaneseLanguageData,
    getCanonicalForm: (word: string) => `ja:${word}`,
    getWordVariants: (word: string) => [`ja-variant:${word}`],
    getCanonicalFormForLanguage: (language: string, word: string) => `${language}:${word}`,
    getWordVariantsForLanguage: (language: string, word: string) => [`${language}-variant:${word}`],
  }),
  useFlashcards: () => ({
    trackWordStatusChange: trackWordStatusChangeMock,
    getComprehensiveWordStatusWithSourceSync: () => ({
      status: 'unknown',
      source: 'None',
      timesSeen: 0,
    }),
    setComprehensiveWordStatus: setComprehensiveWordStatusMock,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => (
      params?.count ? `${key}:${params.count}` : key
    ),
  }),
}));

vi.mock('../../../hooks/useAnki', () => ({
  useAnki: () => ({
    updateWordCards: updateWordCardsMock,
  }),
}));

vi.mock('../../../services/ankiWordsCache', () => ({
  findAnkiWordMatchInCache: ankiMocks.findAnkiWordMatchInCacheMock,
  refreshAnkiWordsCache: ankiMocks.refreshAnkiWordsCacheMock,
}));

vi.mock('../Button', () => ({
  PillBtn: (props: { label?: string; onClick?: (event: MouseEvent) => void }) => (
    <button type="button" onClick={props.onClick}>{props.label}</button>
  ),
}));

vi.mock('../Tooltip', () => ({
  Tooltip: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('../../flashcard/AnkiModifyWarningModal', () => ({
  AnkiModifyWarningModal: (props: { isOpen: boolean; title?: string }) => (
    props.isOpen ? <div data-testid="anki-warning">{props.title}</div> : null
  ),
}));

vi.mock('../Feedback/Toast', () => ({
  showToast: vi.fn(),
}));

describe('WordStatusPill', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    skipAnkiModifyWarning = false;
    ankiMocks.findAnkiWordMatchInCacheMock.mockReturnValue({
      word: 'de:Haus',
      lookupKey: 'Haus',
      cards: [{ word: 'de:Haus', factor: 2500, queue: 2, type: 2 }],
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('uses the supplied language metadata for non-active Anki lookups', () => {
    const dispose = render(() => (
      <WordStatusPill word="Haus" language="de" />
    ), container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(ankiMocks.findAnkiWordMatchInCacheMock).toHaveBeenCalledWith(
      ['de-variant:Haus'],
      {
        language: 'de',
        languageData: germanLanguageData,
      },
    );

    dispose();
  });

  it('updates Anki with the original matched expression instead of the normalized lookup key', async () => {
    skipAnkiModifyWarning = true;
    updateWordCardsMock.mockResolvedValueOnce({ updated: 1, repositioned: 0 });
    ankiMocks.findAnkiWordMatchInCacheMock.mockReturnValue({
      word: '你好(ni hao)',
      lookupKey: '你好',
      cards: [{ word: '你好(ni hao)', factor: 2500, queue: 2, type: 2 }],
    });

    const dispose = render(() => (
      <WordStatusPill word="你好" />
    ), container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(updateWordCardsMock).toHaveBeenCalledWith('你好(ni hao)', 1550);
    expect(updateWordCardsMock).not.toHaveBeenCalledWith('你好', expect.anything());

    dispose();
  });
});
