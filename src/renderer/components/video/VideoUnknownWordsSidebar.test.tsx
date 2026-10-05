// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { VideoUnknownWordsSidebar, type VideoWordEntry } from './VideoUnknownWordsSidebar';

vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../sidebar', () => ({
  AddAllFlashcardsHost: (props: { children: (host: { open: () => void }) => JSX.Element }) => props.children({ open: () => undefined }),
  UnknownWordsSidebar: (props: { words: () => VideoWordEntry[]; onPracticeWords?: (entries: VideoWordEntry[]) => void }) =>
    <button onClick={() => props.onPracticeWords?.(props.words())}>Recall selected words</button>,
}));

describe('Watch material practice handoff', () => {
  it('forwards the selected subtitle entries to the existing practice action', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onPracticeWords = vi.fn();
    const entries = [{ word: 'actual surface', subtitleIndex: 7, subtitleStart: 12, subtitleEnd: 14 }] as VideoWordEntry[];
    const dispose = render(() => <VideoUnknownWordsSidebar words={() => entries}
      addingWordKeys={() => new Set()} isAddingAll={() => false}
      onAddWord={() => undefined} onAddAll={() => undefined} onIgnoreWord={() => undefined}
      onClose={() => undefined} onPracticeWords={onPracticeWords} />, container);
    container.querySelector('button')!.click();
    expect(onPracticeWords).toHaveBeenCalledOnce();
    expect(onPracticeWords).toHaveBeenCalledWith(entries);
    dispose();
    container.remove();
  });
});
