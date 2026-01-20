/**
 * AlertBanner Component
 * Banner for displaying alerts, errors, warnings, and info messages
 */

import { Component, JSX, Show } from 'solid-js';
import './AlertBanner.css';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';
export type AlertSize = 'sm' | 'md' | 'lg';

export interface AlertBannerProps {
  /** Alert variant/type */
  variant: AlertVariant;
  /** Alert title */
  title?: string;
  /** Alert message */
  message: string;
  /** Size variant */
  size?: AlertSize;
  /** Whether to show close button */
  closable?: boolean;
  /** Close handler */
  onClose?: () => void;
  /** Custom icon element */
  icon?: JSX.Element;
  /** Additional class names */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
}

// Default icons for each variant
const ErrorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: '100%', height: '100%' }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const WarningIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: '100%', height: '100%' }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: '100%', height: '100%' }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const SuccessIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: '100%', height: '100%' }}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: '16px', height: '16px' }}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const defaultIcons: Record<AlertVariant, () => JSX.Element> = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  success: SuccessIcon,
};

/**
 * AlertBanner - A banner for displaying alerts, errors, warnings, and info messages
 */
export const AlertBanner: Component<AlertBannerProps> = (props) => {
  const getIcon = () => {
    if (props.icon) return props.icon;
    const IconComponent = defaultIcons[props.variant];
    return <IconComponent />;
  };

  return (
    <div
      class={`alert-banner alert-banner--${props.variant} ${props.size ? `alert-banner--${props.size}` : ''} ${props.class || ''}`}
      style={props.style}
      role="alert"
    >
      <div class="alert-banner__icon">
        {getIcon()}
      </div>

      <div class="alert-banner__content">
        <Show when={props.title}>
          <h4 class="alert-banner__title">{props.title}</h4>
        </Show>
        <p class="alert-banner__message">{props.message}</p>
      </div>

      <Show when={props.closable}>
        <button
          class="alert-banner__close"
          onClick={() => props.onClose?.()}
          aria-label="Close alert"
        >
          <CloseIcon />
        </button>
      </Show>
    </div>
  );
};

export default AlertBanner;
