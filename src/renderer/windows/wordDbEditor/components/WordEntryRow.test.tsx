// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { WordEntry } from './WordEntryRow';

const mockGetCard = vi.fn();

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
}));

vi.mock('../../../hooks/useTranslation', () => ({
  getCachedTranslation: () => null,
  getCachedReading: () => null,
  fetchTranslation: vi.fn(),
}));

vi.mock('../../../utils/translationCacheParsers', () => ({
  extractPitchPosition: () => null,
}));

vi.mock('../../../../shared/utils/textUtils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../shared/utils/textUtils')>(),
  containsKanji: (value: string) => /[\u4e00-\u9faf]/.test(value),
  isAllKana: (value: string) => /^[\u3040-\u30ff]+$/.test(value),
}));

vi.mock('../../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>{props.children}</button>
  ),
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  PitchAccentOverlay: (props: { word: string }) => <span>{props.word}</span>,
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

vi.mock('../../../components/common/Smart', () => ({
  WordStatusPill: () => <span data-testid="word-status-pill" />,
}));

function makeEntry(word: string): WordEntry {
  return {
    uuid: word,
    word,
    translation: '',
    reading: '',
    level: 0,
    tracker: 'anki',
    status: 0,
  };
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WordEntryRow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetCard.mockReset();
  });

  afterEach(() => {
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
});
