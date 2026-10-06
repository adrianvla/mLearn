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
  const measure = () => {
    frame = undefined;
    const menu = getMenu();
    const root = getRoot();
    const panel = menu?.querySelector<HTMLElement>('[data-overflow-panel]');
    if (!menu || !root || !panel || root.clientWidth === 0) return;
    const wasOpen = menu.open;
    const measured: Array<[HTMLElement, string | null]> = [];
    let required = 0;
    try {
      // Measure the real controls, not duplicate inputs or a guessed breakpoint.
      menu.open = true;
      panel.classList.add('toolbar-overflow-measuring');
      const children = Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement
        && child !== menu && getComputedStyle(child).position !== 'absolute'
        && getComputedStyle(child).display !== 'none');
      const style = getComputedStyle(root);
      const gap = parseFloat(style.columnGap) || 0;
      required = panel.getBoundingClientRect().width + gap * children.length
        + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      for (const child of children) {
        if (child.classList.contains('reader-nav-title')) {
          // The title is allowed to ellipsize, but it must retain useful space.
          required += Math.min(child.scrollWidth, 96);
          continue;
        }
        measured.push([child, child.getAttribute('style')]);
        child.style.flex = '0 0 auto';
        child.style.width = 'max-content';
        required += child.getBoundingClientRect().width;
      }
    } finally {
      for (const [child, original] of measured) {
        if (original === null) child.removeAttribute('style'); else child.setAttribute('style', original);
      }
      panel.classList.remove('toolbar-overflow-measuring');
      menu.open = wasOpen;
    }
    setOverflow(required > root.clientWidth);
  };
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  };
  onMount(() => {
    const root = getRoot();
    if (!root) return;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(root);
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    schedule();
    onCleanup(() => {
      observer?.disconnect(); mutations.disconnect(); window.removeEventListener('resize', schedule);
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
