// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { Flashcard } from '../../../../shared/types';
import type { ResourcePillProps } from './ResourcePill';

const settingsState = {
  language: 'ja',
  use_anki: true,
  enable_flashcard_creation: true,
  ankiLearningEase: 1500,
  ankiKnownEase: 1800,
};
const mockGetCardByWordSync = vi.fn((_word: string): Flashcard | null => null);

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => {
      switch (key) {
        case 'mlearn.Global.Status.Adding':
          return 'Adding...';
        case 'mlearn.WordHover.AddToBuiltInSrs':
          return 'Click to add to built-in SRS';
        case 'mlearn.WordHover.InAnki':
          return 'In Anki';
        case 'mlearn.WordHover.AddToAnki':
          return 'Add to Anki';
        case 'mlearn.Global.Flashcard':
          return 'Flashcard';
        default:
          return key;
      }
    },
  }),
  useSettings: () => ({
    settings: settingsState,
  }),
  useFlashcards: () => ({
    getCardByWordSync: mockGetCardByWordSync,
  }),
}));

vi.mock('../AnkiHoverPreview', () => ({
  AnkiHoverPreview: (props: { children?: JSX.Element }) => <>{props.children}</>,
  AnkiHoverPreviewContent: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('../FlashcardHoverPreview', () => ({
  FlashcardHoverPreview: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('../Button', () => ({
  PillBtn: (props: { label?: string; children?: JSX.Element; onClick?: (event?: MouseEvent) => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.label ?? props.children}
    </button>
  ),
}));

vi.mock('../Misc', () => ({
  ClockIcon: () => <span>clock</span>,
}));

vi.mock('../Tooltip', () => ({
  Tooltip: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

describe('ResourcePill', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    settingsState.enable_flashcard_creation = true;
    mockGetCardByWordSync.mockReset();
    mockGetCardByWordSync.mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders independent card integrations without fabricating ease', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="apple"

        isAdding={false}
        isInAnki={true}
        ankiWord="apple"


        onAdd={() => undefined}
      />
    ), container);

    expect(container.textContent).toContain('In Anki');
    expect(container.textContent).not.toContain('ease:');

    dispose();
  });

  it('shows both integrations when an actual card and an Anki match coexist', async () => {
    mockGetCardByWordSync.mockReturnValue({
      id: 'card', language: 'ja', state: 'new', ease: 2.5, interval: 0,
      dueDate: 0, reviews: 0, lapses: 0, learningStep: 0, createdAt: 0,
      lastReviewed: 0, lastUpdated: 0, content: { type: 'word', front: 'apple', back: 'fruit' },
    });
    const { ResourcePill } = await import('./ResourcePill');
    const dispose = render(() => <ResourcePill word="apple" isAdding={false} isInAnki onAdd={() => undefined} />, container);
    expect(container.textContent).toContain('mlearn.WordDbEditor.Integrations.Flashcard');
    expect(container.textContent).toContain('In Anki');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Flashcard')).toBe(false);
    dispose();
  });

  it('scopes built-in preview lookup to the supplied language', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="赤い"
        language="ja"

        isAdding={false}
        isInAnki={false}


        onAdd={() => undefined}
      />
    ), container);

    expect(mockGetCardByWordSync).toHaveBeenCalledWith('赤い', 'ja');

    dispose();
  });

  it('renders the adding state while a resource is being created', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="apple"

        isAdding={true}
        isInAnki={false}


        onAdd={() => undefined}
      />
    ), container);

    expect(container.textContent).toContain('Adding...');

    dispose();
  });

  it('updates its rendered state when the hovered word changes without remounting', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const onAdd = vi.fn();
    const [pillProps, setPillProps] = createSignal<ResourcePillProps>({
      word: 'apple',

      isAdding: false,
      isInAnki: true,
      ankiWord: 'apple',


      onAdd,
    });

    const dispose = render(() => <ResourcePill {...pillProps()} />, container);

    expect(container.textContent).toContain('In Anki');
    expect(container.textContent).not.toContain('ease:');

    setPillProps({
      word: 'banana',

      isAdding: false,
      isInAnki: false,
      ankiWord: undefined,


      onAdd,
    });

    expect(container.textContent).not.toContain('In Anki');
    expect(container.textContent).toContain('Flashcard');

    dispose();
  });

  it('keeps the Anki preview separate from the add-card action', async () => {
    const { ResourcePill } = await import('./ResourcePill');
    const onAdd = vi.fn();

    const dispose = render(() => (
      <ResourcePill
        word="apple"

        isAdding={false}
        isInAnki={true}
        ankiWord="apple"


        onAdd={onAdd}
      />
    ), container);

    const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === 'Flashcard');
    button?.click();

    expect(container.textContent).toContain('In Anki');
    expect(onAdd).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('switches the generic add label when built-in flashcard creation is disabled', async () => {
    settingsState.enable_flashcard_creation = false;
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="apple"

        isAdding={false}
        isInAnki={false}


        onAdd={() => undefined}
      />
    ), container);

    expect(container.textContent).toContain('Add to Anki');
    expect(container.textContent).not.toContain('Flashcard');

    dispose();
  });
});
