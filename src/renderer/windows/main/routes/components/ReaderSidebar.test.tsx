// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

vi.mock('../../../../components/common', () => ({
  Tag: (props: { class?: string; children?: any }) => <span class={props.class}>{props.children}</span>,
  Indicator: (props: { class?: string }) => <span class={props.class} />, 
  Spinner: () => <span>loading</span>,
}));

vi.mock('../../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

describe('ReaderSidebar', () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;
  let originalScrollTo: typeof HTMLElement.prototype.scrollTo;
  let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame;
  let originalImage: typeof globalThis.Image;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = vi.fn();

    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof globalThis.requestAnimationFrame;

    originalImage = globalThis.Image;
    class MockImage {
      public onload: null | (() => void) = null;
      public crossOrigin = '';

      set src(_value: string) {
        // Keep thumbnail loading inert for this test.
      }
    }
    globalThis.Image = MockImage as unknown as typeof globalThis.Image;
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    HTMLElement.prototype.scrollTo = originalScrollTo;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.Image = originalImage;
    container.remove();
  });

  it('highlights only one thumbnail when only one page is visible', async () => {
    const { ReaderSidebar } = await import('./ReaderSidebar');
    const [pages] = createSignal([
      { id: 'page-0', src: 'cover.jpg', name: 'Cover', index: 0 },
      { id: 'page-1', src: 'page-1.jpg', name: 'Page 1', index: 1 },
      { id: 'page-2', src: 'page-2.jpg', name: 'Page 2', index: 2 },
    ]);
    const [activePageIndices] = createSignal([0]);

    const dispose = render(() => (
      <ReaderSidebar
        pages={pages}
        activePageIndices={activePageIndices}
        hasOcrForPage={() => false}
        onGoToPage={() => undefined}
      />
    ), container);

    expect(container.querySelectorAll('.page-thumb.active')).toHaveLength(1);
    expect(container.querySelector('.page-thumb.active .page-number')?.textContent).toBe('1');

    dispose();
  });
});