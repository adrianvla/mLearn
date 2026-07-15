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
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalClientWidth: PropertyDescriptor | undefined;
  let imageLoadRequests: number;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = vi.fn();

    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 144,
    });

    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof globalThis.requestAnimationFrame;

    originalImage = globalThis.Image;
    imageLoadRequests = 0;
    class MockImage {
      public onload: null | (() => void) = null;
      public crossOrigin = '';

      set src(_value: string) {
        imageLoadRequests += 1;
      }
    }
    globalThis.Image = MockImage as unknown as typeof globalThis.Image;
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    HTMLElement.prototype.scrollTo = originalScrollTo;
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
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

  it('does not render a redundant pages header', async () => {
    const { ReaderSidebar } = await import('./ReaderSidebar');
    const [pages] = createSignal([
      { id: 'page-0', src: 'cover.jpg', name: 'Cover', index: 0 },
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

    expect(container.querySelector('.reader-sidebar-header')).toBeNull();
    expect(container.textContent).not.toContain('mlearn.Reader.Sidebar.Pages');

    dispose();
  });

  it('mounts and loads only the virtual rows around the active page', async () => {
    const { ReaderSidebar } = await import('./ReaderSidebar');
    const [pages] = createSignal(Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index}`,
      src: `page-${index}.jpg`,
      name: `Page ${index + 1}`,
      index,
    })));
    const [activePageIndices] = createSignal([80]);

    const dispose = render(() => (
      <ReaderSidebar
        pages={pages}
        activePageIndices={activePageIndices}
        hasOcrForPage={() => false}
        onGoToPage={() => undefined}
      />
    ), container);

    const renderedThumbnails = container.querySelectorAll('.page-thumb');
    expect(renderedThumbnails.length).toBeGreaterThan(0);
    expect(renderedThumbnails.length).toBeLessThan(10);
    expect(container.querySelector('.page-thumb.active .page-number')?.textContent).toBe('81');
    expect(imageLoadRequests).toBe(renderedThumbnails.length);

    dispose();
  });
});
