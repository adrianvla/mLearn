// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { WORD_STATUS } from '../../../shared/constants';
import type { FilterToken } from '../../components/common/FilterBuilder/filterExpr';
import type { LanguageData, WordFrequencyMap } from '../../../shared/types';

const addLevelStudyFlashcardsMock = vi.fn();
const showToastMock = vi.fn();
const getComprehensiveWordStatusSyncMock = vi.fn();
const hasWordSyncMock = vi.fn();
const onCloseMock = vi.fn();
const enumerateDictionaryWordsMock = vi.fn();

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.count !== undefined ? `${key}[${params.count}]` : key,
  }),
  useFlashcards: () => ({
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    hasWordSync: hasWordSyncMock,
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
  }),
}));

vi.mock('../../components/common/Feedback/Toast', () => ({
  showToast: showToastMock,
}));

vi.mock('../../../shared/backends', () => ({
  getBackend: () => ({
    enumerateDictionaryWords: enumerateDictionaryWordsMock,
  }),
}));

vi.mock('../../components/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/common')>();
  return {
    ...actual,
    Modal: (props: { children?: JSX.Element; footer?: JSX.Element }) => (
      <div data-testid="modal">
        {props.children}
        {props.footer}
      </div>
    ),
    ProgressBar: () => <div data-testid="progress-bar" />,
    FilterBuilder: (props: { tokens: FilterToken[]; onChange: (tokens: FilterToken[]) => void }) => (
      <div data-testid="filter-builder">
        <button type="button" data-testid="clear-tokens" onClick={() => props.onChange([])}>
          clear
        </button>
        <button
          type="button"
          data-testid="or-known"
          onClick={() =>
            props.onChange([
              ...props.tokens,
              { instanceId: 'or-1', kind: 'operator', op: 'OR' },
              { instanceId: 'known-1', kind: 'operand', field: 'status', op: 'eq', value: String(WORD_STATUS.KNOWN) },
            ])
          }
        >
          or known
        </button>
        <button
          type="button"
          data-testid="filter-beyond"
          onClick={() =>
            props.onChange([
              { instanceId: 'beyond-1', kind: 'operand', field: 'level', op: 'eq', value: '__beyond_exam__' },
            ])
          }
        >
          beyond exam
        </button>
        <button
          type="button"
          data-testid="bare-known"
          onClick={() =>
            props.onChange([
              ...props.tokens,
              { instanceId: 'known-2', kind: 'operand', field: 'status', op: 'eq', value: String(WORD_STATUS.KNOWN) },
            ])
          }
        >
          bare known
        </button>
      </div>
    ),
  };
});

const LANG_DATA = {
  name: 'Japanese',
  frequencyLevels: {
    rowLevelIndex: 2,
    names: { '5': 'N5' },
  },
} as unknown as LanguageData;

const FREQUENCY = {
  '猫': { raw_level: 5 },
  '犬': { raw_level: 5 },
  '鳥': { raw_level: 5 },
} as unknown as WordFrequencyMap;

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

describe('BulkAddModal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    addLevelStudyFlashcardsMock.mockReset();
    addLevelStudyFlashcardsMock.mockResolvedValue({ created: 2, promoted: 0 });
    showToastMock.mockClear();
    onCloseMock.mockClear();
    const untracked = (word: string) => word !== '鳥';
    getComprehensiveWordStatusSyncMock.mockImplementation((word: string) =>
      untracked(word) ? 'unknown' : 'known',
    );
    hasWordSyncMock.mockImplementation((word: string) => !untracked(word));
  });

  afterEach(() => {
    container.remove();
  });

  async function renderModal() {
    const { BulkAddModal } = await import('./BulkAddModal');
    return render(() => (
      <BulkAddModal
        language="ja"
        languageData={LANG_DATA}
        frequency={FREQUENCY}
        levelNames={{ '5': 'N5' }}
        onClose={onCloseMock}
      />
    ), container);
  }

  it('defaults to the untracked|unknown|learning filter and adds matching words keeping their existing status', async () => {
    const dispose = await renderModal();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[2]');

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['猫', '犬'],
      'new',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function), preserveExistingStatus: true }),
    );
    expect(showToastMock).toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();

    dispose();
  });

  it('renders the progress bar while the bulk add reports progress', async () => {
    addLevelStudyFlashcardsMock.mockImplementation((_w, _s, _l, opts: { onProgress?: (c: number, t: number) => void }) => {
      opts.onProgress?.(1, 2);
      return new Promise(() => {});
    });
    const dispose = await renderModal();

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.AddingProgress');
    expect(container.querySelector('[data-testid="progress-bar"]')).not.toBeNull();

    dispose();
  });

  it('passes the selected target status to the bulk add', async () => {
    const dispose = await renderModal();

    findButton(container, 'mlearn.LevelStudy.DetailModal.StatusKnown')?.click();
    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['猫', '犬'],
      'known',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    dispose();
  });

  it('passes the keep-existing status option to the bulk add', async () => {
    const dispose = await renderModal();

    // Default: keep-existing is selected — adds as new with preservation on.
    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();
    expect(addLevelStudyFlashcardsMock).toHaveBeenLastCalledWith(
      ['猫', '犬'],
      'new',
      'ja',
      expect.objectContaining({ preserveExistingStatus: true }),
    );

    // Selecting an explicit status disables preservation.
    findButton(container, 'mlearn.LevelStudy.DetailModal.StatusKnown')?.click();
    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();
    expect(addLevelStudyFlashcardsMock).toHaveBeenLastCalledWith(
      ['猫', '犬'],
      'known',
      'ja',
      expect.objectContaining({ preserveExistingStatus: false }),
    );

    // Selecting keep-existing again restores the default mapping.
    findButton(container, 'mlearn.LevelStudy.BulkAdd.PreserveStatus')?.click();
    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();
    expect(addLevelStudyFlashcardsMock).toHaveBeenLastCalledWith(
      ['猫', '犬'],
      'new',
      'ja',
      expect.objectContaining({ preserveExistingStatus: true }),
    );

    dispose();
  });

  it('matches every displayable word when the filter is cleared', async () => {
    const dispose = await renderModal();

    (container.querySelector('[data-testid="clear-tokens"]') as HTMLElement).click();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[3]');

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['猫', '犬', '鳥'],
      'new',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    dispose();
  });

  it('matches both untracked and known words with an or filter', async () => {
    const dispose = await renderModal();

    (container.querySelector('[data-testid="or-known"]') as HTMLElement).click();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[3]');

    dispose();
  });

  it('disables confirm while the filter is invalid', async () => {
    const dispose = await renderModal();

    (container.querySelector('[data-testid="bare-known"]') as HTMLElement).click();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[0]');
    expect(findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.disabled).toBe(true);

    dispose();
  });

  it('includes beyond-exam frequency rows in the default learning-status universe', async () => {
    const beyondFrequency = {
      '猫': { raw_level: 5 },
      '兎': { raw_level: -1 },
      '熊': { raw_level: -1 },
    } as unknown as WordFrequencyMap;
    const { BulkAddModal } = await import('./BulkAddModal');
    const dispose = render(() => (
      <BulkAddModal
        language="ja"
        languageData={LANG_DATA}
        frequency={beyondFrequency}
        levelNames={{ '5': 'N5' }}
        onClose={onCloseMock}
      />
    ), container);

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[3]');

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['猫', '兎', '熊'],
      'new',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    dispose();
  });

  it('selects only beyond-exam rows with the level filter', async () => {
    const beyondFrequency = {
      '猫': { raw_level: 5 },
      '兎': { raw_level: -1 },
      '熊': { raw_level: -1 },
    } as unknown as WordFrequencyMap;
    const { BulkAddModal } = await import('./BulkAddModal');
    const dispose = render(() => (
      <BulkAddModal
        language="ja"
        languageData={LANG_DATA}
        frequency={beyondFrequency}
        levelNames={{ '5': 'N5' }}
        onClose={onCloseMock}
      />
    ), container);

    (container.querySelector('[data-testid="filter-beyond"]') as HTMLElement).click();

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[2]');

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['兎', '熊'],
      'new',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    dispose();
  });

  it('includes dictionary-only words in the beyond-exam bucket', async () => {
    enumerateDictionaryWordsMock.mockResolvedValue([
      ['鮫', 'さめ'],
      ['鰯', 'いわし'],
    ]);
    const dispose = await renderModal();
    await new Promise((resolve) => setTimeout(resolve, 0));

    (container.querySelector('[data-testid="filter-beyond"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('mlearn.LevelStudy.BulkAdd.MatchingCount[2]');

    findButton(container, 'mlearn.LevelStudy.DetailModal.AddFlashcards')?.click();
    await Promise.resolve();

    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(
      ['鮫', '鰯'],
      'new',
      'ja',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    dispose();
  });
});
