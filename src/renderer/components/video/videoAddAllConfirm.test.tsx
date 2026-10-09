// @vitest-environment happy-dom

/**
 * "Add all" in the Video's unknown-words sidebar used to create flashcards the
 * instant the button was pressed, while the identical button in the Reader
 * opened a confirm first. Observed in the running app: the Video's added a card
 * on the spot (store went 449 -> 450) and never showed a dialog, while the
 * Reader's opened the two-step modal. Both buttons are the same
 * `UnknownWordsSidebar` control, so the difference was an accident of which
 * surface wired the handler, not a product decision.
 *
 * This renders the real Video sidebar and the real shared modal, and asserts the
 * cards are not created until the learner has actually confirmed and named
 * them. An implementation that calls onAddAll on click fails here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Show, type Component } from 'solid-js';
import type { SidebarWordEntry } from '../sidebar';

type AddAllEntry = SidebarWordEntry & { subtitleIndex: number };

const onAddAll = vi.fn(async (_entries: AddAllEntry[]) => {});
const onAddWord = vi.fn(async () => {});
const onIgnoreWord = vi.fn(async () => {});

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'count' in params ? `${key} ${String(params.count)}` : key,
  }),
  useSettings: () => ({ settings: { language: 'ja', use_anki: false } }),
  useLanguage: () => ({
    currentLangData: () => undefined,
    getFrequency: () => undefined,
    getCanonicalForm: (w: string) => w,
    getWordVariants: (w: string) => [w],
    getReadingVariants: () => [],
    getFrequencyForLanguage: () => undefined,
    getLanguageDataFor: () => undefined,
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false }),
    getFreqLevelNames: () => ({}),
  }),
  useFlashcards: () => ({
    getCardById: () => null,
    getCardByWordSync: () => null,
    isWordIgnoredSync: () => false,
    getComprehensiveWordStatusWithSourceSync: () => ({ excluded: false }),
    queueCounts: () => ({ new: 0, learning: 0, review: 0, relearning: 0, total: 0 }),
    isKnowledgeReady: () => true,
  }),
  useDictionaryTargetLanguage: () => () => 'en',
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: vi.fn(), translateWord: vi.fn(async () => null) }),
  getCachedTranslation: () => null,
}));
vi.mock('../../services/openKnowledgeInspector', () => ({ openKnowledgeInspector: vi.fn() }));
vi.mock('../../services/surfaceKnowledgeInspection', () => ({ surfaceKnowledgeInspection: vi.fn() }));
vi.mock('../../services/ankiWordsCache', () => ({
  ankiCacheVersion: () => 0,
  findAnkiWordMatchInCache: () => null,
  isAnkiCacheFetched: () => false,
}));
vi.mock('../../hooks/useDictionaryTargetLanguage', () => ({ useDictionaryTargetLanguage: () => () => 'en' }));
vi.mock('../language-specific', () => ({ WordWithReading: (p: Record<string, unknown>) => <span>{p?.word as never}</span> }));
vi.mock('../subtitle/wordHoverHelpers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../subtitle/wordHoverHelpers')>(),
  resolveProsodyForHover: () => undefined,
}));
vi.mock('../common/Smart', () => ({ ResourcePill: () => <span /> }));

// Leaf presentational primitives. The Modal is kept real-ish via a simple
// wrapper so the test asserts on the dialog that actually appears.
vi.mock('../common', () => {
  const passthrough: Component<Record<string, unknown>> = (props) => (props?.children ?? null) as never;
  const Button: Component<Record<string, unknown>> = (props) => (
    <button type="button" disabled={Boolean(props?.disabled)} onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
      {props?.label as never}
    </button>
  );
  const Modal: Component<Record<string, unknown>> = (props) => (
    <Show when={props?.isOpen as boolean} fallback={null}>
      <div role="dialog">
        <span class="modal-title">{props?.title as never}</span>
        {props?.children as never}
        {props?.footer as never}
      </div>
    </Show>
  );
  return {
    Button,
    Modal,
    Show,
    CloseIcon: () => <span />,
    CollapsibleStickyHeader: passthrough,
    PillLabel: (p: Record<string, unknown>) => <span>{p?.label as never}</span>,
    Select: (p: Record<string, unknown>) => (
      <select
        value={(p?.value as string) ?? ''}
        onChange={(e) => (p?.onChange as ((v: string) => void) | undefined)?.(e.currentTarget.value)}
      >
        {((p?.options as { value: string; label: string }[]) ?? []).map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
      </select>
    ),
    CheckboxCard: passthrough,
    LEVEL_VALUE_BEYOND_EXAM: 99,
  };
});

vi.mock('./VideoUnknownWordsSidebar.css', () => ({}));
vi.mock('../../windows/main/routes/components/AddAllFlashcardsModal.css', () => ({}));

import { VideoUnknownWordsSidebar, type VideoWordEntry } from './VideoUnknownWordsSidebar';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const word = (w: string, index: number): VideoWordEntry => ({
  key: `k-${w}`,
  word: w,
  subtitleIndex: index,
  contextPhrase: `a line containing ${w}`,
  token: { text: w, partOfSpeech: 'noun', lemma: w, reading: '', frequency: 3 } as never,
});

const words = (): VideoWordEntry[] => [word('alpha', 0), word('beta', 1), word('gamma', 2)];

const addAllButton = (container: HTMLElement) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim() === 'mlearn.Sidebar.SaveAllForReview');
  if (!button) throw new Error('Add All button not found');
  return button;
};

const dialog = () => document.querySelector('[role=dialog]');
const dialogText = () => dialog()?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const dialogButton = (label: string) =>
  Array.from(dialog()?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').trim() === label) ?? null;

describe('Video Add All asks before it creates anything', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onAddAll.mockClear();
    onAddWord.mockClear();
    onIgnoreWord.mockClear();
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('[role=dialog]').forEach((n) => n.remove());
  });

  const openSidebar = async () => {
    render(
      () => (
        <VideoUnknownWordsSidebar
          words={words}
          addingWordKeys={() => new Set<string>()}
          isAddingAll={() => false}
          failedWordSet={() => new Set<string>()}
          onAddWord={onAddWord}
          onAddAll={onAddAll}
          onIgnoreWord={onIgnoreWord}
          onClose={() => {}}
        />
      ),
      container,
    );
    await flush();
  };

  it('creates no card until the confirm is actually confirmed', async () => {
    await openSidebar();

    addAllButton(container).click();
    await flush();

    expect(onAddAll, 'cards were created without asking').not.toHaveBeenCalled();
    // The prompt names the video it came from, and counts the pending words.
    expect(dialogText()).toContain('mlearn.AddAllFlashcards.video.Title');
    expect(dialogText()).toContain('mlearn.AddAllFlashcards.video.AddAll 3');

    // Step one -> step two (the word list the learner can untick).
    dialogButton('mlearn.AddAllFlashcards.video.AddAll 3')!.click();
    await flush();

    expect(onAddAll).not.toHaveBeenCalled();
    expect(dialogText()).toContain('mlearn.AddAllFlashcards.video.WordListTitle');

    // Only the final button creates anything.
    dialogButton('mlearn.AddAllFlashcards.video.AddChecked 3')!.click();
    await flush();

    expect(onAddAll).toHaveBeenCalledTimes(1);
    expect(onAddAll.mock.calls[0]?.[0]?.map((e: SidebarWordEntry) => e.word)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('cancelling from the first step creates nothing', async () => {
    await openSidebar();

    addAllButton(container).click();
    await flush();
    // "Cancel" lives in the footer fallback of step one.
    const cancel = Array.from(dialog()?.querySelectorAll('button') ?? [])
      .find((b) => (b.textContent ?? '').trim() === 'mlearn.Global.Cancel');
    expect(cancel, 'no cancel control on the first step').not.toBeNull();
    cancel!.click();
    await flush();

    expect(onAddAll).not.toHaveBeenCalled();
  });
});
