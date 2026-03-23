import { Component, JSX, Show, createSignal, onCleanup } from 'solid-js';
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
  class?: string;
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  const show = () => {
    const delay = props.delay ?? 0;
    if (delay > 0) {
      delayTimer = setTimeout(() => {
        setVisible(true);
        props.onShow?.();
      }, delay);
    } else {
      setVisible(true);
      props.onShow?.();
    }
  };

  const hide = () => {
    if (delayTimer !== null) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (visible()) {
      setVisible(false);
      props.onHide?.();
    }
  };

  onCleanup(hide);

  return (
    <span
      class={`tooltip-trigger ${props.class ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {props.children}
      <Show when={visible()}>
        <span class={`tooltip-content tooltip-content--${props.position ?? 'top'}`}>
          {props.content}
        </span>
      </Show>
    </span>
  );
};
