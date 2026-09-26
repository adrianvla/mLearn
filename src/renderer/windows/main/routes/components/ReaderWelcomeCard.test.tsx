// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ReaderWelcomeCard } from './ReaderWelcomeCard';

vi.mock('../../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key === 'mlearn.Reader.UI.WelcomeSplash.OpenFailed'
      ? 'This book could not be opened. Choose it again below.'
      : key,
  }),
}));

describe('ReaderWelcomeCard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => container.remove());

  it('explains a failed book load and keeps both recovery imports available', () => {
    const [loadError, setLoadError] = createSignal<'open-failed' | 'no-images' | null>(null);
    const openFolder = vi.fn();
    const openPdf = vi.fn();
    const dispose = render(() => (
      <ReaderWelcomeCard
        isDragging={() => false}
        loadError={loadError()}
        onOpenFolder={openFolder}
        onOpenPdf={openPdf}
      />
    ), container);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    setLoadError('open-failed');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose it again below');
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();
    expect(openFolder).toHaveBeenCalledOnce();
    expect(openPdf).toHaveBeenCalledOnce();
    setLoadError('no-images');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('mlearn.Reader.Status.NoImagesFound');
    setLoadError(null);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    dispose();
  });
});
