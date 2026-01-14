/**
 * Glass Button Component
 * Button with glassmorphism styling
 */

import { Component, JSX, splitProps, mergeProps } from 'solid-js';

export interface GlassButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: JSX.Element;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children?: JSX.Element;
}

export const GlassButton: Component<GlassButtonProps> = (props) => {
  const merged = mergeProps(
    {
      variant: 'default' as const,
      size: 'md' as const,
      iconPosition: 'left' as const,
      loading: false,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'variant',
    'size',
    'icon',
    'iconPosition',
    'loading',
    'children',
    'class',
    'style',
    'disabled',
  ]);

  const getVariantClass = () => {
    switch (local.variant) {
      case 'primary':
        return 'glass-button-primary';
      case 'danger':
        return 'glass-button-danger';
      case 'ghost':
        return 'glass-button-ghost';
      default:
        return 'glass-button';
    }
  };

  const getSizeStyle = (): JSX.CSSProperties => {
    switch (local.size) {
      case 'sm':
        return {
          padding: '0.375rem 0.75rem',
          'font-size': '0.875rem',
          'min-height': '2rem',
        };
      case 'lg':
        return {
          padding: '0.75rem 1.5rem',
          'font-size': '1.125rem',
          'min-height': '3rem',
        };
      default:
        return {
          padding: '0.5rem 1rem',
          'font-size': '1rem',
          'min-height': '2.5rem',
        };
    }
  };

  const baseStyle = (): JSX.CSSProperties => ({
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '0.5rem',
    border: 'none',
    cursor: local.disabled || local.loading ? 'not-allowed' : 'pointer',
    opacity: local.disabled || local.loading ? '0.6' : '1',
    transition: 'all 0.2s ease',
    'border-radius': 'var(--radius-md)',
    'font-family': 'inherit',
    'font-weight': '500',
    'white-space': 'nowrap',
    ...getSizeStyle(),
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  const LoadingSpinner = () => (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="31.4 31.4"
        style={{ opacity: 0.3 }}
      />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="31.4 31.4"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );

  return (
    <button
      class={`${getVariantClass()} ${local.class || ''}`}
      style={baseStyle()}
      disabled={local.disabled || local.loading}
      {...rest}
    >
      {local.loading && <LoadingSpinner />}
      {!local.loading && local.icon && local.iconPosition === 'left' && local.icon}
      {local.children}
      {!local.loading && local.icon && local.iconPosition === 'right' && local.icon}
    </button>
  );
};

// Icon button variant
export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'primary' | 'ghost';
  children: JSX.Element;
  'aria-label': string;
}

export const IconButton: Component<IconButtonProps> = (props) => {
  const merged = mergeProps(
    {
      size: 'md' as const,
      variant: 'default' as const,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'size',
    'variant',
    'children',
    'class',
    'style',
  ]);

  const getSize = () => {
    switch (local.size) {
      case 'sm':
        return '2rem';
      case 'lg':
        return '3rem';
      default:
        return '2.5rem';
    }
  };

  const getVariantClass = () => {
    switch (local.variant) {
      case 'primary':
        return 'glass-button-primary';
      case 'ghost':
        return 'glass-button-ghost';
      default:
        return 'glass-button';
    }
  };

  const style = (): JSX.CSSProperties => ({
    width: getSize(),
    height: getSize(),
    padding: '0',
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  return (
    <button
      class={`${getVariantClass()} ${local.class || ''}`}
      style={style()}
      {...rest}
    >
      {local.children}
    </button>
  );
};
