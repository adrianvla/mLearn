// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import {
  WelcomeFlashcardPreview,
  WelcomeLevelPreview,
  WelcomeLookupPreview,
  WelcomeReaderPreview,
  WelcomeSettingsPreview,
  WelcomeStatsPreview,
  WelcomeTutorPreview,
  WelcomeVideoPreview,
} from './WelcomeFeaturePreviews';
import type { Flashcard } from '../../../../../shared/types';
import type { RecentItem } from '../../../../services/thumbnailService';
import type { LevelStats } from '../../../../utils/wordLevelStats';

const makeCard = (front: string, back: string, reading?: string): Flashcard => ({
  id: 'card-1',
  content: { type: 'word', front, back, reading },
  state: 'new',
  ease: 2.5,
  interval: 0,
  dueDate: 0,
  reviews: 0,
  lapses: 0,
  learningStep: 0,
  createdAt: 1,
  lastReviewed: 0,
  lastUpdated: 0,
  language: 'ja',
});

const makeRecentItem = (overrides: Partial<RecentItem> = {}): RecentItem => ({
  type: 'video',
  name: 'Clip',
  path: '/clip.mp4',
  progress: 40,
  lastWatched: 0,
  ...overrides,
});

const makeLevel = (level: number, knownPct: number): LevelStats => ({
  level,
  name: `L${level}`,
  total: 100,
  known: Math.round((knownPct / 100) * 100),
  learning: 0,
  unknown: 0,
  untracked: 0,
  knownPct,
  learningPct: 0,
  unknownPct: 0,
  untrackedPct: 0,
});

describe('WelcomeVideoPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('resumes the real item from the central play button and shows its progress', () => {
    const onResume = vi.fn();
    const item = makeRecentItem();
    const dispose = render(
      () => (
        <WelcomeVideoPreview
          item={item}
          emptyLabel="No video yet"
          continueLabel="Continue"
          onResume={onResume}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-player-title')?.textContent).toBe('Clip');
    const play = container.querySelector<HTMLButtonElement>('button.wfv-play');
    play?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResume).toHaveBeenCalledWith(item);

    const progress = container.querySelector<HTMLProgressElement>('progress.wfv-progress');
    expect(progress?.value).toBe(40);

    dispose();
  });

  it('keeps a physical player shell with description when there is no item', () => {
    const dispose = render(
      () => (
        <WelcomeVideoPreview
          item={null}
          emptyLabel="No video yet"
          continueLabel="Continue"
          onResume={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('div.wfv-player.wfv-player-empty')).not.toBeNull();
    expect(container.querySelector('.wfv-player-empty .wfv-empty')?.textContent).toBe('No video yet');
    expect(container.querySelector('button.wfv-play')).toBeNull();

    dispose();
  });
});

describe('WelcomeReaderPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('makes the whole page the resume button with the real title and progress', () => {
    const onResume = vi.fn();
    const item = makeRecentItem({ type: 'book', name: 'Chapter', path: '/book.pdf' });
    const dispose = render(
      () => (
        <WelcomeReaderPreview
          item={item}
          emptyLabel="No book yet"
          continueLabel="Continue"
          onResume={onResume}
        />
      ),
      container,
    );

    const page = container.querySelector<HTMLButtonElement>('button.wfv-page-button');
    expect(page?.getAttribute('aria-label')).toBe('Continue');
    expect(page?.querySelector('.wfv-page-title')?.textContent).toBe('Chapter');
    expect(page?.querySelector<HTMLProgressElement>('progress.wfv-progress')?.value).toBe(40);
    page?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onResume).toHaveBeenCalledWith(item);

    dispose();
  });

  it('keeps a physical page stack with description when there is no item', () => {
    const dispose = render(
      () => (
        <WelcomeReaderPreview
          item={null}
          emptyLabel="No book yet"
          continueLabel="Continue"
          onResume={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-page-stack')).not.toBeNull();
    expect(container.querySelector('.wfv-empty')?.textContent).toBe('No book yet');
    expect(container.querySelector('button.wfv-page-button')).toBeNull();

    dispose();
  });
});

describe('WelcomeFlashcardPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('flips the card locally when the stage is clicked', () => {
    const dispose = render(
      () => (
        <WelcomeFlashcardPreview
          card={makeCard('front', 'back')}
          loading={false}
          dueCount={3}
          dueLabel="Due"
          emptyLabel="None"
          loadingLabel="Loading"
          openLabel="Open"
          ratingButtons={[]}
          onOpen={() => {}}
          onRate={() => {}}
        />
      ),
      container,
    );

    const stage = container.querySelector('button.wfv-flashcard-stage');
    const inner = container.querySelector('.wfv-flashcard-inner');
    expect(inner?.classList.contains('flipped')).toBe(false);
    expect(stage?.getAttribute('aria-label')).toBe('front');
    expect(stage?.getAttribute('aria-pressed')).toBe('false');

    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(inner?.classList.contains('flipped')).toBe(true);
    expect(stage?.getAttribute('aria-label')).toBe('back');
    expect(stage?.getAttribute('aria-pressed')).toBe('true');

    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(inner?.classList.contains('flipped')).toBe(false);
    expect(stage?.getAttribute('aria-label')).toBe('front');
    expect(stage?.getAttribute('aria-pressed')).toBe('false');

    dispose();
  });

  it('renders the real front, optional reading, and back as plain escaped text', () => {
    const dispose = render(
      () => (
        <WelcomeFlashcardPreview
          card={makeCard('plain <front>', 'plain <back>', 'reading')}
          loading={false}
          dueCount={3}
          dueLabel="Due"
          emptyLabel="None"
          loadingLabel="Loading"
          openLabel="Open"
          ratingButtons={[]}
          onOpen={() => {}}
          onRate={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-flashcard-front .wfv-flashcard-text')?.textContent).toBe('plain <front>');
    expect(container.querySelector('.wfv-flashcard-front .wfv-flashcard-reading')?.textContent).toBe('reading');
    expect(container.querySelector('.wfv-flashcard-back .wfv-flashcard-text')?.textContent).toBe('plain <back>');
    expect(container.querySelector('.wfv-flashcard-due')?.textContent).toContain('Due: 3');

    dispose();
  });

  it('shows a deck shell with honest text when empty or loading', () => {
    const dispose = render(
      () => (
        <WelcomeFlashcardPreview
          card={null}
          loading={false}
          dueCount={0}
          dueLabel="Due"
          emptyLabel="No cards"
          loadingLabel="Loading"
          openLabel="Open"
          ratingButtons={[]}
          onOpen={() => {}}
          onRate={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-flashcard-shell')).not.toBeNull();
    expect(container.querySelector('.wfv-flashcard-shell .wfv-flashcard-text')?.textContent).toBe('No cards');
    expect(container.querySelector('button.wfv-flashcard-stage')).toBeNull();

    dispose();
  });

  it('renders rating buttons and forwards the chosen quality', () => {
    const onRate = vi.fn();
    const dispose = render(
      () => (
        <WelcomeFlashcardPreview
          card={makeCard('front', 'back')}
          loading={false}
          dueCount={3}
          dueLabel="Due"
          emptyLabel="None"
          loadingLabel="Loading"
          openLabel="Open"
          ratingButtons={[
            { quality: 'missed', label: 'Missed' },
            { quality: 'fluent', label: 'Fluent' },
          ]}
          onOpen={() => {}}
          onRate={onRate}
        />
      ),
      container,
    );

    const missed = container.querySelector('.wfv-flashcard-rating-missed');
    expect(missed).toBeNull();

    const stage = container.querySelector('button.wfv-flashcard-stage');
    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const missedAfterFlip = container.querySelector('.wfv-flashcard-rating-missed');
    const fluentAfterFlip = container.querySelector('.wfv-flashcard-rating-fluent');
    expect(missedAfterFlip?.textContent).toContain('Missed');
    expect(fluentAfterFlip).not.toBeNull();

    missedAfterFlip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRate).toHaveBeenCalledWith('missed');

    dispose();
  });

  it('swaps the footer row for the ratings fieldset while flipped', () => {
    const dispose = render(
      () => (
        <WelcomeFlashcardPreview
          card={makeCard('front', 'back')}
          loading={false}
          dueCount={3}
          dueLabel="Due"
          emptyLabel="None"
          loadingLabel="Loading"
          openLabel="Open"
          ratingButtons={[{ quality: 'fluent', label: 'Fluent' }]}
          onOpen={() => {}}
          onRate={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-flashcard-row')).not.toBeNull();
    expect(container.querySelector('.wfv-flashcard-ratings')).toBeNull();

    const stage = container.querySelector('button.wfv-flashcard-stage');
    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(container.querySelector('.wfv-flashcard-row')).toBeNull();
    expect(container.querySelector('.wfv-flashcard-ratings')).not.toBeNull();

    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(container.querySelector('.wfv-flashcard-row')).not.toBeNull();
    expect(container.querySelector('.wfv-flashcard-ratings')).toBeNull();

    dispose();
  });

  it('resets to the front when the card changes', () => {
    const dispose = render(
      () => {
        const [card, setCard] = createSignal<Flashcard | null>(makeCard('front', 'back'));
        return (
          <>
            <WelcomeFlashcardPreview
              card={card()}
              loading={false}
              dueCount={3}
              dueLabel="Due"
              emptyLabel="None"
              loadingLabel="Loading"
              openLabel="Open"
              ratingButtons={[]}
              onOpen={() => {}}
              onRate={() => {}}
            />
            <button type="button" class="next-card" onClick={() => setCard(makeCard('next', 'answer'))}>next</button>
          </>
        );
      },
      container,
    );

    const stage = container.querySelector('button.wfv-flashcard-stage');
    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.wfv-flashcard-inner')?.classList.contains('flipped')).toBe(true);

    (container.querySelector('button.next-card') as HTMLButtonElement).click();
    expect(container.querySelector('.wfv-flashcard-inner')?.classList.contains('flipped')).toBe(false);
    expect(container.querySelector('.wfv-flashcard-front .wfv-flashcard-text')?.textContent).toBe('next');

    dispose();
  });
});

describe('WelcomeSettingsPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders four rows that deep-link to their settings section', () => {
    const onOpen = vi.fn();
    const dispose = render(
      () => (
        <WelcomeSettingsPreview
          rows={[
            { label: 'General', section: 'general' },
            { label: 'Appearance', section: 'appearance' },
            { label: 'AI', section: 'ai' },
            { label: 'Keyboard Shortcuts', section: 'about' },
          ]}
          onOpen={onOpen}
        />
      ),
      container,
    );

    const rows = container.querySelectorAll('button.wfv-settings-row');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('General');
    expect(rows[3]?.textContent).toContain('Keyboard Shortcuts');
    rows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith('ai');
    rows[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith('about');

    dispose();
  });
});

describe('WelcomeStatsPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('opens statistics from the chart and renders real values and weekday labels', () => {
    const onOpen = vi.fn();
    const dispose = render(
      () => (
        <WelcomeStatsPreview
          days={[
            { date: '2026-01-04', newCards: 5, reviews: 2, total: 7 },
            { date: '2026-01-05', newCards: 0, reviews: 0, total: 0 },
            { date: '2026-01-06', newCards: 0, reviews: 0, total: 0 },
            { date: '2026-01-07', newCards: 0, reviews: 0, total: 0 },
            { date: '2026-01-08', newCards: 0, reviews: 0, total: 0 },
            { date: '2026-01-09', newCards: 0, reviews: 0, total: 0 },
            { date: '2026-01-10', newCards: 1, reviews: 9, total: 10 },
          ]}
          newTotal={6}
          reviewsTotal={11}
          newLabel="New"
          reviewsLabel="Reviews"
          weekdayLabels={['S', 'M', 'T', 'W', 'T', 'F', 'S']}
          onOpen={onOpen}
        />
      ),
      container,
    );

    const chart = container.querySelector<HTMLButtonElement>('button.wfv-week');
    expect(chart?.getAttribute('aria-label')).toContain('New 6');
    expect(chart?.getAttribute('aria-label')).toContain('Reviews 11');
    expect(chart?.querySelectorAll('.wfv-week-point')).toHaveLength(7);
    expect(chart?.querySelectorAll('.wfv-week-day')).toHaveLength(7);

    chart?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    dispose();
  });
});

describe('WelcomeLookupPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('submits the draft and opens a lookup from a real word row', () => {
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const onLookupWord = vi.fn();
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft=""
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching={false}
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[
            { word: 'word1', reading: 'r1', back: 'meaning' },
            { word: 'word2', back: 'other' },
          ]}
          onDraftChange={onDraftChange}
          onSubmit={onSubmit}
          onOpenDatabase={() => {}}
          onLookupWord={onLookupWord}
        />
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>('input.wfv-lookup-input');
    input!.value = 'word';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith('word');

    container.querySelector('form.wfv-lookup-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const rows = container.querySelectorAll('button.wfv-word-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('word1');
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLookupWord).toHaveBeenCalledWith('word1');

    dispose();
  });

  it('shows an honest empty hint when there are no word rows', () => {
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft=""
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching={false}
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={() => {}}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-lookup-empty')?.textContent).toBe('No words yet');
    expect(container.querySelectorAll('button.wfv-word-row')).toHaveLength(0);

    dispose();
  });

  it('shows the no-matches hint while searching with zero results', () => {
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft="zzz"
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={() => {}}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-lookup-empty .wfv-empty')?.textContent).toBe('No matches found');
    expect(container.querySelector('.wfv-lookup-hint')?.textContent).toBe('Press Enter to look up the word');
    expect(container.querySelectorAll('button.wfv-word-row')).toHaveLength(0);

    dispose();
  });

  it('shows the Enter-key lookup hint only while searching with zero results', () => {
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft="zzz"
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up zzz"
          rows={[]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={() => {}}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-lookup-hint')?.textContent).toBe('Press Enter to look up zzz');
    expect(container.querySelector('.wfv-lookup-empty')?.textContent).toContain('No matches found');

    dispose();
  });

  it('hides the lookup hint when the search is not active', () => {
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft=""
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching={false}
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={() => {}}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-lookup-hint')).toBeNull();

    dispose();
  });

  it('announces live search rows through an aria-live region', () => {
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile={false}
          draft="wo"
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[{ word: 'word1', back: 'meaning' }]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={() => {}}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    const region = container.querySelector('.wfv-word-rows');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.querySelector('button.wfv-word-row')?.textContent).toContain('word1');

    dispose();
  });

  it('shows an honest open-database control on mobile', () => {
    const onOpenDatabase = vi.fn();
    const dispose = render(
      () => (
        <WelcomeLookupPreview
          mobile
          draft=""
          placeholder="Look up a word"
          searchLabel="Search"
          emptyHint="No words yet"
          searching={false}
          noMatchesLabel="No matches found"
          lookupHint="Press Enter to look up the word"
          rows={[]}
          onDraftChange={() => {}}
          onSubmit={() => {}}
          onOpenDatabase={onOpenDatabase}
          onLookupWord={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('form.wfv-lookup-form')).toBeNull();
    container.querySelector('button.wfv-lookup-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpenDatabase).toHaveBeenCalledTimes(1);

    dispose();
  });
});

describe('WelcomeLevelPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders the ring, real chips with active state, and opens level study from the dial', () => {
    const onOpen = vi.fn();
    const dispose = render(
      () => (
        <WelcomeLevelPreview
          coverage={{ total: 100, tracked: 60, pct: 60 }}
          active={makeLevel(3, 60)}
          chips={[makeLevel(1, 100), makeLevel(2, 100), makeLevel(3, 60), makeLevel(4, 40), makeLevel(5, 10)]}
          titleLabel="Coverage"
          emptyLabel="No data"
          onOpen={onOpen}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-level-value')?.textContent).toBe('60%');
    const chips = container.querySelectorAll('.wfv-level-chip');
    expect(chips).toHaveLength(5);
    expect(chips[0]?.classList.contains('wfv-level-chip-active')).toBe(true);
    expect(container.querySelector('.wfv-level-status')?.textContent).toContain('60 / 100');

    container.querySelector<HTMLButtonElement>('button.wfv-level-dial-wrap')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('keeps the ring shell and localized description when coverage is unavailable', () => {
    const dispose = render(
      () => (
        <WelcomeLevelPreview
          coverage={null}
          active={null}
          chips={[]}
          titleLabel="Coverage"
          emptyLabel="No level data yet"
          onOpen={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-level-value')?.textContent).toBe('0%');
    expect(container.querySelector('.wfv-level .wfv-empty')?.textContent).toBe('No level data yet');

    dispose();
  });

  it('does not show a rounded 100% for an incomplete level', () => {
    const incomplete = { ...makeLevel(3, 100), known: 99, total: 100 };
    const dispose = render(
      () => (
        <WelcomeLevelPreview
          coverage={{ total: 100, tracked: 99, pct: 99 }}
          active={incomplete}
          chips={[incomplete]}
          titleLabel="Coverage"
          emptyLabel="No data"
          onOpen={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-level-chip-pct')?.textContent).toBe('99%');

    dispose();
  });

  it('marks the dial percentage as assessed coverage and labels chip tooltips as Known', () => {
    const dispose = render(
      () => (
        <WelcomeLevelPreview
          coverage={{ total: 100, tracked: 60, pct: 60 }}
          active={makeLevel(3, 60)}
          chips={[makeLevel(3, 60), makeLevel(4, 40)]}
          titleLabel="Coverage"
          assessedLabel="assessed"
          knownLabel="Known"
          emptyLabel="No data"
          onOpen={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('.wfv-level-status')?.textContent).toBe('60 / 100 assessed');

    const dial = container.querySelector<HTMLButtonElement>('button.wfv-level-dial-wrap');
    expect(dial?.getAttribute('aria-label')).toBe('Coverage: 60% (assessed)');

    const chips = container.querySelectorAll('.wfv-level-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('title')).toBe('Known: 60%');
    expect(chips[1]?.getAttribute('title')).toBe('Known: 40%');

    dispose();
  });
});

describe('WelcomeTutorPreview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('reports draft changes and submits from the composer', () => {
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();

    const dispose = render(
      () => (
        <WelcomeTutorPreview
          ready
          readyLabel="Ready"
          setupLabel="Setup"
          placeholder="Message in Japanese..."
          mobile={false}
          draft=""
          onDraftChange={onDraftChange}
          onSubmit={onSubmit}
        />
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>('input.wfv-tutor-input');
    expect(input?.disabled).toBe(false);
    input!.value = 'hello';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith('hello');

    container.querySelector('form.wfv-tutor-composer')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('keeps the composer visually present but disabled when setup is required', () => {
    const dispose = render(
      () => (
        <WelcomeTutorPreview
          ready={false}
          readyLabel="Ready"
          setupLabel="Setup"
          placeholder="Message in Japanese..."
          mobile={false}
          draft=""
          onDraftChange={() => {}}
          onSubmit={vi.fn()}
        />
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>('input.wfv-tutor-input');
    const send = container.querySelector<HTMLButtonElement>('button.wfv-tutor-send');
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(true);
    expect(send?.disabled).toBe(true);
    expect(container.querySelector('.wfv-tutor-status-text')?.textContent).toBe('Setup');

    dispose();
  });

  it('shows a mobile open button instead of the composer', () => {
    const onSubmit = vi.fn();
    const dispose = render(
      () => (
        <WelcomeTutorPreview
          ready
          readyLabel="Ready"
          setupLabel="Setup"
          placeholder="Message in Japanese..."
          mobile
          draft=""
          onDraftChange={() => {}}
          onSubmit={onSubmit}
        />
      ),
      container,
    );

    expect(container.querySelector('input.wfv-tutor-input')).toBeNull();
    container.querySelector<HTMLButtonElement>('button.wfv-tutor-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    dispose();
  });
});
