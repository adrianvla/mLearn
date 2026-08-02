/**
 * Popover Component
 * Interactive anchored panel rendered through a Portal, escaping any
 * containing block (e.g. a fixed nav with backdrop-filter) so its own
 * backdrop-filter and positioning work independently of the trigger's tree.
 */

import { Component, Accessor, JSX, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import './Popover.css';

export interface PopoverProps {
  /** Whether the popover is open (signal accessor or static boolean) */
  open: boolean | Accessor<boolean>;
  /** Returns the trigger element the panel is anchored to */
  anchor: () => HTMLElement | undefined;
  /** Called when the popover should close (Escape / outside pointerdown) */
  onClose: () => void;
  /** Accessible name for the dialog panel */
  label?: string;
  /** Panel content */
  children?: JSX.Element;
  /** Extra class appended to the panel */
  class?: string;
}

const MARGIN = 8;

export const Popover: Component<PopoverProps> = (props) => {
  const isOpen = () => (typeof props.open === 'function' ? props.open() : props.open);

  const [position, setPosition] = createSignal({ left: 0, top: 0 });
  let panelRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!isOpen()) return;

    const updatePosition = () => {
      if (!panelRef) return;
      const anchorEl = props.anchor();
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const panelW = panelRef.offsetWidth;
      const panelH = panelRef.offsetHeight;
      const left = Math.max(MARGIN, Math.min(rect.right - panelW, window.innerWidth - panelW - MARGIN));
      const top = Math.max(MARGIN, Math.min(rect.bottom + MARGIN, window.innerHeight - panelH - MARGIN));
      setPosition({ left, top });
    };

    updatePosition();
    // No scroll listener: the anchor lives in a fixed nav bar, so page
    // scrolling cannot move it relative to the viewport the fixed panel
    // is positioned against.
    window.addEventListener('resize', updatePosition);
    onCleanup(() => window.removeEventListener('resize', updatePosition));
  });

  createEffect(() => {
    if (!isOpen()) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (props.anchor()?.contains(target)) return;
      if (panelRef?.contains(target)) return;
      props.onClose();
    };

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', handlePointerDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('pointerdown', handlePointerDown);
    });
  });

  return (
    <Show when={isOpen()}>
      <Portal mount={document.body}>
        <div
          ref={panelRef}
          class={`popover-panel${props.class ? ` ${props.class}` : ''}`}
          role="dialog"
          aria-label={props.label}
          style={{ left: `${position().left}px`, top: `${position().top}px` }}
        >
          {props.children}
        </div>
      </Portal>
    </Show>
  );
};
