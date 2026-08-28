// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

const mockLanguageData: LanguageData = {
  name: 'Chinese',
  settings: { fixed: {} },
  textProcessing: { scriptProfile: { acceptedScripts: ['Han', 'Latn'] } },
  runtime: {
    nlp: {
      dictionary: {
        readingPath: ['pinyin', 'value'],
      },
    },
  },
};
const prosodyOverlayProps: Array<{ word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }> = [];
let mockUseAnki = false;
let mockCurrentLanguageData: LanguageData = mockLanguageData;
const findAnkiWordMatchInCacheMock = vi.fn((_candidates: string[], _options?: unknown) => null);
let mockComprehensiveStatus: { status: string; basis: string; source: string; timesSeen: number } = { status: 'unknown', basis: 'unmeasured', source: 'None', timesSeen: 0 };
let mockAspectStatus: (aspect: string) => { status: string; untracked?: boolean } = () => ({ status: 'unknown', untracked: true });
let mockProjection: unknown = { status: 'unavailable', targets: [] };
const langDataByCode = { get zh() { return mockCurrentLanguageData; } };

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});

vi.stubGlobal('ResizeObserver', class MockResizeObserver {
  observe() {}
  disconnect() {}
});

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'zh',
      theme: 'dark',
      showProsody: false,
      show_pos: false,
      use_anki: mockUseAnki,
      skipAnkiDuplicateWarning: false,
      flashcardMediaType: 'image',
      srsLearningThreshold: 1500,
      known_ease_threshold: 2500,
    },
    updateSettings: vi.fn(),
  }),
  useFlashcards: () => ({
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    addFlashcard: vi.fn(),
    hasWordSync: () => false,
    getCardByWordSync: () => null,
    getComprehensiveWordStatusWithSourceSync: () => ({
      status: mockComprehensiveStatus.status,
      basis: mockComprehensiveStatus.basis,
      evidenceStatus: 'unknown',
      source: mockComprehensiveStatus.source,
      timesSeen: mockComprehensiveStatus.timesSeen,
    }),
    getAspectStatus: (_word: string, aspect: string) => mockAspectStatus(aspect),
  }),
  useLanguage: () => ({
    langData: langDataByCode,
    getFrequency: () => null,
    getLevelName: (level: number) => `Level ${level}`,
    getFreqLevelNames: () => [],
    getLanguageFeatures: () => ({
      prosodyRenderer: undefined,
      supportsProsody: false,
      tokenizerCapabilities: {},
    }),
    currentLangData: () => mockCurrentLanguageData,
    getCanonicalForm: (word: string) => word,
    getWordVariants: () => [],
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useGraph: () => ({
    meta: () => ({ ready: false, status: 'idle' }),
    getTargetsForSurfaces: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTokenizer: () => ({ tokenize: vi.fn(async () => []) }),
  getCachedTranslation: () => null,
}));

vi.mock('../../services/statsService', () => ({
  toUniqueIdentifier: vi.fn(async () => 'word-id'),
}));

vi.mock('../../services/llmProvider', () => ({
  getCachedExplanation: () => null,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  ankiCacheVersion: () => 0,
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  findAnkiWordMatchInCache: (candidates: string[], options?: unknown) => findAnkiWordMatchInCacheMock(candidates, options),
  isAnkiCacheFetched: () => true,
}));

vi.mock('../common', () => ({
  Btn: (props: { children?: JSX.Element; label?: string; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>{props.label ?? props.children}</button>
  ),
  Modal: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  PillBtn: (props: { label?: string; children?: JSX.Element }) => <button type="button">{props.label ?? props.children}</button>,
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  ToggleSwitch: () => <input type="checkbox" />,
  SafeHtml: (props: { tag: string; class?: string; html?: string }) => {
    const el = document.createElement(props.tag);
    if (props.class) el.className = props.class;
    el.innerHTML = props.html ?? '';
    return el;
  },
  KnowledgeCapabilityChips: () => null,
  KnowledgeProjectionDrawer: () => null,
}));

vi.mock('../language-specific', () => ({
  ProsodyOverlay: (props: { word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }) => {
    prosodyOverlayProps.push({
      word: props.word,
      reading: props.reading,
      prosodyPosition: props.prosodyPosition,
      prosodyType: props.prosodyType,
    });
    return <span />;
  },
}));

vi.mock('../common/Smart', () => ({
  ResourcePill: () => <span />,
  WordStatusPill: (props: { word: string; onStatusChange?: (status: 'unknown' | 'learning' | 'known') => void }) => (
    <button
      type="button"
      data-testid="word-status-pill"
      data-word={props.word}
      onClick={() => props.onStatusChange?.('known')}
    >
      pill
    </button>
  ),
}));

vi.mock('../../services/wordLookupService', () => ({
  openWordLookup: vi.fn(),
}));

vi.mock('../../services/videoClipService', () => ({
  clipVideo: vi.fn(),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    flashcards: {
      saveFlashcardImage: vi.fn(async () => ''),
    },
    graph: {
      getKnowledgeProjection: vi.fn(async () => mockProjection),
    },
  }),
}));

vi.mock('../common/Feedback/Toast', () => ({
  showToast: vi.fn(),
}));

describe('WordHover', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    prosodyOverlayProps.length = 0;
    mockUseAnki = false;
    mockCurrentLanguageData = mockLanguageData;
    mockComprehensiveStatus = { status: 'unknown', basis: 'unmeasured', source: 'None', timesSeen: 0 };
    mockAspectStatus = () => ({ status: 'unknown', untracked: true });
    mockProjection = { status: 'unavailable', targets: [] };
    findAnkiWordMatchInCacheMock.mockClear();
    findAnkiWordMatchInCacheMock.mockReturnValue(null);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders package-declared dictionary readings in translation entries', async () => {
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: ['hello'],
          }],
        }}
        visible={true}
      />
    ), container);

    expect(container.querySelector('.hover_translation')?.textContent).toContain('hello');
    expect(container.querySelector('.hover_reading')?.textContent).toBe('nǐ hǎo');
    dispose();
  });

  it('does not mount the Japanese pitch renderer when the language does not use Japanese pitch accents', async () => {
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: ['hello'],
          }],
        }}
        visible={true}
      />
    ), container);

    expect(prosodyOverlayProps).toHaveLength(0);
    dispose();
  });

  it('uses language metadata normalizers when matching token hover words against the Anki cache', async () => {
    mockUseAnki = true;
    mockCurrentLanguageData = {
      name: 'Persian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Arab'],
          surfaceNormalizers: ['persian-arabic'],
        },
      },
    };
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: 'كِتــاب', surface: 'كِتــاب', actual_word: 'كِتــاب', type: 'word' }}
        word="كِتــاب"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: 'كِتــاب',
            definitions: ['book'],
          }],
        }}
        visible={true}
      />
    ), container);

    const candidateCalls = findAnkiWordMatchInCacheMock.mock.calls.map((call: [string[], unknown?]) => call[0]);
    expect(candidateCalls).toContainEqual(['كِتــاب', 'كِتاب', 'كتاب', 'کتاب']);

    dispose();
  });

  it('exposes the Knowledge pill in the pills row and forwards status changes without opening a deep inspector', async () => {
    const { WordHover } = await import('./WordHover');
    const onStatusChange = vi.fn();

    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: ['hello'],
          }],
        }}
        visible={true}
        onStatusChange={onStatusChange}
      />
    ), container);

    const pill = container.querySelector<HTMLButtonElement>('[data-testid="word-status-pill"]');
    expect(pill).not.toBeNull();
    expect(pill!.dataset.word).toBe('你好');
    expect(pill!.closest('.pills')).not.toBeNull();

    pill!.click();
    expect(onStatusChange).toHaveBeenCalledWith('known');
    expect(container.querySelector('.knowledge-drawer')).toBeNull();

    dispose();
  });

  it('renders the same compact capability summary as the knowledge popover (per-aspect status + basis tokens)', async () => {
    mockCurrentLanguageData = {
      name: 'Chinese',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
        readingAnnotation: { type: 'script-reading' },
      },
    };
    // Meaning: aggregate explicit claim via getComprehensiveWordStatusWithSourceSync.
    mockComprehensiveStatus = { status: 'known', basis: 'claim', source: 'Manual', timesSeen: 3 };
    // Reading: resolver status + graph projection prediction.
    mockAspectStatus = (aspect: string) => aspect === 'reading' ? { status: 'learning' } : { status: 'unknown', untracked: true };
    mockProjection = {
      status: 'ready',
      surfaceId: 'zh:surface:1',
      targets: [{
        targetRef: { kind: 'surface', id: 'zh:surface:1' },
        applicableCapabilities: ['surface-reading'],
        states: [{
          capability: 'surface-reading',
          classification: 'predicted',
          basis: 'prediction',
          evidence: [],
          evidenceSourceCounts: {},
          prediction: { value: 0.8, reasons: ['related known target'] },
        }],
      }],
    };

    const { WordHover } = await import('./WordHover');
    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        visible={true}
      />
    ), container);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = Array.from(container.querySelectorAll('.knowledge-capability-summary__item'));
    expect(items.length).toBeGreaterThan(0);
    const meaning = items.find((el) => el.textContent?.includes('mlearn.Knowledge.Aspect.Meaning'));
    const reading = items.find((el) => el.textContent?.includes('mlearn.Knowledge.Aspect.Reading'));
    // Same derivation the pinned popover renders; basis lives in the tooltip.
    expect(meaning?.getAttribute('title')).toContain('mlearn.WordHover.Status.Known');
    expect(meaning?.getAttribute('title')).toContain('mlearn.Knowledge.Basis.Claim');
    expect(reading?.textContent).toContain('mlearn.WordHover.Status.Learning');
    expect(reading?.getAttribute('title')).toContain('mlearn.Knowledge.Basis.Prediction');

    dispose();
  });
});
