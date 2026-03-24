import { Component, JSX, createEffect, createSignal, onCleanup } from 'solid-js';
import './CollapsibleStickyHeader.css';

interface CollapsibleStickyHeaderProps {
  children: JSX.Element;
  class?: string;
  getScrollContainer: () => HTMLElement | undefined;
  collapseThreshold?: number;
}

const DEFAULT_COLLAPSE_THRESHOLD = 8;
const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);

function isElementScrollableY(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return SCROLLABLE_OVERFLOW_VALUES.has(style.overflowY) && element.scrollHeight > element.clientHeight;
}

function resolveScrollContainer(baseElement: HTMLElement): HTMLElement {
  let current: HTMLElement | null = baseElement;

  while (current) {
    if (isElementScrollableY(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return baseElement;
}

export const CollapsibleStickyHeader: Component<CollapsibleStickyHeaderProps> = (props) => {
  const [isCollapsed, setIsCollapsed] = createSignal(false);

  createEffect(() => {
    const requestedContainer = props.getScrollContainer();
    if (!requestedContainer) {
      return;
    }

    const scrollContainer = resolveScrollContainer(requestedContainer);
    const threshold = props.collapseThreshold ?? DEFAULT_COLLAPSE_THRESHOLD;
    let previousScrollTop = scrollContainer.scrollTop;
    let accumulatedDelta = 0;

    const handleScroll = () => {
      const nextScrollTop = scrollContainer.scrollTop;
      const delta = nextScrollTop - previousScrollTop;

      if (nextScrollTop <= 0) {
        setIsCollapsed(false);
        accumulatedDelta = 0;
        previousScrollTop = nextScrollTop;
        return;
      }

      if (delta === 0) {
        return;
      }

      if ((delta > 0 && accumulatedDelta < 0) || (delta < 0 && accumulatedDelta > 0)) {
        accumulatedDelta = 0;
      }

      accumulatedDelta += delta;

      if (accumulatedDelta > threshold) {
        setIsCollapsed(true);
        accumulatedDelta = 0;
      } else if (accumulatedDelta < -threshold) {
        setIsCollapsed(false);
        accumulatedDelta = 0;
      }

      previousScrollTop = nextScrollTop;
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    });
  });

  return (
    <div class={`collapsible-sticky-header ${isCollapsed() ? 'collapsible-sticky-header--collapsed' : ''} ${props.class ?? ''}`.trim()}>
      {props.children}
    </div>
  );
};
