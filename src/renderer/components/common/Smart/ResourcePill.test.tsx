// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { ResourcePillProps } from './ResourcePill';

const settingsState = {
  language: 'ja',
  use_anki: true,
  enable_flashcard_creation: true,
  ankiLearningEase: 1500,
  ankiKnownEase: 1800,
};
const mockGetCardByWordSync = vi.fn(() => null);

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

vi.mock('./EasePill', () => ({
  EasePill: (props: { ease?: number; isInAnki: boolean; effectiveStatus: string }) => (
    <span class="mock-ease-pill">{`ease:${props.ease ?? 'none'}:${props.isInAnki ? 'anki' : 'srs'}:${props.effectiveStatus}`}</span>
  ),
}));

describe('ResourcePill', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    settingsState.enable_flashcard_creation = true;
    mockGetCardByWordSync.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders the tracked ease state', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="apple"
        isTracked={true}
        isAdding={false}
        isInAnki={true}
        ankiWord="apple"
        ease={1.85}
        effectiveStatus="learning"
        onAdd={() => undefined}
      />
    ), container);

    expect(container.querySelector('.mock-ease-pill')?.textContent).toBe('ease:1.85:anki:learning');

    dispose();
  });

  it('scopes built-in preview lookup to the supplied language', async () => {
    const { ResourcePill } = await import('./ResourcePill');

    const dispose = render(() => (
      <ResourcePill
        word="赤い"
        language="ja"
        isTracked={true}
        isAdding={false}
        isInAnki={false}
        ease={1.85}
        effectiveStatus="learning"
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
        isTracked={false}
        isAdding={true}
        isInAnki={false}
        ease={undefined}
        effectiveStatus="unknown"
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
      isTracked: true,
      isAdding: false,
      isInAnki: true,
      ankiWord: 'apple',
      ease: 1.85,
      effectiveStatus: 'learning',
      onAdd,
    });

    const dispose = render(() => <ResourcePill {...pillProps()} />, container);

    expect(container.querySelector('.mock-ease-pill')?.textContent).toBe('ease:1.85:anki:learning');

    setPillProps({
      word: 'banana',
      isTracked: false,
      isAdding: false,
      isInAnki: false,
      ankiWord: undefined,
      ease: undefined,
      effectiveStatus: 'unknown',
      onAdd,
    });

    expect(container.querySelector('.mock-ease-pill')).toBeNull();
    expect(container.textContent).toContain('Flashcard');

    dispose();
  });

  it('renders the Anki-only pill and forwards clicks to the add handler', async () => {
    const { ResourcePill } = await import('./ResourcePill');
    const onAdd = vi.fn();

    const dispose = render(() => (
      <ResourcePill
        word="apple"
        isTracked={false}
        isAdding={false}
        isInAnki={true}
        ankiWord="apple"
        ease={undefined}
        effectiveStatus="learning"
        onAdd={onAdd}
      />
    ), container);

    const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === 'In Anki');
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
        isTracked={false}
        isAdding={false}
        isInAnki={false}
        ease={undefined}
        effectiveStatus="unknown"
        onAdd={() => undefined}
      />
    ), container);

    expect(container.textContent).toContain('Add to Anki');
    expect(container.textContent).not.toContain('Flashcard');

    dispose();
  });
});
