import { createSignal, createMemo, createEffect, onCleanup } from 'solid-js';

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
}

export interface VirtualizerOptions {
  count: number;
  getScrollElement: () => HTMLElement | null | undefined;
  estimateSize: (index: number) => number;
  overscan?: number;
  measureDynamic?: boolean;
}

export interface Virtualizer {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  scrollToIndex: (index: number) => void;
  measure: () => void;
}

export function createVirtualizer(options: VirtualizerOptions): Virtualizer {
  const overscan = options.overscan ?? 5;
  const measureDynamic = options.measureDynamic ?? false;

  // Internal measurements cache
  const measurements = new Map<number, number>();

  const getItemSize = (index: number): number => {
    if (measureDynamic && measurements.has(index)) {
      return measurements.get(index)!;
    }
    return options.estimateSize(index);
  };

  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  const initMetrics = () => {
    const el = options.getScrollElement();
    if (el) {
      setScrollTop(el.scrollTop);
      setContainerHeight(el.clientHeight);
    }
  };
  initMetrics();

  const totalSize = createMemo(() => {
    let total = 0;
    for (let i = 0; i < options.count; i++) {
      total += getItemSize(i);
    }
    return total;
  });

  const virtualItems = createMemo(() => {
    const st = scrollTop();
    const ch = containerHeight();
    const count = options.count;

    if (count === 0 || ch === 0) return [];

    let start = 0;
    let cumulative = 0;

    for (let i = 0; i < count; i++) {
      const size = getItemSize(i);
      if (cumulative + size > st) {
        start = i;
        break;
      }
      cumulative += size;
    }

    let end = start;
    let visibleHeight = 0;
    for (let i = start; i < count; i++) {
      visibleHeight += getItemSize(i);
      end = i;
      if (visibleHeight >= ch) break;
    }

    start = Math.max(0, start - overscan);
    end = Math.min(count - 1, end + overscan);

    const items: VirtualItem[] = [];
    let offset = 0;
    for (let i = 0; i < start; i++) {
      offset += getItemSize(i);
    }

    for (let i = start; i <= end; i++) {
      const size = getItemSize(i);
      items.push({ index: i, start: offset, size });
      offset += size;
    }

    return items;
  });

  createEffect(() => {
    const el = options.getScrollElement();
    if (!el) return;

    const updateMetrics = () => {
      setScrollTop(el.scrollTop);
      setContainerHeight(el.clientHeight);
    };

    // Use ResizeObserver for container if available, fallback to window resize
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateMetrics())
      : null;

    if (resizeObserver) {
      resizeObserver.observe(el);
    }

    el.addEventListener('scroll', updateMetrics, { passive: true });
    updateMetrics();

    onCleanup(() => {
      el.removeEventListener('scroll', updateMetrics);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    });
  });

  const itemRefs = new Map<number, HTMLElement>();

  const measure = () => {
    if (!measureDynamic) return;
    for (const [index, el] of itemRefs) {
      const height = el.getBoundingClientRect().height;
      if (height > 0) {
        measurements.set(index, height);
      }
    }
    setScrollTop((v) => v);
  };

  const scrollToIndex = (index: number) => {
    const el = options.getScrollElement();
    if (!el || index < 0 || index >= options.count) return;

    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += getItemSize(i);
    }
    el.scrollTo({ top: offset, behavior: 'smooth' });
  };

  return {
    getVirtualItems: () => virtualItems(),
    getTotalSize: () => totalSize(),
    scrollToIndex,
    measure,
  };
}
