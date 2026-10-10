/**
 * Popover Component
 * Interactive anchored panel rendered through a Portal, escaping any
 * containing block (e.g. a fixed nav with backdrop-filter) so its own
 * backdrop-filter and positioning work independently of the trigger's tree.
 */

import { Component, Accessor, JSX, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useDismiss } from '../../../hooks/useDismiss';
import './Popover.css';

export interface PopoverProps {
  /** Whether the popover is open (signal accessor or static boolean) */
  open: boolean | Accessor<boolean>;
  /** Returns the trigger element the panel is anchored to */
  anchor: () => HTMLElement | undefined;
  /** Optional content region the panel must stay inside */
  collisionBoundary?: () => HTMLElement | undefined;
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
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement>();

  const focusPanel = (panel: HTMLDivElement) => {
    const target = panel.querySelector<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (target ?? panel).focus();
  };

  createEffect(() => {
    if (!isOpen()) return;
    const panel = panelRef();
    const anchorEl = props.anchor();
    if (!panel || !anchorEl) return;

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const boundary = props.collisionBoundary?.()?.getBoundingClientRect();
      const viewportRight = window.innerWidth - MARGIN;
      const viewportBottom = window.innerHeight - MARGIN;
      const leftEdge = boundary
        ? Math.min(viewportRight, Math.max(MARGIN, boundary.left + MARGIN))
        : MARGIN;
      const rightEdge = boundary
        ? Math.max(leftEdge, Math.min(viewportRight, boundary.right - MARGIN))
        : viewportRight;
      const topEdge = boundary
        ? Math.min(viewportBottom, Math.max(MARGIN, boundary.top + MARGIN))
        : MARGIN;
      const bottomEdge = boundary
        ? Math.max(topEdge, Math.min(viewportBottom, boundary.bottom - MARGIN))
        : viewportBottom;
      panel.style.maxWidth = boundary ? `${rightEdge - leftEdge}px` : '';
      panel.style.maxHeight = boundary ? `${bottomEdge - topEdge}px` : '';
      const panelW = panel.offsetWidth;
      const panelH = panel.offsetHeight;
      const left = Math.max(leftEdge, Math.min(rect.right - panelW, rightEdge - panelW));
      const top = Math.max(topEdge, Math.min(rect.bottom + MARGIN, bottomEdge - panelH));
      setPosition({ left, top });
    };

    updatePosition();
    focusPanel(panel);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    onCleanup(() => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    });
  });

  // Escape and outside-pointer dismissal via the shared transient-surface
  // policy; returning focus to the anchor on Escape is this surface's own.
  useDismiss({
    active: isOpen,
    onDismiss: (reason) => {
      props.onClose();
      if (reason === 'escape') props.anchor()?.focus();
    },
    inside: () => [props.anchor?.(), panelRef()],
    closeOnOutsidePointer: true,
  });

  return (
    <Show when={isOpen()}>
      <Portal mount={document.body}>
        <div
          ref={setPanelRef}
          class={`popover-panel${props.class ? ` ${props.class}` : ''}`}
          role="dialog"
          aria-label={props.label}
          tabIndex={-1}
          style={{ left: `${position().left}px`, top: `${position().top}px` }}
        >
          {props.children}
        </div>
      </Portal>
    </Show>
  );
};
