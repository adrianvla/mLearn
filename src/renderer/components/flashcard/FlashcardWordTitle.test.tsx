// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';
import type { FlashcardPresentationKnowledge } from './FlashcardWordTitle';

const wordWithReadingProps: Array<{
  word: string;
  reading: string;
  language?: string;
  languageData?: LanguageData | null;
  forceShowReadingAnnotation?: boolean;
  prosodyPosition?: () => number | null;
  prosodyKnowledge?: () => unknown;
  class?: string;
}> = [];
let mockCachedTranslation: unknown = null;
let mockCacheVersion: () => number = () => 0;
const mockGetCachedTranslation = vi.fn(() => mockCachedTranslation);

let mockSettings = {
  language: 'ja',
};
let mockLanguageMap: Record<string, LanguageData> = {};
let mockCurrentLanguageData: LanguageData | null = null;
let mockLiveAccessStatus: { status: 'unknown' | 'known'; ease: number; source: string; untracked: boolean } = {
  status: 'unknown', ease: 0, source: 'None', untracked: true,
};

const japaneseLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      surfaceSuffixScripts: ['Hira', 'Kana'],
    },
  },
  prosody: {
    type: 'japanese-pitch-accent',
  },
};

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
  }),
  useLanguage: () => ({
    langData: mockLanguageMap,
    currentLangData: () => mockCurrentLanguageData,
    getCanonicalFormForLanguage: () => undefined,
    getWordVariantsForLanguage: () => [],
    getReadingVariantsForLanguage: () => [],
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getComprehensiveWordStatusWithSourceSync: () => ({ status: 'unknown', source: 'None', timesSeen: 0 }),
    getAccessStatus: () => mockLiveAccessStatus,
  }),
  useLocalization: () => ({
    t: (key: string) => {
      if (key === 'mlearn.CardEditor.Fields.ProsodyPosition') return 'Prosody position';
      return key;
    },
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => mockCacheVersion(),
  getCachedTranslation: (..._args: unknown[]) => mockGetCachedTranslation(),
}));

vi.mock('../language-specific', () => ({
  WordWithReading: (props: {
    word: string;
    reading: string;
    language?: string;
    languageData?: LanguageData | null;
    forceShowReadingAnnotation?: boolean;
    coloredProsody?: { prosodyPosition: () => number | null; prosodyKnowledge: () => unknown };
    class?: string;
    children?: JSX.Element;
  }) => {
    wordWithReadingProps.push({
      word: props.word,
      reading: props.reading,
      language: props.language,
      languageData: props.languageData,
      forceShowReadingAnnotation: props.forceShowReadingAnnotation,
      prosodyPosition: props.coloredProsody?.prosodyPosition,
      prosodyKnowledge: props.coloredProsody?.prosodyKnowledge,
      class: props.class,
    });
    return <span class={props.class}>{props.word}</span>;
  },
}));

describe('FlashcardWordTitle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    wordWithReadingProps.length = 0;
    mockCachedTranslation = null;
    mockCacheVersion = () => 0;
    mockGetCachedTranslation.mockClear();
    mockSettings = { language: 'ja' };
    mockLanguageMap = {};
    mockCurrentLanguageData = japaneseLanguageData;
    mockLiveAccessStatus = { status: 'unknown', ease: 0, source: 'None', untracked: true };
  });

  afterEach(() => {
    container.remove();
  });

  it('uses active language metadata when an explicit card language matches the active language but langData is not populated', async () => {
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');

    const dispose = render(() => (
      <FlashcardWordTitle
        language="ja"
        content={{
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
        }}
      />
    ), container);

    expect(wordWithReadingProps[0]).toMatchObject({
      word: '赤い',
      reading: 'あかい',
      language: 'ja',
      languageData: japaneseLanguageData,
      forceShowReadingAnnotation: true,
    });

    dispose();
  });

  it('renders package-defined non-Japanese prosody position on saved cards', async () => {
    mockSettings = { language: 'de' };
    const toneLanguageData: LanguageData = {
      name: 'Tone language',
      settings: { fixed: {} },
            prosody: {
        type: 'tone-contour',
        positionLabel: 'Tone position',
      },
    };
    mockLanguageMap = { tl: toneLanguageData };
    mockCurrentLanguageData = {
      name: 'German',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    };
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');

    const dispose = render(() => (
      <FlashcardWordTitle
        language="tl"
        content={{
          type: 'word',
          front: 'ma',
          back: 'mother',
          prosody: {
            type: 'tone-contour',
            position: 2,
          },
        }}
      />
    ), container);

    expect(container.querySelector('.fc-prosody-position')?.textContent).toContain('Tone position');
    expect(container.querySelector('.fc-prosody-position')?.textContent).toContain('2');

    dispose();
  });

  it('freezes cached prosody for an admitted review encounter and refreshes it on the next encounter', async () => {
    mockSettings = { language: 'tl' };
    const toneLanguageData: LanguageData = {
      name: 'Tone language',
      settings: { fixed: {} },
      prosody: { type: 'stress-position', positionLabel: 'Stress' },
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
    };
    mockLanguageMap = { tl: toneLanguageData };
    mockCurrentLanguageData = null;
    const { createSignal } = await import('solid-js');
    const [cacheVersion, setCacheVersion] = createSignal(0);
    const firstEncounter = { id: 'first' };
    const secondEncounter = { id: 'second' };
    const [encounter, setEncounter] = createSignal<object>(firstEncounter);
    mockCacheVersion = cacheVersion;
    const knowledge = { ready: true, wordKnown: false, accesses: {} };
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');
    const dispose = render(() => <FlashcardWordTitle
      content={{ type: 'word', front: 'ma', back: 'mother' }} language="tl"
      knowledge={knowledge} presentationOwner={encounter()} />,
    container);

    const position = () => wordWithReadingProps.at(-1)?.prosodyPosition?.() ?? null;
    expect(position()).toBeNull();
    mockCachedTranslation = { data: [{ position: 2 }] };
    setCacheVersion(1);
    expect(position()).toBeNull();

    setEncounter(secondEncounter);
    expect(position()).toBe(2);
    dispose();
  });

  it('uses the language metadata captured at review admission', async () => {
    mockSettings = { language: 'de' };
    const admittedMetadata: LanguageData = {
      name: 'Admitted language metadata',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
        readingAnnotation: { type: 'script-reading', annotationScripts: ['Han'] },
      },
    };
    mockLanguageMap = { tl: { ...admittedMetadata, name: 'Later package metadata' } };
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');

    const dispose = render(() => (
      <FlashcardWordTitle
        language="tl"
        presentationLanguageData={admittedMetadata}
        content={{ type: 'word', front: '字', reading: 'zi', back: 'character' }}
      />
    ), container);

    expect(wordWithReadingProps[0]?.languageData).toBe(admittedMetadata);
    expect(wordWithReadingProps[0]?.forceShowReadingAnnotation).toBe(true);

    dispose();
  });

  it('does not resample live word knowledge during an admitted review encounter', async () => {
    const knowledge: FlashcardPresentationKnowledge = {
      ready: true,
      wordKnown: false,
      accesses: { 'prosodic-pattern': { status: 'unknown', ease: 0, source: 'None', untracked: true } },
    };
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');
    const dispose = render(() => <FlashcardWordTitle
      content={{ type: 'word', front: '赤い', back: 'red', pos: 'adjective' }}
      knowledge={knowledge} presentationOwner={{ id: 'encounter' }} />,
    container);

    const encounterKnowledge = wordWithReadingProps.at(-1)?.prosodyKnowledge?.();
    expect(encounterKnowledge).toEqual(knowledge.accesses['prosodic-pattern']);
    // A later global projection can change; the current title continues to
    // expose its encounter's captured knowledge to the shared renderer.
    mockLiveAccessStatus = { status: 'known', ease: 5, source: 'srs', untracked: false };
    expect(wordWithReadingProps.at(-1)?.prosodyKnowledge?.()).toEqual(encounterKnowledge);

    dispose();
  });

  it('exposes language-agnostic word title classes while preserving saved language metadata', async () => {
    mockSettings = { language: 'de' };
    const farsiLanguageData: LanguageData = {
      name: 'Farsi',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Arab'],
        },
      },
      prosody: {
        type: 'stress-position',
        positionLabel: 'Stress',
      },
    };
    mockLanguageMap = { fa: farsiLanguageData };
    mockCurrentLanguageData = {
      name: 'German',
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
    };
    const { FlashcardWordTitle } = await import('./FlashcardWordTitle');

    const dispose = render(() => (
      <FlashcardWordTitle
        language="fa"
        content={{
          type: 'word',
          front: 'کتاب',
          back: 'book',
          reading: 'ketab',
          prosody: {
            type: 'stress-position',
            position: 2,
          },
        }}
      />
    ), container);

    expect(container.querySelector('.flashcard-word-title')).not.toBeNull();
    expect(container.querySelector('.flashcard-word-title__reading')).not.toBeNull();
    expect(container.querySelector('.flashcard-word-title__prosody-position')?.textContent).toContain('Stress');
    expect(wordWithReadingProps[0]).toMatchObject({
      language: 'fa',
      languageData: farsiLanguageData,
      forceShowReadingAnnotation: true,
    });

    dispose();
  });
});
