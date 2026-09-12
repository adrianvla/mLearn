import { batch, createSignal, createMemo, createEffect, onCleanup, type Accessor } from 'solid-js';

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
}

export interface VirtualizerOptions {
  count: number | Accessor<number>;
  getScrollElement: () => HTMLElement | null | undefined;
  estimateSize: (index: number) => number;
  overscan?: number;
  measureDynamic?: boolean;
}

export interface VirtualizerScrollOptions {
  behavior?: ScrollBehavior;
  align?: 'start' | 'center' | 'end';
}

export interface Virtualizer {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  scrollToIndex: (index: number, options?: VirtualizerScrollOptions) => void;
  measure: () => void;
  measureElement: (el: HTMLElement | null, index?: number) => void;
}

export function createVirtualizer(options: VirtualizerOptions): Virtualizer {
  const overscan = options.overscan ?? 5;
  const measureDynamic = options.measureDynamic ?? false;
  const getCount = (): number => typeof options.count === 'function'
    ? options.count()
    : options.count;

  // Internal measurements cache
  const measurements = new Map<number, number>();
  const [measurementRevision, setMeasurementRevision] = createSignal(0);

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
    measurementRevision();
    let total = 0;
    for (let i = 0; i < getCount(); i++) {
      total += getItemSize(i);
    }
    return total;
  });

  const virtualItems = createMemo(() => {
    measurementRevision();
    const st = scrollTop();
    const ch = containerHeight();
    const count = getCount();

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

  const renderedElements = new Map<number, HTMLElement>();
  const elementIndexes = new WeakMap<HTMLElement, number>();
  const updateMeasurement = (el: HTMLElement) => {
    const index = elementIndexes.get(el);
    if (index === undefined) return;
    if (!Number.isInteger(index) || index < 0 || index >= getCount()) return;
    const height = el.getBoundingClientRect().height;
    if (height > 0 && measurements.get(index) !== height) {
      measurements.set(index, height);
      setMeasurementRevision(revision => revision + 1);
    }
  };
  const rowObserver = measureDynamic && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => batch(() => {
      for (const entry of entries) {
        const el = entry.target;
        if (el instanceof HTMLElement && renderedElements.get(elementIndexes.get(el) ?? -1) === el) updateMeasurement(el);
      }
    }))
    : undefined;

  createEffect(() => {
    const visible = new Set(virtualItems().map(item => item.index));
    for (const [index, el] of renderedElements) {
      if (!visible.has(index)) {
        rowObserver?.unobserve(el);
        renderedElements.delete(index);
      }
    }
  });
  onCleanup(() => {
    rowObserver?.disconnect();
    renderedElements.clear();
  });

  const measureElement = (el: HTMLElement | null, itemIndex?: number) => {
    if (!el || !measureDynamic) return;
    const indexAttr = el.getAttribute('data-index');
    if (itemIndex === undefined && indexAttr === null) return;
    const index = itemIndex ?? Number(indexAttr);
    if (!Number.isInteger(index) || index < 0 || index >= getCount()) return;
    const previous = renderedElements.get(index);
    if (previous !== el) {
      if (previous) rowObserver?.unobserve(previous);
      renderedElements.set(index, el);
      elementIndexes.set(el, index);
      rowObserver?.observe(el);
    }
    updateMeasurement(el);
  };

  const measure = () => {
    if (!measureDynamic) return;
    batch(() => {
      for (const el of renderedElements.values()) updateMeasurement(el);
    });
  };

  const scrollToIndex = (index: number, scrollOptions: VirtualizerScrollOptions = {}) => {
    const el = options.getScrollElement();
    const count = getCount();
    if (!el || index < 0 || index >= count) return;

    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += getItemSize(i);
    }

    const itemSize = getItemSize(index);
    const align = scrollOptions.align ?? 'start';
    if (align === 'center') {
      offset -= (el.clientHeight - itemSize) / 2;
    } else if (align === 'end') {
      offset -= el.clientHeight - itemSize;
    }

    const maxOffset = Math.max(0, totalSize() - el.clientHeight);
    const targetOffset = Math.max(0, Math.min(offset, maxOffset));
    const behavior = scrollOptions.behavior ?? 'smooth';

    if (behavior !== 'smooth') setScrollTop(targetOffset);
    setContainerHeight(el.clientHeight);
    el.scrollTo({ top: targetOffset, behavior });
  };

  return {
    getVirtualItems: () => virtualItems(),
    getTotalSize: () => totalSize(),
    scrollToIndex,
    measure,
    measureElement,
  };
}
