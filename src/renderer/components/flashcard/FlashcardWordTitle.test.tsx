// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

const wordWithReadingProps: Array<{
  word: string;
  reading: string;
  language?: string;
  languageData?: LanguageData | null;
  forceShowReadingAnnotation?: boolean;
  class?: string;
}> = [];

let mockSettings = {
  language: 'ja',
};
let mockLanguageMap: Record<string, LanguageData> = {};
let mockCurrentLanguageData: LanguageData | null = null;

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
  }),
  useLocalization: () => ({
    t: (key: string) => {
      if (key === 'mlearn.CardEditor.Fields.ProsodyPosition') return 'Prosody position';
      return key;
    },
  }),
}));

vi.mock('../language-specific', () => ({
  WordWithReading: (props: {
    word: string;
    reading: string;
    language?: string;
    languageData?: LanguageData | null;
    forceShowReadingAnnotation?: boolean;
    class?: string;
    children?: JSX.Element;
  }) => {
    wordWithReadingProps.push({
      word: props.word,
      reading: props.reading,
      language: props.language,
      languageData: props.languageData,
      forceShowReadingAnnotation: props.forceShowReadingAnnotation,
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
    mockSettings = { language: 'ja' };
    mockLanguageMap = {};
    mockCurrentLanguageData = japaneseLanguageData;
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
