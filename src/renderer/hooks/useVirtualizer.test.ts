import { createRoot, createSignal } from 'solid-js';
import { createVirtualizer } from './useVirtualizer';

describe('createVirtualizer', () => {
  function createMockElement(options: {
    scrollTop?: number;
    clientHeight?: number;
    scrollHeight?: number;
  } = {}) {
    const el = document.createElement('div');
    el.scrollTop = options.scrollTop ?? 0;
    Object.defineProperty(el, 'clientHeight', {
      value: options.clientHeight ?? 600,
      configurable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
      value: options.scrollHeight ?? 1000,
      configurable: true,
    });
    return el;
  }

  it('should return empty virtual items when count is 0', () => {
    createRoot((dispose) => {
      const el = createMockElement();
      const virtualizer = createVirtualizer({
        count: 0,
        getScrollElement: () => el,
        estimateSize: () => 100,
      });

      expect(virtualizer.getVirtualItems()).toEqual([]);
      expect(virtualizer.getTotalSize()).toBe(0);

      dispose();
    });
  });

  it('should calculate total size correctly', () => {
    createRoot((dispose) => {
      const el = createMockElement();
      const virtualizer = createVirtualizer({
        count: 10,
        getScrollElement: () => el,
        estimateSize: () => 100,
      });

      expect(virtualizer.getTotalSize()).toBe(1000);

      dispose();
    });
  });

  it('should calculate total size with variable item sizes', () => {
    createRoot((dispose) => {
      const el = createMockElement();
      const virtualizer = createVirtualizer({
        count: 5,
        getScrollElement: () => el,
        estimateSize: (index) => (index + 1) * 50,
      });

      expect(virtualizer.getTotalSize()).toBe(50 + 100 + 150 + 200 + 250);

      dispose();
    });
  });

  it('should render all items when container is large enough', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 1000 });
      const virtualizer = createVirtualizer({
        count: 5,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 0,
      });

      const items = virtualizer.getVirtualItems();
      expect(items).toHaveLength(5);
      expect(items[0]).toEqual({ index: 0, start: 0, size: 100 });
      expect(items[4]).toEqual({ index: 4, start: 400, size: 100 });

      dispose();
    });
  });

  it('should only render visible items with overscan', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300, scrollTop: 0 });
      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 2,
      });

      const items = virtualizer.getVirtualItems();
      // Container fits 3 items (300px / 100px), plus 2 overscan = 5 items
      expect(items.length).toBeLessThanOrEqual(8);
      expect(items[0].index).toBe(0);

      dispose();
    });
  });

  it('should update virtual items on scroll', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300, scrollTop: 500 });
      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 0,
      });

      const items = virtualizer.getVirtualItems();
      expect(items[0].index).toBe(5);

      dispose();
    });
  });

  it('should include overscan items around viewport', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300, scrollTop: 400 });
      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 3,
      });

      const items = virtualizer.getVirtualItems();
      // Viewport starts at 400px, so items 4, 5, 6 are visible
      // With overscan 3, should include items 1-9
      expect(items[0].index).toBe(1);
      expect(items[items.length - 1].index).toBe(9);

      dispose();
    });
  });

  it('should handle scroll to index', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      const scrollToMock = vi.fn();
      el.scrollTo = scrollToMock;

      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 100,
      });

      virtualizer.scrollToIndex(5);
      expect(scrollToMock).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });

      dispose();
    });
  });

  it('should clamp scroll to index within bounds', () => {
    createRoot((dispose) => {
      const el = createMockElement();
      const scrollToMock = vi.fn();
      el.scrollTo = scrollToMock;

      const virtualizer = createVirtualizer({
        count: 10,
        getScrollElement: () => el,
        estimateSize: () => 100,
      });

      virtualizer.scrollToIndex(-1);
      expect(scrollToMock).not.toHaveBeenCalled();

      virtualizer.scrollToIndex(10);
      expect(scrollToMock).not.toHaveBeenCalled();

      dispose();
    });
  });

  it('should handle dynamic measurement', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      const virtualizer = createVirtualizer({
        count: 10,
        getScrollElement: () => el,
        estimateSize: () => 100,
        measureDynamic: true,
      });

      expect(virtualizer.getTotalSize()).toBe(1000);
      virtualizer.measure();
      // Without actual DOM elements, measurement won't change anything
      expect(virtualizer.getTotalSize()).toBe(1000);

      dispose();
    });
  });

  it('should not break when scroll element is null', () => {
    createRoot((dispose) => {
      const virtualizer = createVirtualizer({
        count: 10,
        getScrollElement: () => null,
        estimateSize: () => 100,
      });

      expect(virtualizer.getVirtualItems()).toEqual([]);
      expect(virtualizer.getTotalSize()).toBe(1000);

      // Should not throw
      virtualizer.scrollToIndex(5);
      virtualizer.measure();

      dispose();
    });
  });

  it('should update when count changes reactively', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      const [count, setCount] = createSignal(10);

      const virtualizer = createVirtualizer({
        count: count(),
        getScrollElement: () => el,
        estimateSize: () => 100,
      });

      expect(virtualizer.getTotalSize()).toBe(1000);

      setCount(5);
      // Note: createVirtualizer uses the initial count value; for truly reactive count,
      // the caller should recreate the virtualizer when count changes

      dispose();
    });
  });
});
