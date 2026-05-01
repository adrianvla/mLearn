import { Component, createSignal, onCleanup } from 'solid-js';
import './BorderFlash.css';

let globalTrigger: (() => void) | null = null;

/**
 * BorderFlash — flashes the window borders twice to indicate a reposition.
 *
 * Import and render once inside the overlay. Call triggerBorderFlash()
 * from anywhere to start the animation.
 */
export const BorderFlash: Component = () => {
  const [isFlashing, setIsFlashing] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const trigger = () => {
    if (timer) clearTimeout(timer);
    setIsFlashing(true);
    timer = setTimeout(() => {
      setIsFlashing(false);
      timer = null;
    }, 600);
  };

  globalTrigger = trigger;
  onCleanup(() => {
    if (globalTrigger === trigger) {
      globalTrigger = null;
    }
    if (timer) clearTimeout(timer);
  });

  return (
    <div
      class="border-flash"
      classList={{ animating: isFlashing() }}
      aria-hidden="true"
    />
  );
};

export const triggerBorderFlash = (): void => {
  globalTrigger?.();
};
