import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useWindowActivity } from './useWindowActivity';

afterEach(() => vi.restoreAllMocks());

it('requires visibility and focus, updates on native events, and removes listeners on disposal', () => {
  let focused = true;
  let visible: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  const root = createRoot(dispose => ({ dispose, active: useWindowActivity() }));
  expect(root.active()).toBe(true);
  focused = false;
  window.dispatchEvent(new Event('blur'));
  expect(root.active()).toBe(false);
  focused = true;
  visible = 'hidden';
  window.dispatchEvent(new Event('focus'));
  expect(root.active()).toBe(false);
  visible = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(root.active()).toBe(true);
  root.dispose();
  focused = false;
  window.dispatchEvent(new Event('blur'));
  expect(root.active()).toBe(true);
});
