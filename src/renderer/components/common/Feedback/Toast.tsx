/**
 * Toast Component
 * A notification system that appears temporarily and auto-dismisses
 */

import { Component, createSignal, onCleanup, onMount, Show, JSX, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import './Toast.css';

export type ToastVariant = 'success' | 'warning' | 'info' | 'error';

export interface ToastProps {
  /** Toast variant/type */
  variant: ToastVariant;
  /** Toast title */
  title?: string;
  /** Toast message (plain text) */
  message?: string;
  /** Custom JSX content rendered inside the toast (replaces message when provided) */
  content?: JSX.Element;
  /** Duration in ms before auto-dismiss (default 5000, 0 = no auto-dismiss) */
  duration?: number;
  /** Close handler */
  onClose?: () => void;
  /** Custom icon element */
  icon?: JSX.Element;
  /** Additional class names */
  class?: string;
}

// Default icons for each variant
const SuccessIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const WarningIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const ErrorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const defaultIcons: Record<ToastVariant, () => JSX.Element> = {
  success: SuccessIcon,
  warning: WarningIcon,
  info: InfoIcon,
  error: ErrorIcon,
};

/**
 * ToastItem - A single toast notification rendered within the container
 */
const ToastItem: Component<ToastProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  const [exiting, setExiting] = createSignal(false);

  let timeoutId: ReturnType<typeof setTimeout>;

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      props.onClose?.();
    }, 300);
  };

  onMount(() => {
    requestAnimationFrame(() => {
      setVisible(true);
    });

    const duration = props.duration ?? 5000;
    if (duration > 0) {
      timeoutId = setTimeout(handleClose, duration);
    }
  });

  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  const getIcon = () => {
    if (props.icon) return props.icon;
    const IconComponent = defaultIcons[props.variant];
    return <IconComponent />;
  };

  return (
    <div
      class={`toast toast--${props.variant} ${visible() ? 'toast--visible' : ''} ${exiting() ? 'toast--exiting' : ''} ${props.class || ''}`}
      role="alert"
      aria-live="polite"
    >
      <div class="toast__icon">
        {getIcon()}
      </div>
      <div class="toast__content">
        <Show when={props.title}>
          <div class="toast__title">{props.title}</div>
        </Show>
        <Show when={props.content} fallback={
          <div class="toast__message">{props.message}</div>
        }>
          <div class="toast__message">{props.content}</div>
        </Show>
      </div>
      <button class="toast__close" onClick={handleClose} aria-label="Close">
        <CloseIcon />
      </button>
    </div>
  );
};

// Global toast state
interface ToastItemData {
  id: number;
  variant: ToastVariant;
  title?: string;
  message?: string;
  content?: JSX.Element;
  duration?: number;
  icon?: JSX.Element;
  class?: string;
}

const [toasts, setToasts] = createSignal<ToastItemData[]>([]);
let toastIdCounter = 0;

/**
 * Show a toast notification programmatically
 */
export function showToast(options: Omit<ToastProps, 'onClose'>): number {
  const id = ++toastIdCounter;
  setToasts((prev) => [...prev, { id, ...options }]);
  return id;
}

/**
 * Update an existing toast by id (e.g., change message or variant after async work completes)
 */
export function updateToast(id: number, updates: Partial<Omit<ToastItemData, 'id'>>): void {
  setToasts((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
}

/**
 * Remove a toast by id
 */
export function removeToast(id: number): void {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

/**
 * ToastContainer - Renders all active toasts via Portal
 * Must be mounted once in the component tree (e.g., in WindowWrapper)
 */
export const ToastContainer: Component = () => {
  return (
    <Portal mount={document.body}>
      <div class="toast-container">
        <For each={toasts()}>
          {(toast) => (
            <ToastItem
              variant={toast.variant}
              title={toast.title}
              message={toast.message}
              content={toast.content}
              duration={toast.duration}
              icon={toast.icon}
              class={toast.class}
              onClose={() => removeToast(toast.id)}
            />
          )}
        </For>
      </div>
    </Portal>
  );
};

/**
 * Toast - Re-export for backward compatibility (use showToast for programmatic usage)
 */
export const Toast = ToastItem;
export default Toast;
