import { createSignal, onCleanup, onMount } from 'solid-js';
import { useDismiss } from './useDismiss';
import './toolbarOverflow.css';

/** One set of controls: inline when it fits, a disclosure only when it does not. */
export function useToolbarOverflow(
  getMenu: () => HTMLDetailsElement | undefined,
  getRoot: () => HTMLElement | undefined = () => getMenu()?.parentElement ?? undefined,
) {
  const [overflow, setOverflow] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  let frame: number | undefined;
  const groupOrder = new Map<HTMLElement, number>();
  let nextGroupOrder = 0;
  const measure = () => {
    frame = undefined;
    const menu = getMenu(), root = getRoot();
    const panel = menu?.querySelector<HTMLElement>('[data-overflow-panel]');
    const inline = root?.querySelector<HTMLElement>('[data-overflow-inline]');
    const summary = menu?.querySelector<HTMLElement>('summary');
    if (!menu || !menu.isConnected || !root || !panel || !inline || !summary || root.clientWidth === 0) return;
    for (const group of groupOrder.keys()) if (!group.isConnected || (group.parentElement !== panel && group.parentElement !== inline)) groupOrder.delete(group);
    for (const group of [...Array.from(inline.children), ...Array.from(panel.children)]) {
      if (group instanceof HTMLElement && !groupOrder.has(group)) groupOrder.set(group, nextGroupOrder++);
    }
    const groups = [...groupOrder.keys()].sort((a, b) => groupOrder.get(a)! - groupOrder.get(b)!);
    const wasOpen = menu.open;
    const styles: Array<[HTMLElement, string | null]> = [];
    const widths = new Map<HTMLElement, number>();
    let fixedWidth = 0, moreWidth = 0, gap = 0, fixedCount = 0;
    try {
      menu.open = true;
      panel.classList.add('toolbar-overflow-measuring');
      menu.removeAttribute('data-overflow-empty');
      for (const element of [summary, ...groups]) {
        styles.push([element, element.getAttribute('style')]);
        element.style.flex = '0 0 auto'; element.style.width = 'max-content';
      }
      summary.style.display = 'block';
      const rootStyle = getComputedStyle(root);
      gap = parseFloat(rootStyle.columnGap) || 0;
      fixedWidth = (parseFloat(rootStyle.paddingLeft) || 0) + (parseFloat(rootStyle.paddingRight) || 0);
      const fixed = Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement
        && child !== menu && child !== inline && getComputedStyle(child).position !== 'absolute' && getComputedStyle(child).display !== 'none');
      fixedCount = fixed.length;
      for (const child of fixed) {
        const minimum = Number(child.dataset.toolbarMinWidth);
        if (Number.isFinite(minimum) && minimum > 0) { fixedWidth += Math.min(child.scrollWidth, minimum); continue; }
        styles.push([child, child.getAttribute('style')]);
        child.style.flex = '0 0 auto'; child.style.width = 'max-content';
        fixedWidth += child.getBoundingClientRect().width;
      }
      moreWidth = summary.getBoundingClientRect().width;
      for (const group of groups) widths.set(group, getComputedStyle(group).display === 'none' ? 0 : group.getBoundingClientRect().width);
    } finally {
      for (const [element, original] of styles) { if (original === null) element.removeAttribute('style'); else element.setAttribute('style', original); }
      panel.classList.remove('toolbar-overflow-measuring'); menu.open = wasOpen;
    }
    const visible = groups.filter(group => widths.get(group)! > 0);
    const allWidth = fixedWidth + visible.reduce((sum, group) => sum + widths.get(group)!, 0)
      + Math.max(0, fixedCount + visible.length - 1) * gap;
    const fits = new Set<HTMLElement>();
    const overflowing = allWidth > root.clientWidth;
    if (!overflowing) for (const group of groups) fits.add(group);
    else {
      let remaining = root.clientWidth - fixedWidth - moreWidth - fixedCount * gap;
      const priorities = [...visible].sort((a, b) => Number(a.dataset.overflowPriority ?? 0) - Number(b.dataset.overflowPriority ?? 0)
        || groupOrder.get(a)! - groupOrder.get(b)!);
      for (const group of priorities) {
        const cost = widths.get(group)! + gap;
        if (cost <= remaining) { fits.add(group); remaining -= cost; }
      }
      for (const group of groups) if (widths.get(group) === 0) fits.add(group);
    }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    for (const target of [inline, panel]) {
      const ordered = groups.filter(group => (fits.has(group) ? inline : panel) === target);
      for (let index = 0; index < ordered.length; index++) {
        const group = ordered[index];
        if (target.children[index] !== group) target.insertBefore(group, target.children[index] ?? null);
      }
    }
    menu.dataset.overflowEmpty = String(!overflowing);
    setOverflow(overflowing);
    if (overflowing && focused && panel.contains(focused)) setExpanded(true);
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  };
  onMount(() => {
    const root = getRoot();
    if (!root) return;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observeToolbarParts = () => {
      if (!observer) return;
      observer.disconnect();
      observer.observe(root);
      for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        observer.observe(element);
      }
    };
    observeToolbarParts();
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    const refreshObservation = new MutationObserver(() => observeToolbarParts());
    refreshObservation.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    schedule();
    onCleanup(() => {
      observer?.disconnect(); mutations.disconnect(); refreshObservation.disconnect();
      window.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  useDismiss({
    active: () => overflow() && expanded(),
    inside: () => [getMenu()],
    closeOnOutsidePointer: true,
    onDismiss: reason => {
      setExpanded(false);
      if (reason === 'escape') getMenu()?.querySelector<HTMLElement>('summary')?.focus();
    },
  });
  return {
    overflow,
    open: () => !overflow() || expanded(),
    toggle: (event: MouseEvent) => { event.preventDefault(); setExpanded(value => !value); },
  };
}
