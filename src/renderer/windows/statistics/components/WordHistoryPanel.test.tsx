// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { Flashcard, LanguageData, PassiveWordKnowledge } from '../../../../shared/types';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { HistoryCurvePoint, SourceReignBand } from '../../../utils/knowledgeHistory';
import { WordHistoryPanel } from './WordHistoryPanel';

const h = vi.hoisted(() => ({
  wordGetter: (() => '') as () => string,
  aspectGetter: (() => 'meaning') as () => string,
  events: [] as KnowledgeEvent[],
  points: [] as HistoryCurvePoint[],
  bands: [] as SourceReignBand[],
  currentLang: { name: 'Japanese', settings: { fixed: {} } } as LanguageData,
  wordKnowledge: {} as Record<string, PassiveWordKnowledge>,
  flashcards: {} as Record<string, Flashcard>,
}));

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: 'ja' } }),
  useLanguage: () => ({
    currentLangData: () => h.currentLang,
  }),
  useFlashcards: () => ({ store: { wordKnowledge: h.wordKnowledge, flashcards: h.flashcards } }),
  useLocalization: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../hooks/useKnowledgeHistory', () => ({
  useKnowledgeHistory: (word: () => string, aspect: () => string) => {
    h.wordGetter = word;
    h.aspectGetter = aspect;
    return {
      events: () => h.events,
      replay: () => ({ points: h.points, bands: h.bands }),
    };
  },
}));

const richLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    readingAnnotation: { type: 'script-reading' },
  },
  prosody: { type: 'japanese-pitch-accent' },
};

const knowledgeEntry = (word: string): PassiveWordKnowledge => ({
  ease: 2.5,
  lastSeen: 1,
  timesSeen: 1,
  timesHovered: 0,
  word,
});

const makeFlashcard = (id: string, front: string): Flashcard => ({
  id,
  language: 'ja',
  content: { type: 'word', front, back: 'x' },
  state: 'review',
  ease: 2.5,
  interval: 0,
  dueDate: 0,
  reviews: 1,
  lapses: 0,
  learningStep: 0,
  createdAt: 1000,
  lastReviewed: 0,
  lastUpdated: 1000,
});

const searchInput = (container: HTMLDivElement): HTMLInputElement => {
  const input = container.querySelector('input');
  if (!input) throw new Error('search input not rendered');
  return input as HTMLInputElement;
};

const typeQuery = (container: HTMLDivElement, value: string): void => {
  const input = searchInput(container);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const tabButton = (container: HTMLDivElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!button) throw new Error(`tab ${label} not rendered`);
  return button as HTMLButtonElement;
};

describe('WordHistoryPanel', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    h.wordGetter = () => '';
    h.aspectGetter = () => 'meaning';
    h.events = [];
    h.points = [];
    h.bands = [];
    h.currentLang = { name: 'Japanese', settings: { fixed: {} } };
    h.wordKnowledge = {};
    h.flashcards = {};
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('renders the word search input with the localized placeholder', () => {
    const dispose = render(() => <WordHistoryPanel />, container);

    expect(searchInput(container).getAttribute('placeholder')).toBe(
      'mlearn.Statistics.WordHistory.SearchPlaceholder',
    );
    expect(container.textContent).toContain('mlearn.Statistics.WordHistory.Title');
    expect(container.textContent).toContain('mlearn.Statistics.WordHistory.Prompt');

    dispose();
  });

  it('feeds the history hook the entered word and renders the full graph', () => {
    h.wordKnowledge['ja:abc'] = knowledgeEntry('apple');
    const dispose = render(() => <WordHistoryPanel />, container);

    typeQuery(container, 'apple');

    expect(h.wordGetter()).toBe('apple');
    expect(container.querySelector('.khistory-mode-full')).not.toBeNull();

    dispose();
  });

  it('renders one row per event with status transition and source labels', () => {
    h.wordKnowledge['ja:abc'] = knowledgeEntry('apple');
    h.events = [
      { t: 1000, kind: 'status', source: 'srs', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' },
      { t: 2000, kind: 'review', source: 'passiveTracking', aspect: 'meaning', rating: 'good' },
    ];
    const dispose = render(() => <WordHistoryPanel />, container);

    typeQuery(container, 'apple');

    const rows = Array.from(container.querySelectorAll('.word-history-table tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('mlearn.Knowledge.History.Kind.Status');
    expect(rows[0]!.textContent).toContain('mlearn.WordHover.Status.Unknown');
    expect(rows[0]!.textContent).toContain('→');
    expect(rows[0]!.textContent).toContain('mlearn.WordHover.Status.Known');
    expect(rows[0]!.textContent).toContain('mlearn.Knowledge.History.Source.Srs');
    expect(rows[1]!.textContent).toContain('mlearn.Knowledge.History.Kind.Review');
    expect(rows[1]!.textContent).toContain('mlearn.Knowledge.History.Source.PassiveTracking');

    dispose();
  });

  it('shows the empty state when the selected word has no events', () => {
    h.wordKnowledge['ja:abc'] = knowledgeEntry('apple');
    const dispose = render(() => <WordHistoryPanel />, container);

    typeQuery(container, 'apple');

    expect(container.querySelector('.word-history-table')).toBeNull();
    expect(container.textContent).toContain('mlearn.Statistics.WordHistory.Empty');

    dispose();
  });

  it('lists matching tracked words from knowledge entries and flashcard fronts', () => {
    h.wordKnowledge['ja:abc'] = knowledgeEntry('apple');
    h.wordKnowledge['de:xyz'] = knowledgeEntry('apfel');
    h.flashcards['c1'] = makeFlashcard('c1', 'appletree');
    const dispose = render(() => <WordHistoryPanel />, container);

    typeQuery(container, 'app');

    const matchLabels = Array.from(container.querySelectorAll('.word-history-match')).map((b) => b.textContent);
    expect(matchLabels).toContain('apple');
    expect(matchLabels).toContain('appletree');
    expect(matchLabels).not.toContain('apfel');

    dispose();
  });

  it('switches the history hook aspect when a graph tab is clicked', () => {
    h.currentLang = richLanguageData;
    h.wordKnowledge['ja:abc'] = knowledgeEntry('apple');
    const dispose = render(() => <WordHistoryPanel />, container);

    typeQuery(container, 'apple');
    expect(h.aspectGetter()).toBe('meaning');

    tabButton(container, 'mlearn.Knowledge.Aspect.Reading').click();

    expect(h.aspectGetter()).toBe('reading');

    dispose();
  });
});
