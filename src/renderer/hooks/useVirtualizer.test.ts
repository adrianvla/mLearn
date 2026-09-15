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

  it('should jump to a centered index without rendering the traversed range', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      const scrollToMock = vi.fn();
      el.scrollTo = scrollToMock;

      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 0,
      });

      virtualizer.scrollToIndex(50, { behavior: 'auto', align: 'center' });

      expect(scrollToMock).toHaveBeenCalledWith({ top: 4900, behavior: 'auto' });
      expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([49, 50, 51]);

      dispose();
    });
  });

  it('should react when an accessor count changes', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      const [count, setCount] = createSignal(0);
      const virtualizer = createVirtualizer({
        count,
        getScrollElement: () => el,
        estimateSize: () => 100,
        overscan: 0,
      });

      expect(virtualizer.getVirtualItems()).toEqual([]);

      setCount(20);

      expect(virtualizer.getTotalSize()).toBe(2000);
      expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([0, 1, 2]);

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

  it('updates row offsets and total height immediately when mounted rows change height', () => {
    const root = createRoot(dispose => {
      const el = createMockElement({ clientHeight: 300 });
      return { dispose, virtualizer: createVirtualizer({ count: 3, getScrollElement: () => el, estimateSize: () => 56, measureDynamic: true }) };
    });
    const row = document.createElement('div');
    row.dataset.index = '0';
    let height = 56;
    row.getBoundingClientRect = () => new DOMRect(0, 0, 300, height);
    root.virtualizer.measureElement(row);
    height = 96;
    root.virtualizer.measure();
    expect(root.virtualizer.getTotalSize()).toBe(208);
    expect(root.virtualizer.getVirtualItems()[1].start).toBe(96);
    const stableItems = root.virtualizer.getVirtualItems();
    root.virtualizer.measure();
    expect(root.virtualizer.getVirtualItems()).toBe(stableItems);
    root.dispose();
  });

  it('observes only rendered rows, handles responsive wrapping, and disconnects on disposal', () => {
    const observers: MockResizeObserver[] = [];
    class MockResizeObserver implements ResizeObserver {
      readonly targets = new Set<Element>();
      readonly disconnect = vi.fn(() => this.targets.clear());
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
      observe(target: Element) { this.targets.add(target); }
      unobserve(target: Element) { this.targets.delete(target); }
      resize(target: Element) {
        this.callback([{ target, contentRect: target.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this);
      }
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const root = createRoot(dispose => {
      const el = createMockElement({ clientHeight: 100 });
      el.scrollTo = vi.fn();
      return { dispose, virtualizer: createVirtualizer({ count: 100, getScrollElement: () => el, estimateSize: () => 56, overscan: 0, measureDynamic: true }) };
    });
    try {
      const row = document.createElement('div');
      row.dataset.index = '0';
      let height = 56;
      row.getBoundingClientRect = () => new DOMRect(0, 0, 300, height);
      root.virtualizer.measureElement(row);
      const observer = observers.find(item => item.targets.has(row));
      if (!observer) throw new Error('Rendered row was not observed');
      height = 96;
      observer.resize(row);
      expect(root.virtualizer.getVirtualItems()[1].start).toBe(96);
      expect(root.virtualizer.getTotalSize()).toBe(5640);
      const stableItems = root.virtualizer.getVirtualItems();
      observer.resize(row);
      expect(root.virtualizer.getVirtualItems()).toBe(stableItems);
      root.virtualizer.scrollToIndex(50, { behavior: 'auto' });
      expect(observer.targets.has(row)).toBe(false);
      root.dispose();
      expect(observer.disconnect).toHaveBeenCalledOnce();
      expect(observer.targets.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('should keep a numeric count fixed', () => {
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
      expect(virtualizer.getTotalSize()).toBe(1000);

      dispose();
    });
  });

  it('reuses item objects for overlapping indices when the window shifts', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300, scrollTop: 0 });
      el.scrollTo = vi.fn();
      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 56,
        overscan: 0,
      });

      const before = virtualizer.getVirtualItems();
      expect(before[0].index).toBe(0);

      virtualizer.scrollToIndex(1, { behavior: 'auto' });
      const after = virtualizer.getVirtualItems();

      expect(after[0].index).toBe(1);
      expect(after[0]).toBe(before[1]);
      expect(after[1]).toBe(before[2]);
      expect(after[after.length - 1].index).toBe(6);

      dispose();
    });
  });

  it('emits new item objects when a row height change shifts offsets', () => {
    const root = createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300 });
      return { dispose, virtualizer: createVirtualizer({ count: 3, getScrollElement: () => el, estimateSize: () => 56, measureDynamic: true }) };
    });
    const row0 = document.createElement('div');
    row0.dataset.index = '0';
    row0.getBoundingClientRect = () => new DOMRect(0, 0, 300, 56);
    const row1 = document.createElement('div');
    row1.dataset.index = '1';
    let row1Height = 56;
    row1.getBoundingClientRect = () => new DOMRect(0, 0, 300, row1Height);
    root.virtualizer.measureElement(row0);
    root.virtualizer.measureElement(row1);

    const initial = root.virtualizer.getVirtualItems();
    row1Height = 96;
    root.virtualizer.measure();
    const updated = root.virtualizer.getVirtualItems();

    expect(updated[0]).toBe(initial[0]);
    expect(updated[1]).not.toBe(initial[1]);
    expect(updated[1].size).toBe(96);
    expect(updated[2].start).toBe(152);
    root.dispose();
  });

  it('returns the same items array when a recompute leaves the window unchanged', () => {
    createRoot((dispose) => {
      const el = createMockElement({ clientHeight: 300, scrollTop: 0 });
      el.scrollTo = vi.fn();
      const virtualizer = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 56,
        overscan: 0,
      });

      const before = virtualizer.getVirtualItems();
      expect(before.length).toBeGreaterThan(0);

      Object.defineProperty(el, 'clientHeight', { value: 299, configurable: true });
      virtualizer.scrollToIndex(0, { behavior: 'auto' });

      expect(virtualizer.getVirtualItems()).toBe(before);

      dispose();
    });
  });
});
