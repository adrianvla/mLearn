import { Component, createSignal, onCleanup } from 'solid-js';
import './BorderFlash.css';

const globalTriggers = new Set<() => void>();

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

  globalTriggers.add(trigger);
  onCleanup(() => {
    globalTriggers.delete(trigger);
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
  globalTriggers.forEach((trigger) => trigger());
};
