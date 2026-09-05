// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { LanguageData, PassiveWordKnowledge, AspectKnowledge } from '../../../../shared/types';
import type { WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { WordStatusPillKnowledge } from './WordStatusPillKnowledge';

const getComprehensiveWordStatusWithSourceSyncMock = vi.fn();
const getAspectStatusMock = vi.fn();
const recordAttemptMock = vi.fn();
const onPinMock = vi.fn();
const onCloseMock = vi.fn();
const openWordDbEditorMock = vi.fn();

let projectionMock: unknown;

let currentLang: LanguageData = { name: 'Japanese', settings: { fixed: {} } };
let wordKnowledge: Record<string, PassiveWordKnowledge> = {};

const richLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    readingAnnotation: { type: 'script-reading' },
  },
  prosody: { type: 'japanese-pitch-accent' },
};

const plainLanguageData: LanguageData = {
  name: 'German',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
  },
};

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: 'ja', ratingKeyboardMode: 'mnemonic' } }),
  useLanguage: () => ({
    langData: { ja: richLanguageData, de: plainLanguageData },
    currentLangData: () => currentLang,
    getCanonicalForm: (word: string) => word,
    getWordVariants: () => [],
    getCanonicalFormForLanguage: (_language: string, word: string) => word,
    getWordVariantsForLanguage: () => [],
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getComprehensiveWordStatusWithSourceSync: getComprehensiveWordStatusWithSourceSyncMock,
    getAspectStatus: getAspectStatusMock,
    recordAttempt: recordAttemptMock,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => (
      params?.count ? `${key}:${params.count}` : key
    ),
  }),
}));

/** Flush the microtask queue + timers so createEffect promise callbacks settle. */
const flush = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
};

// The matrix contract under test: applicable rows in, one profile submission out.
vi.mock('../RatingMatrix', () => ({
  RatingMatrix: (props: {
    aspects: readonly string[];
    onProfileSubmit?: (observations: readonly { aspect: string; quality: string }[]) => void;
  }) => (
    <div data-testid="mock-rating-matrix">
      {props.aspects.join(',')}
      <button
        type="button"
        onClick={() => props.onProfileSubmit?.([{ aspect: props.aspects[0], quality: 'fluent' }])}
      >
        mock-matrix-submit
      </button>
    </div>
  ),
}));

vi.mock('../../../services/openWordDbEditor', () => ({
  openWordDbEditor: (...args: unknown[]) => openWordDbEditorMock(...(args as [string])),
}));

const getKnowledgeProjectionSpy = vi.fn(async (_language: string, _word: string) => projectionMock);
vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    graph: {
      getKnowledgeProjection: (...args: unknown[]) => getKnowledgeProjectionSpy(...(args as [string, string])),
    },
  }),
}));

const knowledgeKey = (word: string, language = 'ja'): string => `${language}:${hashWordSync(word)}`;

const aspectRecord = (status: WordStatus): AspectKnowledge => ({
  status,
  ease: status === 'known' ? 1.8 : status === 'learning' ? 1.55 : 1.3,
  source: 'Manual',
  lastStatusChange: 1,
  updatedAt: 1,
});

const seedEntry = (aspects: Partial<Record<Exclude<KnowledgeAspect, 'meaning'>, AspectKnowledge>>): void => {
  wordKnowledge[knowledgeKey('apple')] = {
    ease: 2.5,
    lastSeen: 1,
    timesSeen: 0,
    timesHovered: 0,
    word: 'apple',
    language: 'ja',
    aspects,
  };
};

const comprehensiveResult = (status: WordStatus, basis: 'claim' | 'evidence' | 'unmeasured' = status === 'unknown' ? 'unmeasured' : 'claim') => ({
  status,
  basis,
  evidenceStatus: status,
  source: basis === 'claim' ? 'Manual' : basis === 'unmeasured' ? 'None' : 'PassiveTracking',
  timesSeen: 0,
  matchedWord: undefined,
});

const buttons = (container: HTMLDivElement, label: string): HTMLButtonElement[] => (
  Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent === label,
  ) as HTMLButtonElement[]
);

describe('WordStatusPillKnowledge', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    projectionMock = undefined;
    currentLang = richLanguageData;
    wordKnowledge = {};
    getComprehensiveWordStatusWithSourceSyncMock.mockReturnValue(comprehensiveResult('known'));
    // Faithful mini-mock of getAspectStatusSync: record → its status; absent
    // record → untracked for EVERY aspect — meaning-known never fabricates
    // finer-aspect knowledge.
    getAspectStatusMock.mockImplementation((_word: string, aspect: KnowledgeAspect) => {
      if (aspect === 'meaning') {
        return { status: comprehensiveResult('known').status, ease: 2.5, source: 'None' };
      }
      const record = wordKnowledge[knowledgeKey('apple')]?.aspects?.[aspect];
      if (record) return { status: record.status, ease: record.ease, source: record.source };
      return { status: 'unknown', ease: 0, source: 'None', untracked: true };
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('renders every applicable aspect with Untracked shown for unmeasured ones', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Reading');
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Prosody');
    expect(container.textContent).toContain('mlearn.Knowledge.Untracked');

    dispose();
  });

  it('omits aspects the language does not support', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" language="de" />, container);

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Reading');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Prosody');

    dispose();
  });

  it('labels aspect statuses with the WordHover status keys', () => {
    seedEntry({
      reading: aspectRecord('learning'),
      prosody: aspectRecord('unknown'),
    });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).toContain('mlearn.WordHover.Status.Known');
    expect(container.textContent).toContain('mlearn.WordHover.Status.Learning');
    expect(container.textContent).toContain('mlearn.WordHover.Status.Unknown');

    dispose();
  });

  it('header shows Untracked — never Unknown — for a word without claim or evidence', () => {
    getComprehensiveWordStatusWithSourceSyncMock.mockReturnValue(comprehensiveResult('unknown'));
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    const header = container.querySelector('.word-status-knowledge__status');
    expect(header?.textContent).toContain('mlearn.Knowledge.Untracked');
    expect(header?.textContent).not.toContain('mlearn.WordHover.Status.Unknown');

    dispose();
  });

  it('header shows Unknown only for an explicit negative claim', () => {
    getComprehensiveWordStatusWithSourceSyncMock.mockReturnValue(comprehensiveResult('unknown', 'claim'));
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    const header = container.querySelector('.word-status-knowledge__status');
    expect(header?.textContent).toContain('mlearn.WordHover.Status.Unknown');
    expect(header?.textContent).not.toContain('mlearn.Knowledge.Untracked');

    dispose();
  });

  it('keeps the basis in the row tooltip, not as visible debug text', () => {
    seedEntry({ reading: aspectRecord('learning') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    const titles = Array.from(container.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '');
    expect(titles.some((title) => title.includes('mlearn.Knowledge.Aspect.Reading') && title.includes('mlearn.Knowledge.Basis.Evidence'))).toBe(true);
    expect(container.textContent).not.toContain('mlearn.Knowledge.Basis.Evidence');

    dispose();
  });

  it('fetches the knowledge projection for the surface once', async () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);
    await flush();

    expect(getKnowledgeProjectionSpy).toHaveBeenCalledWith('ja', 'apple');

    dispose();
  });

  it('pins the popup and reveals the matrix only through Rate…, submitting one profile attempt', async () => {
    seedEntry({ reading: aspectRecord('learning') });
    const dispose = render(
      () => <WordStatusPillKnowledge word="apple" onPin={onPinMock} onClose={onCloseMock} />,
      container,
    );

    expect(container.querySelector('[data-testid="mock-rating-matrix"]')).toBeNull();

    buttons(container, 'mlearn.Knowledge.Popup.Rate')[0]?.click();
    expect(onPinMock).toHaveBeenCalled();

    const matrix = container.querySelector('[data-testid="mock-rating-matrix"]');
    expect(matrix?.textContent).toContain('meaning');
    expect(matrix?.textContent).toContain('reading');
    expect(matrix?.textContent).toContain('prosody');

    buttons(container, 'mock-matrix-submit')[0]?.click();
    await flush();

    expect(recordAttemptMock).toHaveBeenCalledTimes(1);
    const submission = recordAttemptMock.mock.calls[0] as unknown[] | undefined; // our own mock input, shape fixed above
    const [word, aspect, quality, opts] = submission ?? [];
    expect(word).toBe('apple');
    expect(aspect).toBe('meaning');
    expect(quality).toBe('fluent');
    const attemptOpts = opts && typeof opts === 'object' && 'attemptId' in opts ? opts : undefined;
    expect(attemptOpts && typeof attemptOpts.attemptId === 'string' && attemptOpts.attemptId.length > 0).toBe(true);
    expect(container.querySelector('[data-testid="mock-rating-matrix"]')).toBeNull();
    expect(onCloseMock).toHaveBeenCalled();

    dispose();
  });

  it('opens the Word DB inspector through Inspect… and writes nothing', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    buttons(container, 'mlearn.Knowledge.Popup.Inspect')[0]?.click();

    expect(openWordDbEditorMock).toHaveBeenCalledWith('apple');
    expect(recordAttemptMock).not.toHaveBeenCalled();

    dispose();
  });

  it('shows the matrix even when targets are untracked — a rating is what measures them', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    buttons(container, 'mlearn.Knowledge.Popup.Rate')[0]?.click();

    const matrix = container.querySelector('[data-testid="mock-rating-matrix"]');
    expect(matrix?.textContent).toContain('reading');
    expect(matrix?.textContent).toContain('prosody');

    dispose();
  });
});
