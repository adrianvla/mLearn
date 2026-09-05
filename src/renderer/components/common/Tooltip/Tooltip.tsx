import { Component, JSX, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import './Tooltip.css';

export interface TooltipProps {
  content: JSX.Element;
  children: JSX.Element;
  /** Delay in ms before showing the tooltip (default: 0) */
  delay?: number;
  /** Position relative to trigger (default: 'top') */
  position?: 'top' | 'bottom';
  /** Called when tooltip becomes visible */
  onShow?: () => void;
  /** Called when tooltip is hidden */
  onHide?: () => void;
  /** Keep content hoverable so interactive content (buttons) can be clicked */
  interactive?: boolean;
  /** Keep the portal open until its owner explicitly closes it. */
  pinned?: boolean;
  onRequestClose?: () => void;
  class?: string;
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  const [pos, setPos] = createSignal({ left: 0, top: 0 });
  let delayTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let triggerRef: HTMLSpanElement | undefined;
  let contentRef: HTMLSpanElement | undefined;

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const position = props.position ?? 'top';
    const margin = 8;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    let left = rect.left + rect.width / 2 + scrollX;
    let top: number;

    if (position === 'top') {
      top = rect.top + scrollY - margin;
    } else {
      top = rect.bottom + scrollY + margin;
    }

    setPos({ left, top });
  };

  const clampToViewport = () => {
    if (!contentRef || !triggerRef) return;
    const viewportWidth = window.innerWidth;
    const width = contentRef.offsetWidth;
    if (width === 0) return;
    const half = width / 2;
    const currentLeft = pos().left;
    const minLeft = half + 8;
    const maxLeft = viewportWidth - half - 8;
    const clampedLeft = Math.min(Math.max(currentLeft, minLeft), Math.max(minLeft, maxLeft));
    if (clampedLeft !== currentLeft) setPos({ left: clampedLeft, top: pos().top });
  };

  const show = () => {
    const delay = props.delay ?? 0;
    if (delay > 0) {
      delayTimer = setTimeout(() => {
        updatePosition();
        setVisible(true);
        requestAnimationFrame(clampToViewport);
        props.onShow?.();
      }, delay);
    } else {
      updatePosition();
      setVisible(true);
      requestAnimationFrame(clampToViewport);
      props.onShow?.();
    }
  };

  const hide = () => {
    if (props.pinned) return;
    if (delayTimer !== null) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (visible()) {
      setVisible(false);
      props.onHide?.();
    }
  };

  // Interactive content lives in a Portal: the pointer crosses a gap between
  // trigger and content, so trigger-mouseleave must grace before hiding or the
  // tooltip closes before the pointer reaches the content.
  const scheduleHide = () => {
    if (props.pinned) return;
    if (props.interactive) {
      hideTimer = setTimeout(hide, 200);
    } else {
      hide();
    }
  };
  const cancelHide = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  onCleanup(hide);

  // Pin transitions only: a controlled `pinned` value must open on true and
  // close on an explicit true→false flip, but never fight hover shows while it
  // sits at false (that closed every hover the moment the portal mounted).
  createEffect(on(() => props.pinned, (pinned, previous) => {
    if (pinned) {
      cancelHide();
      show();
    } else if (previous !== undefined && visible()) {
      hide();
    }
  }, { defer: true }));

  createEffect(() => {
    if (!props.pinned) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') props.onRequestClose?.();
      if (event instanceof PointerEvent && !triggerRef?.contains(event.target as Node) && !contentRef?.contains(event.target as Node)) {
        props.onRequestClose?.();
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    onCleanup(() => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    });
  });

  return (
    <>
      <span
        ref={triggerRef}
        class={`tooltip-trigger ${props.class ?? ''}`}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocusIn={show}
        onFocusOut={hide}
      >
        {props.children}
      </span>
      <Show when={visible()}>
        <Portal mount={document.body}>
          <span
            ref={contentRef}
            role="tooltip"
            class={`tooltip-content tooltip-content--${props.position ?? 'top'}${props.interactive ? ' tooltip-content--interactive' : ''}`}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            style={{
              position: 'fixed',
              left: `${pos().left}px`,
              top: `${pos().top}px`,
              transform: 'translateX(-50%)',
              'z-index': 'var(--z-tooltip)',
            }}
          >
            {props.content}
          </span>
        </Portal>
      </Show>
    </>
  );
};
