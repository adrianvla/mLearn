// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../../shared/types';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import { WordStatusPill } from './WordStatusPill';

const ankiMocks = vi.hoisted(() => ({
  findAnkiWordMatchInCacheMock: vi.fn(),
  refreshAnkiWordsCacheMock: vi.fn(() => Promise.resolve(new Set<string>())),
}));

const updateSettingsMock = vi.fn();
const trackWordStatusChangeMock = vi.fn();
const setWordClaimMock = vi.fn();
const updateWordCardsMock = vi.fn(() => Promise.resolve({ updated: 0, repositioned: 0 }));
let skipAnkiModifyWarning = false;
let skipStatusSourceWarning = false;
let comprehensiveResultMock: ComprehensiveWordStatusResult = {
  status: 'unknown',
  basis: 'unmeasured',
  evidenceStatus: 'unknown',
  source: 'None',
  timesSeen: 0,
  matchedWord: undefined,
};

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
      skipStatusSourceWarning,
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
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    trackWordStatusChange: trackWordStatusChangeMock,
    getComprehensiveWordStatusWithSourceSync: () => comprehensiveResultMock,
    getWordKnowledge: () => undefined,
    setWordClaim: setWordClaimMock,
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
  ankiCacheVersion: () => 0,
  findAnkiWordMatchInCache: ankiMocks.findAnkiWordMatchInCacheMock,
  refreshAnkiWordsCache: ankiMocks.refreshAnkiWordsCacheMock,
}));

vi.mock('../Button', () => ({
  PillBtn: (props: { label?: string; onClick?: (event: MouseEvent) => void }) => (
    <button type="button" onClick={props.onClick}>{props.label}</button>
  ),
}));

vi.mock('../Tooltip', () => ({
  Tooltip: (props: { content?: JSX.Element; children?: JSX.Element; pinned?: boolean }) => (
    <span data-testid="tooltip" data-pinned={String(props.pinned)}>{props.content}{props.children}</span>
  ),
}));

vi.mock('../WordStatusPillKnowledge', () => ({
  WordStatusPillKnowledge: (props: { statusSourceLabel?: string }) => (
    <div data-testid="mock-knowledge-popup" data-source={props.statusSourceLabel} />
  ),
}));

// vi.mock factories are hoisted above static imports, so Show must be imported
// dynamically inside the factory — the documented vi.mock exception.
vi.mock('../../flashcard/AnkiModifyWarningModal', async () => {
  const { Show } = await import('solid-js');
  return {
    AnkiModifyWarningModal: (props: {
      isOpen: boolean;
      title?: string;
      confirmText?: string;
      onConfirm?: (dontRemind: boolean) => void;
    }) => (
      <Show when={props.isOpen}>
        <div data-testid="anki-warning">
          {props.title}
          <button type="button" onClick={() => props.onConfirm?.(false)}>{props.confirmText}</button>
        </div>
      </Show>
    ),
  };
});

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
    skipStatusSourceWarning = false;
    comprehensiveResultMock = {
      status: 'unknown',
      basis: 'unmeasured',
      evidenceStatus: 'unknown',
      source: 'None',
      timesSeen: 0,
      matchedWord: undefined,
    };
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

    expect(updateWordCardsMock).toHaveBeenCalledWith('你好(ni hao)', 1800);
    expect(updateWordCardsMock).not.toHaveBeenCalledWith('你好', expect.anything());

    dispose();
  });

  it('shows the matched canonical word in the status tooltip for reading aliases', () => {
    comprehensiveResultMock = {
      status: 'known',
      basis: 'claim',
      evidenceStatus: 'unknown',
      source: 'Manual',
      timesSeen: 0,
      matchedWord: '連続',
    };

    const dispose = render(() => (
      <WordStatusPill word="れんぞく" language="ja" />
    ), container);

    expect(container.querySelector('[data-testid="mock-knowledge-popup"]')?.getAttribute('data-source')).toContain(
      'mlearn.Knowledge.Basis.Claim (→ 連続)',
    );

    dispose();
  });

  it('labels claimed words with the claim basis and the seen count', () => {
    comprehensiveResultMock = {
      status: 'known',
      basis: 'claim',
      evidenceStatus: 'unknown',
      source: 'Manual',
      timesSeen: 10,
      matchedWord: 'Haus',
    };
    const dispose = render(() => (
      <WordStatusPill word="Haus" language="de" />
    ), container);

    expect(container.querySelector('[data-testid="mock-knowledge-popup"]')?.getAttribute('data-source')).toContain(
      'mlearn.Knowledge.Basis.Claim + mlearn.WordHover.TimesSeen:10',
    );

    dispose();
  });

  it('claims Known immediately on click for an untracked word and does not pin the popup', () => {
    ankiMocks.findAnkiWordMatchInCacheMock.mockReturnValue(null);
    const dispose = render(() => <WordStatusPill word="Haus" language="de" />, container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(setWordClaimMock).toHaveBeenCalledWith('de-variant:Haus', 'known', 'de');
    expect(container.querySelector('[data-testid="tooltip"]')?.getAttribute('data-pinned')).toBe('false');
    dispose();
  });

  it('clicking an already-Known word is a no-op', () => {
    comprehensiveResultMock = {
      status: 'known',
      basis: 'claim',
      evidenceStatus: 'unknown',
      source: 'Manual',
      timesSeen: 0,
      matchedWord: 'Haus',
    };
    const dispose = render(() => <WordStatusPill word="Haus" language="de" />, container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(setWordClaimMock).not.toHaveBeenCalled();
    dispose();
  });

  it('overrides evidence-backed Learning with an explicit Known claim on the fast path', () => {
    ankiMocks.findAnkiWordMatchInCacheMock.mockReturnValue(null);
    skipStatusSourceWarning = true;
    comprehensiveResultMock = {
      status: 'learning',
      basis: 'evidence',
      evidenceStatus: 'learning',
      source: 'Srs',
      timesSeen: 4,
      matchedWord: 'Haus',
    };
    const dispose = render(() => <WordStatusPill word="Haus" language="de" />, container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(setWordClaimMock).toHaveBeenCalledWith('de-variant:Haus', 'known', 'de');
    dispose();
  });

  it('warns before overriding an intentional contradictory state and claims Known on confirm', () => {
    ankiMocks.findAnkiWordMatchInCacheMock.mockReturnValue(null);
    comprehensiveResultMock = {
      status: 'learning',
      basis: 'evidence',
      evidenceStatus: 'learning',
      source: 'Srs',
      timesSeen: 4,
      matchedWord: 'Haus',
    };
    const dispose = render(() => <WordStatusPill word="Haus" language="de" />, container);

    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(setWordClaimMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="anki-warning"]')).not.toBeNull();

    container.querySelector<HTMLButtonElement>('[data-testid="anki-warning"] button')?.click();
    expect(setWordClaimMock).toHaveBeenCalledWith('de-variant:Haus', 'known', 'de');

    dispose();
  });
});

