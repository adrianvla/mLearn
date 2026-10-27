import { Platform } from 'react-native';

/** Reveal focus inside this viewport without scrolling its source ancestors. */
export function revealScrollFocus(event: { readonly target: unknown; readonly currentTarget: unknown }) {
  if (Platform.OS !== 'web') return;
  const { target, currentTarget: viewport } = event;
  if (!(target instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !viewport.contains(target)) return;
  const bounds = target.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  if (bounds.top < frame.top) viewport.scrollTop -= frame.top - bounds.top;
  else if (bounds.bottom > frame.bottom)
    viewport.scrollTop += Math.min(bounds.bottom - frame.bottom, bounds.top - frame.top);
  if (bounds.left < frame.left) viewport.scrollLeft -= frame.left - bounds.left;
  else if (bounds.right > frame.right)
    viewport.scrollLeft += Math.min(bounds.right - frame.right, bounds.left - frame.left);
}
