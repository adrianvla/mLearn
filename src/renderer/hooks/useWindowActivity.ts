import { createSignal, onCleanup, onMount } from 'solid-js';

/** Collection projections belong to the active window, not every open window. */
export function useWindowActivity() {
  const read = () => document.visibilityState !== 'hidden' && document.hasFocus();
  const [active, setActive] = createSignal(read());
  const update = () => setActive(read());
  onMount(() => {
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    update();
  });
  onCleanup(() => {
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
    document.removeEventListener('visibilitychange', update);
  });
  return active;
}
