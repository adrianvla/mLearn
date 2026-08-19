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
const getAspectStatusMock = vi.fn();

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

const genderLanguageData: LanguageData = {
  name: 'Gender Language',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
    readingAnnotation: { type: 'script-reading' },
  },
  gender: { attributeKey: 'gender' },
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
    langData: { ja: richLanguageData, de: plainLanguageData, ru2: genderLanguageData },
    currentLangData: () => currentLang,
    getCanonicalForm: (word: string) => word,
    getWordVariants: () => [],
    getCanonicalFormForLanguage: (_language: string, word: string) => word,
    getWordVariantsForLanguage: () => [],
  }),
  useFlashcards: () => ({
    setAspectStatus: setAspectStatusMock,
    getComprehensiveWordStatusWithSourceSync: getComprehensiveWordStatusWithSourceSyncMock,
    getAspectStatus: getAspectStatusMock,
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
    // Faithful mini-mock of getAspectStatusSync: record → its status (legacy
    // inherited flag preserved); absent record → untracked for EVERY aspect —
    // meaning-known never fabricates finer-aspect knowledge.
    getAspectStatusMock.mockImplementation((_word: string, aspect: KnowledgeAspect) => {
      if (aspect === 'meaning') {
        return { status: comprehensiveResult('known').status, ease: 2.5, source: 'None', inherited: false };
      }
      const record = wordKnowledge[knowledgeKey('apple')]?.aspects?.[aspect];
      if (record) return { status: record.status, ease: record.ease, source: record.source, inherited: record.inherited === true };
      return { status: 'unknown', ease: 0, source: 'None', inherited: false, untracked: true };
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('renders meaning plus only evidenced aspect rows (untracked aspects hidden)', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    // Reading/prosody have no records: untracked, hidden — no fabricated rows.
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Reading');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Prosody');

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

  it('shows no inherited marker for explicit records; untracked siblings are hidden', () => {
    seedEntry({ reading: aspectRecord('known') });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.textContent).not.toContain('mlearn.Knowledge.AspectInherited');
    // Prosody has no record: hidden, not inherited.
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Prosody');

    dispose();
  });

  it('shows the inherited marker only for legacy cascade-seeded records (inherited flag)', () => {
    seedEntry({ reading: aspectRecord('known', true) });
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    // The flag is a legacy marker from the removed cascade seed; it still displays.
    expect(container.textContent.match(/mlearn\.Knowledge\.AspectInherited/g)).toHaveLength(1);

    dispose();
  });

  it('hides an orthogonal aspect without evidence entirely (interim applicability rule)', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" language="ru2" />, container);

    // No evidence: hidden, not "Untracked" — a Russian verb must not display a
    // meaningless Gender row. Reading is untracked here too (no inheritance).
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Gender');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Untracked');
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

  it('feeds the history graph the visible (evidenced) aspects only', () => {
    const dispose = render(() => <WordStatusPillKnowledge word="apple" />, container);

    expect(container.querySelector('[data-testid="mock-knowledge-history-graph"]')?.textContent).toBe(
      'meaning',
    );

    dispose();
  });
});
