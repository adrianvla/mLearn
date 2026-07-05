// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { WordEntry } from './WordEntryRow';
import type { LanguageData } from '../../../../shared/types';

const mockGetCard = vi.fn();
const extractProsodyDataMock = vi.fn();
const extractProsodyDataForReadingMock = vi.fn();
const extractReadingValueMock = vi.fn();
const getCachedTranslationMock = vi.fn();
const getCachedReadingMock = vi.fn();
const fetchTranslationMock = vi.fn();
const prosodyOverlayProps: Array<{ word: string; prosodyPosition?: number | null; prosodyType?: string; class?: string }> = [];
let mockLanguageData: LanguageData | null = null;

vi.mock('../../../../shared/backends', () => ({
  getBackend: () => ({
    getCard: mockGetCard,
  }),
}));

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'mlearn.WordDbEditor.Trackers.Anki') return 'Anki';
      if (key === 'mlearn.WordDbEditor.Anki.Preview') return 'Preview';
      if (key === 'mlearn.WordDbEditor.Anki.PreviewTitle') return `Anki Preview - ${params?.word ?? ''}`;
      return key;
    },
  }),
  useSettings: () => ({
    settings: {
      language: 'ja',
    },
  }),
  useLanguage: () => ({
    currentLangData: () => mockLanguageData,
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedTranslation: getCachedTranslationMock,
  getCachedReading: getCachedReadingMock,
  fetchTranslation: fetchTranslationMock,
}));

vi.mock('../../../utils/translationCacheParsers', () => ({
  extractProsodyData: extractProsodyDataMock,
  extractProsodyDataForReading: extractProsodyDataForReadingMock,
  extractReadingValue: extractReadingValueMock,
}));

vi.mock('../../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>{props.children}</button>
  ),
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  AnkiHoverPreview: (props: {
    children?: JSX.Element;
    onShow?: () => void;
    fields?: { Expression?: { value: string } } | null;
    loading?: boolean;
  }) => (
    <span>
      <button type="button" data-testid="anki-hover-trigger" onClick={() => props.onShow?.()}>
        {props.children}
      </button>
      <span data-testid="anki-hover-content">
        {props.loading ? 'loading' : props.fields?.Expression?.value ?? 'empty'}
      </span>
    </span>
  ),
}));

vi.mock('../../../components/language-specific', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../components/language-specific')>();
  return {
    ...actual,
    ProsodyOverlay: (props: { word: string; children?: JSX.Element; prosodyPosition?: number | null; prosodyType?: string; class?: string }) => {
    prosodyOverlayProps.push({ word: props.word, prosodyPosition: props.prosodyPosition, prosodyType: props.prosodyType, class: props.class });
    return <span data-testid="pitch-accent-overlay">{props.children ?? props.word}</span>;
    },
  };
});

vi.mock('../../../components/common/Smart', () => ({
  WordStatusPill: () => <span data-testid="word-status-pill" />,
}));

function makeEntry(word: string, overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    uuid: word,
    word,
    translation: '',
    reading: '',
    level: 0,
    tracker: 'anki',
    status: 0,
    ...overrides,
  };
}

function makeLanguageData(overrides: Partial<LanguageData>): LanguageData {
  return {
    name: 'Test language',
    settings: { fixed: {} },
    ...overrides,
  };
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WordEntryRow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetCard.mockReset();
    getCachedTranslationMock.mockReset();
    getCachedTranslationMock.mockReturnValue(null);
    getCachedReadingMock.mockReset();
    getCachedReadingMock.mockReturnValue(null);
    fetchTranslationMock.mockReset();
    fetchTranslationMock.mockResolvedValue({ data: [] });
    prosodyOverlayProps.length = 0;
    extractProsodyDataMock.mockReset();
    extractProsodyDataMock.mockReturnValue(undefined);
    extractProsodyDataForReadingMock.mockReset();
    extractProsodyDataForReadingMock.mockReturnValue(undefined);
    extractReadingValueMock.mockReset();
    extractReadingValueMock.mockReturnValue(null);
    mockLanguageData = makeLanguageData({
      name: 'Japanese',
      prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
  });

  it('shows returned Anki cards even when the backend marks the match as poor', async () => {
    mockGetCard.mockResolvedValue({
      error: false,
      poor: true,
      cards: [{ fields: { Expression: { value: '赤い', order: 0 } } }],
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('赤い')}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="anki-hover-trigger"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await flushAsync();

    expect(mockGetCard).toHaveBeenCalledWith({ word: '赤い' });
    expect(container.querySelector('[data-testid="anki-hover-content"]')?.textContent).toBe('赤い');

    dispose();
  });

  it('resets the one-shot Anki hover lookup when the row entry changes', async () => {
    mockGetCard
      .mockResolvedValueOnce({ error: true, poor: false, cards: [] })
      .mockResolvedValueOnce({
        error: false,
        poor: false,
        cards: [{ fields: { Expression: { value: '明るい', order: 0 } } }],
      });
    const { WordEntryRow } = await import('./WordEntryRow');
    const [entry, setEntry] = createSignal(makeEntry('赤い'));

    const dispose = render(() => (
      <WordEntryRow
        entry={entry()}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const firstTrigger = container.querySelector<HTMLButtonElement>('[data-testid="anki-hover-trigger"]');
    expect(firstTrigger).not.toBeNull();
    firstTrigger!.click();
    await flushAsync();

    setEntry(makeEntry('明るい'));
    await flushAsync();
    const secondTrigger = container.querySelector<HTMLButtonElement>('[data-testid="anki-hover-trigger"]');
    expect(secondTrigger).not.toBeNull();
    secondTrigger!.click();
    await flushAsync();

    expect(mockGetCard).toHaveBeenCalledTimes(2);
    expect(mockGetCard).toHaveBeenLastCalledWith({ word: '明るい' });
    expect(container.querySelector('[data-testid="anki-hover-content"]')?.textContent).toBe('明るい');

    dispose();
  });

  it('uses the matched Anki expression for hover card lookup', async () => {
    mockGetCard.mockResolvedValue({
      error: false,
      poor: false,
      cards: [{ fields: { Expression: { value: '会う', order: 0 } } }],
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('逢う', { ankiLookupWord: '会う' })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="anki-hover-trigger"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await flushAsync();

    expect(mockGetCard).toHaveBeenCalledWith({ word: '会う' });
    expect(container.querySelector('[data-testid="anki-hover-content"]')?.textContent).toBe('会う');

    dispose();
  });

  it('shows metadata-driven reading annotations for Japanese words', async () => {
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('赤い', { reading: 'あかい' })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const ruby = container.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toBe('あかい');

    dispose();
  });

  it('uses Japanese pitch-accent overlay only when the language metadata declares that prosody model', async () => {
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('赤い', { reading: 'あかい', prosodyPosition: 2 })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('[data-testid="pitch-accent-overlay"]')).not.toBeNull();
    expect(container.querySelector('.word-db-prosody-preview')).toBeNull();

    dispose();
  });

  it('draws Japanese pitch accent on inline reading annotations', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Japanese',
      prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
          display: 'inline',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'ひらく', prosodyPosition: 2 })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(prosodyOverlayProps.some((props) => (
      props.word === 'ひらく'
      && props.prosodyPosition === 2
      && props.class === 'prosody-overlay-wrapper--reading'
    ))).toBe(true);

    dispose();
  });

  it('uses the displayed reading as the pitch target for non-ruby reading annotations', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Japanese',
      prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
          display: 'inline',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'ひらく', prosodyPosition: 2 })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const readingOverlay = prosodyOverlayProps.find((props) => props.class === 'prosody-overlay-wrapper--reading');
    expect(readingOverlay).toMatchObject({
      word: 'ひらく',
      prosodyPosition: 2,
    });

    dispose();
  });

  it('uses saved generic prosody payloads for Japanese pitch-accent rows', async () => {
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('赤い', {
          reading: 'あかい',
          prosodyPosition: null,
          prosody: {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { pitches: [{ position: 2 }] },
          },
        })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('[data-testid="pitch-accent-overlay"]')).not.toBeNull();

    dispose();
  });

  it('uses cached dictionary prosody for Japanese pitch-accent ruby rows', async () => {
    getCachedReadingMock.mockReturnValue('あかい');
    getCachedTranslationMock.mockReturnValue({
      data: [
        { definitions: ['red'], reading: 'あかい' },
        undefined,
        { reading: 'あかい', pitches: [{ position: 2 }] },
      ],
    });
    extractProsodyDataMock.mockReturnValue({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'あかい', pitches: [{ position: 2 }] },
    });
    extractProsodyDataForReadingMock.mockReturnValue({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'あかい', pitches: [{ position: 2 }] },
    });
    extractReadingValueMock.mockReturnValue('あかい');
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('赤い', { reading: 'あかい' })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('ruby')).not.toBeNull();
    expect(prosodyOverlayProps.some((props) => (
      props.word === 'あかい'
      && props.prosodyPosition === 2
      && props.class === 'prosody-overlay-wrapper--reading'
    ))).toBe(true);

    dispose();
  });

  it('does not draw cached pitch accent over a different displayed reading', async () => {
    getCachedReadingMock.mockReturnValue(null);
    getCachedTranslationMock.mockReturnValue({
      data: [
        { definitions: ['to open'], reading: 'あく' },
        undefined,
        { reading: 'ひらく', pitches: [{ position: 2 }] },
      ],
    });
    extractProsodyDataMock.mockReturnValue({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    });
    extractProsodyDataForReadingMock.mockReturnValue(undefined);
    extractReadingValueMock.mockReturnValue('ひらく');
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'あく' })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('ruby')).not.toBeNull();
    expect(prosodyOverlayProps.some((props) => props.word === '開く' && props.prosodyPosition === 2)).toBe(false);

    dispose();
  });

  it('renders cached pitch accent pills for alternate readings', async () => {
    getCachedReadingMock.mockReturnValue(null);
    getCachedTranslationMock.mockImplementation((word: string) => {
      if (word === 'ひらく') {
        return {
          data: [
            { definitions: ['to open'], reading: 'ひらく' },
            undefined,
            { reading: 'ひらく', pitches: [{ position: 2 }] },
          ],
        };
      }
      return {
        data: [
          { definitions: ['to open'], reading: 'あく' },
          undefined,
          { reading: 'ひらく', pitches: [{ position: 2 }] },
        ],
      };
    });
    extractProsodyDataMock.mockImplementation((raw: unknown) => {
      const data = Array.isArray(raw) ? raw : [raw];
      return data.some((item) => (
        typeof item === 'object'
        && item !== null
        && 'reading' in item
        && item.reading === 'ひらく'
      ))
        ? {
            type: 'japanese-pitch-accent',
            position: 2,
            raw,
          }
        : undefined;
    });
    extractProsodyDataForReadingMock.mockImplementation((
      _raw: unknown,
      _languageData: LanguageData | null,
      readingMatches: (reading: string) => boolean,
    ) => {
      return readingMatches('ひらく')
        ? {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
          }
        : undefined;
    });
    extractReadingValueMock.mockImplementation((raw: { reading?: string }) => raw?.reading ?? null);
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'あく', alternateReadings: ['ひらく'] })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps.some((props) => (
      props.word === 'ひらく'
      && props.prosodyPosition === 2
    ))).toBe(true);
    expect(container.textContent).toContain('ひらく');

    dispose();
  });

  it('draws cached pitch accent on every displayed alternate reading even when the row primary reading differs', async () => {
    getCachedReadingMock.mockReturnValue('あく');
    getCachedTranslationMock.mockImplementation((word: string) => {
      if (word === 'ひらく') {
        return {
          data: [
            { definitions: ['to open'], reading: 'ひらく' },
            undefined,
            { reading: 'ひらく', pitches: [{ position: 2 }] },
          ],
        };
      }
      if (word === '開く') {
        return {
          data: [
            { definitions: ['to open'], reading: 'あく' },
            undefined,
            { reading: 'あく', pitches: [{ position: 0 }] },
          ],
        };
      }
      return null;
    });
    extractProsodyDataForReadingMock.mockImplementation((
      raw: unknown,
      _languageData: LanguageData | null,
      readingMatches: (reading: string) => boolean,
    ) => {
      const data = Array.isArray(raw) ? raw : [raw];
      for (const item of data) {
        if (
          typeof item === 'object'
          && item !== null
          && 'reading' in item
          && 'pitches' in item
          && readingMatches(String(item.reading))
        ) {
          const pitch = Array.isArray(item.pitches) ? item.pitches[0] : null;
          return {
            type: 'japanese-pitch-accent',
            position: typeof pitch?.position === 'number' ? pitch.position : undefined,
            raw: item,
          };
        }
      }
      return undefined;
    });
    extractReadingValueMock.mockImplementation((raw: unknown) => {
      if (typeof raw === 'object' && raw !== null && 'reading' in raw) {
        return String(raw.reading);
      }
      return null;
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'あく', alternateReadings: ['ひらく'] })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'あく',
      prosodyPosition: 0,
      class: 'prosody-overlay-wrapper--reading',
    }));
    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'ひらく',
      prosodyPosition: 2,
    }));

    dispose();
  });

  it('renders alternate reading pitch pills when structured dictionary prosody is not in slot 2', async () => {
    getCachedReadingMock.mockReturnValue(null);
    getCachedTranslationMock.mockImplementation((word: string) => {
      if (word === 'ひらく') {
        return {
          data: [
            { definitions: ['to open'], reading: 'ひらく' },
            { reading: 'ひらく', pitches: [{ position: 2 }] },
            [],
          ],
        };
      }
      return null;
    });
    extractProsodyDataMock.mockImplementation((raw: unknown) => {
      const data = Array.isArray(raw) ? raw : [raw];
      return data.some((item) => (
        typeof item === 'object'
        && item !== null
        && 'reading' in item
        && item.reading === 'ひらく'
      ))
        ? {
            type: 'japanese-pitch-accent',
            position: 2,
            raw,
          }
        : undefined;
    });
    extractProsodyDataForReadingMock.mockImplementation((
      _raw: unknown,
      _languageData: LanguageData | null,
      readingMatches: (reading: string) => boolean,
    ) => {
      return readingMatches('ひらく')
        ? {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
          }
        : undefined;
    });
    extractReadingValueMock.mockImplementation((raw: unknown) => {
      const data = Array.isArray(raw) ? raw : [raw];
      const match = data.find((item) => (
        typeof item === 'object'
        && item !== null
        && 'reading' in item
        && item.reading === 'ひらく'
      ));
      return match ? 'ひらく' : null;
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'あく', alternateReadings: ['ひらく'] })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps.some((props) => (
      props.word === 'ひらく'
      && props.prosodyPosition === 2
    ))).toBe(true);
    expect(prosodyOverlayProps.some((props) => (
      props.word === '開く'
      && props.prosodyPosition === 2
    ))).toBe(false);

    dispose();
  });

  it('renders saved prosody pills for alternate displayed readings', async () => {
    extractProsodyDataForReadingMock.mockImplementation((
      raw: unknown,
      _languageData: LanguageData | null,
      readingMatches: (reading: string) => boolean,
    ) => {
      const reading = typeof raw === 'object' && raw !== null && 'reading' in raw
        ? String(raw.reading)
        : '';
      return readingMatches(reading)
        ? {
            type: 'japanese-pitch-accent',
            position: 2,
            raw,
          }
        : undefined;
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', {
          reading: 'あく',
          alternateReadings: ['ひらく'],
          prosody: {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
          },
        })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps.some((props) => (
      props.word === 'ひらく'
      && props.prosodyPosition === 2
    ))).toBe(true);

    dispose();
  });

  it('renders saved position-only prosody on every displayed reading', async () => {
    extractProsodyDataForReadingMock.mockReturnValue(undefined);
    extractReadingValueMock.mockReturnValue(null);
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', {
          reading: 'あく',
          alternateReadings: ['ひらく'],
          prosody: {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { type: 'japanese-pitch-accent', position: 2 },
          },
        })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'あく',
      prosodyPosition: 2,
      class: 'prosody-overlay-wrapper--reading',
    }));
    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'ひらく',
      prosodyPosition: 2,
    }));

    dispose();
  });

  it('draws saved prosody on every displayed reading even when the cached row reading differs', async () => {
    getCachedReadingMock.mockReturnValue('あく');
    extractProsodyDataForReadingMock.mockReturnValue(undefined);
    extractReadingValueMock.mockReturnValue(null);
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', {
          reading: 'ひらく',
          prosody: {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { type: 'japanese-pitch-accent', position: 2 },
          },
        })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'あく',
      prosodyPosition: 2,
      class: 'prosody-overlay-wrapper--reading',
    }));
    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'ひらく',
      prosodyPosition: 2,
    }));
    expect(container.textContent).toContain('ひらく');

    dispose();
  });

  it('renders stored prosody with its saved renderer when current metadata has no prosody model', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Plain language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
        },
      },
    });
    extractProsodyDataForReadingMock.mockReturnValue(undefined);
    extractReadingValueMock.mockReturnValue(null);
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', {
          reading: 'ひらく',
          prosody: {
            type: 'japanese-pitch-accent',
            position: 2,
            raw: { type: 'japanese-pitch-accent', position: 2 },
          },
        })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(prosodyOverlayProps).toContainEqual(expect.objectContaining({
      word: 'ひらく',
      prosodyPosition: 2,
      prosodyType: 'japanese-pitch-accent',
      class: 'prosody-overlay-wrapper--reading',
    }));
    expect(container.querySelector('.word-db-prosody-preview')).toBeNull();

    dispose();
  });

  it('queues each visible alternate reading for its own dictionary/prosody lookup', async () => {
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('開く', { reading: 'あく', alternateReadings: ['ひらく'] })}
        levelNames={{ 0: 'JLPT N5' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    await new Promise((resolve) => setTimeout(resolve, 700));
    await flushAsync();

    expect(fetchTranslationMock).toHaveBeenCalledWith('開く', 'ja', expect.any(Object));
    expect(fetchTranslationMock).toHaveBeenCalledWith('ひらく', 'ja', expect.any(Object));

    dispose();
  });

  it('does not invent reading annotations for Latin metadata', async () => {
    mockLanguageData = makeLanguageData({
      name: 'German',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('Haus', { reading: 'house' })}
        levelNames={{ 0: 'A1' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.querySelector('[data-testid="pitch-accent-overlay"]')).toBeNull();

    dispose();
  });

  it('supports non-Japanese Han reading annotations from metadata', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Chinese',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Latn'],
          readingNormalizer: 'lowercase-strip-diacritics',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          readingSeparator: ' ',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('你好', { reading: 'ni hao' })}
        levelNames={{ 0: 'HSK 1' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    const ruby = container.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toBe('ni hao');

    dispose();
  });

  it('uses metadata-selected inline reading annotations in word database rows', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Arabic',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Latn'],
        },
        readingAnnotation: {
          type: 'script-reading',
          display: 'inline',
          annotationScripts: ['Arab'],
          readingSeparator: ' ',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('بيت', { reading: 'bayt' })}
        levelNames={{ 0: 'A1' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.ruby-text-inline')).not.toBeNull();
    expect(container.textContent).toContain('بيت');
    expect(container.textContent).toContain('bayt');

    dispose();
  });

  it('shows package-defined prosody positions without Japanese pitch-accent overlay', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Chinese',
      prosody: {
        type: 'tone-contour',
        positionLabel: 'Tone position',
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          readingSeparator: ' ',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('妈', {
          reading: 'ma1',
          prosody: {
            type: 'tone-contour',
            position: 1,
            raw: { tone: 'high-level' },
          },
        })}
        levelNames={{ 0: 'HSK 1' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('[data-testid="pitch-accent-overlay"]')).toBeNull();
    expect(container.querySelector('.word-db-prosody-preview')).toBeNull();

    dispose();
  });

  it('does not show an undeclared zero frequency level as a real language level', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Frequency language',
      frequencyLevels: {
        fallbackLabelTemplate: 'Band {level}',
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('alpha', { level: 0 })}
        levelNames={{}}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.textContent).not.toContain('Band 0');
    expect(container.querySelector('.col.level')?.textContent?.trim()).toBe('-');

    dispose();
  });

  it('shows zero frequency levels when the language declares zero as a real band', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Frequency language',
      frequencyLevels: {
        names: { '0': 'Band Zero' },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('alpha', { level: 0 })}
        levelNames={{ 0: 'Band Zero' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector('.col.level')?.textContent).toContain('Band Zero');

    dispose();
  });

  it('uses language metadata typography for word content', async () => {
    mockLanguageData = makeLanguageData({
      name: 'Chinese',
      typography: {
        contentFontFamily: '"Noto Serif CJK SC"',
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Latn'],
          readingNormalizer: 'lowercase-strip-diacritics',
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          readingSeparator: ' ',
        },
      },
    });
    const { WordEntryRow } = await import('./WordEntryRow');

    const dispose = render(() => (
      <WordEntryRow
        entry={makeEntry('你好', { reading: 'ni hao' })}
        levelNames={{ 0: 'HSK 1' }}
        onStatusChange={() => undefined}
        onAddFlashcard={() => undefined}
        onRemoveFlashcard={() => undefined}
      />
    ), container);

    expect(container.querySelector<HTMLElement>('.word-text')?.style.getPropertyValue('font-family'))
      .toBe('"Noto Serif CJK SC"');

    dispose();
  });
});
