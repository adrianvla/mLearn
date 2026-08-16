import { Component, JSX, Show, createSignal, onCleanup } from 'solid-js';
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
  class?: string;
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  const [pos, setPos] = createSignal({ left: 0, top: 0 });
  let delayTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let triggerRef: HTMLSpanElement | undefined;

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

  const show = () => {
    const delay = props.delay ?? 0;
    if (delay > 0) {
      delayTimer = setTimeout(() => {
        updatePosition();
        setVisible(true);
        props.onShow?.();
      }, delay);
    } else {
      updatePosition();
      setVisible(true);
      props.onShow?.();
    }
  };

  const hide = () => {
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
