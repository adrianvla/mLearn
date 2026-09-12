// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createVirtualizer, type Virtualizer } from './useVirtualizer';

describe('virtual row Solid ref lifecycle', () => {
  it('observes a row before Solid assigns its data-index attribute', () => {
    const observations = new Map<Element, ResizeObserverCallback>();
    class Observer implements ResizeObserver {
      constructor(readonly callback: ResizeObserverCallback) {}
      observe(element: Element) { observations.set(element, this.callback); }
      unobserve(element: Element) { observations.delete(element); }
      disconnect() { observations.clear(); }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    let virtualizer: Virtualizer | undefined;
    let refIndex: string | null = 'not-called';
    let height = 56;
    const dispose = render(() => {
      virtualizer = createVirtualizer({ count: 3, getScrollElement: () => container, estimateSize: () => 56, measureDynamic: true });
      const item = { index: 0 };
      return <div data-index={item.index} ref={element => {
        refIndex = element.getAttribute('data-index');
        element.getBoundingClientRect = () => new DOMRect(0, 0, 300, height);
        virtualizer?.measureElement(element, 0);
      }} />;
    }, container);
    try {
      expect(refIndex).toBeNull();
      const row = container.querySelector('[data-index="0"]');
      if (!row) throw new Error('Missing mounted virtual row');
      const callback = observations.get(row);
      if (!callback) throw new Error('Row ref did not register resize observation');
      height = 96;
      callback([{ target: row, contentRect: row.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], new Observer(callback));
      expect(virtualizer?.getVirtualItems()[1].start).toBe(96);
      expect(virtualizer?.getTotalSize()).toBe(208);
    } finally {
      dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
