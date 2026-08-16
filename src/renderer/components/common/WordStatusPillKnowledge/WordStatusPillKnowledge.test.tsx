// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { LanguageData, PassiveWordKnowledge, AspectKnowledge } from '../../../../shared/types';
import type { WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { WordStatusPillKnowledge } from './WordStatusPillKnowledge';

const setAspectStatusMock = vi.fn();
const getComprehensiveWordStatusWithSourceSyncMock = vi.fn();
const getWordKnowledgeMock = vi.fn();

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
  useSettings: () => ({ settings: { language: 'ja' } }),
  useLanguage: () => ({
    langData: { ja: richLanguageData, de: plainLanguageData },
    currentLangData: () => currentLang,
    getCanonicalForm: (word: string) => word,
    getWordVariants: () => [],
    getCanonicalFormForLanguage: (_language: string, word: string) => word,
    getWordVariantsForLanguage: () => [],
  }),
  useFlashcards: () => ({
    setAspectStatus: setAspectStatusMock,
    getComprehensiveWordStatusWithSourceSync: getComprehensiveWordStatusWithSourceSyncMock,
    getWordKnowledge: getWordKnowledgeMock,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => (
      params?.count ? `${key}:${params.count}` : key
    ),
  }),
}));

vi.mock('../KnowledgeHistoryGraph', () => ({
  KnowledgeHistoryGraph: (props: {
    aspect: string;
    availableAspects: readonly string[];
    onAspectChange: (aspect: string) => void;
  }) => (
    <div data-testid="mock-knowledge-history-graph">{props.availableAspects.join(',')}</div>
  ),
}));

vi.mock('../../../hooks/useKnowledgeHistory', () => ({
  useKnowledgeHistory: () => ({
    events: () => [],
    replay: () => ({ points: [], bands: [] }),
  }),
}));

const knowledgeKey = (word: string, language = 'ja'): string => `${language}:${hashWordSync(word)}`;

const aspectRecord = (status: WordStatus, inherited?: true): AspectKnowledge => ({
  status,
  ease: status === 'known' ? 1.8 : status === 'learning' ? 1.55 : 1.3,
  source: 'Manual',
  lastStatusChange: 1,
  updatedAt: 1,
  ...(inherited === true ? { inherited: true } : {}),
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

const comprehensiveResult = (status: WordStatus) => ({
  status,
  source: 'None',
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
    currentLang = richLanguageData;
    wordKnowledge = {};
    getComprehensiveWordStatusWithSourceSyncMock.mockReturnValue(comprehensiveResult('known'));
    getWordKnowledgeMock.mockImplementation((lk: string) => wordKnowledge[lk]);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders an aspect line per available aspect of the language', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Reading');
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Prosody');

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

  it('shows the inherited marker only for aspects without an aspect record', () => {
    seedEntry({ reading: aspectRecord('known') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent.match(/mlearn\.Knowledge\.AspectInherited/g)).toHaveLength(1);

    dispose();
  });

  it('shows the inherited marker for aspects initialized with the inherited flag', () => {
    seedEntry({ reading: aspectRecord('known', true) });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent.match(/mlearn\.Knowledge\.AspectInherited/g)).toHaveLength(2);

    dispose();
  });

  it('shows no inherited marker when every aspect has a record', () => {
    seedEntry({ reading: aspectRecord('known'), prosody: aspectRecord('known') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).not.toContain('mlearn.Knowledge.AspectInherited');

    dispose();
  });

  it('calls setAspectStatus with learning when Downgrade is clicked', () => {
    seedEntry({ reading: aspectRecord('known'), prosody: aspectRecord('known') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    buttons(container, 'mlearn.Knowledge.Actions.DowngradeToLearning')[0]?.click();

    expect(setAspectStatusMock).toHaveBeenCalledWith('apple', 'reading', 'learning', 'manual', 'ja');

    dispose();
  });

  it('calls setAspectStatus with unknown when Mark Unknown is clicked', () => {
    seedEntry({ reading: aspectRecord('known'), prosody: aspectRecord('known') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    buttons(container, 'mlearn.Knowledge.Actions.MarkUnknown')[0]?.click();

    expect(setAspectStatusMock).toHaveBeenCalledWith('apple', 'reading', 'unknown', 'manual', 'ja');

    dispose();
  });

  it('hides Downgrade when the aspect is learning or unknown', () => {
    seedEntry({ reading: aspectRecord('learning'), prosody: aspectRecord('learning') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(buttons(container, 'mlearn.Knowledge.Actions.DowngradeToLearning')).toHaveLength(0);
    expect(buttons(container, 'mlearn.Knowledge.Actions.MarkUnknown')).toHaveLength(2);

    dispose();
  });

  it('hides Mark Unknown when the aspect is already unknown', () => {
    seedEntry({ reading: aspectRecord('unknown'), prosody: aspectRecord('unknown') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(buttons(container, 'mlearn.Knowledge.Actions.DowngradeToLearning')).toHaveLength(0);
    expect(buttons(container, 'mlearn.Knowledge.Actions.MarkUnknown')).toHaveLength(0);

    dispose();
  });

  it('feeds the history graph with the compact mode and available aspects', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.querySelector('[data-testid="mock-knowledge-history-graph"]')?.textContent).toBe(
      'meaning,reading,prosody',
    );

    dispose();
  });
});
