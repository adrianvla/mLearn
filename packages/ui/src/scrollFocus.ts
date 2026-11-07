import { Platform } from 'react-native';

/** Reveal focus inside this viewport without scrolling its source ancestors. */
export function revealScrollFocus(event: { readonly target: unknown; readonly currentTarget: unknown }) {
  if (Platform.OS !== 'web') return;
  const { target, currentTarget: viewport } = event;
  if (!(target instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !viewport.contains(target)) return;
  const bounds = target.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  // Browsers can quantize scroll offsets to pixels. Round outward so fractional
  // theme geometry cannot leave the focused edge clipped after scrolling.
  if (bounds.top < frame.top) viewport.scrollTop -= Math.ceil(frame.top - bounds.top);
  else if (bounds.bottom > frame.bottom)
    viewport.scrollTop += Math.ceil(Math.min(bounds.bottom - frame.bottom, bounds.top - frame.top));
  if (bounds.left < frame.left) viewport.scrollLeft -= Math.ceil(frame.left - bounds.left);
  else if (bounds.right > frame.right)
    viewport.scrollLeft += Math.ceil(Math.min(bounds.right - frame.right, bounds.left - frame.left));
}
