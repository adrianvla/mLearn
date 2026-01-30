/**
 * Input Components
 * Form inputs with consistent styling
 */

import { Component, JSX, Show, splitProps, mergeProps } from 'solid-js';

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  fullWidth?: boolean;
}

export const Input: Component<InputProps> = (props) => {
  const merged = mergeProps(
    {
      size: 'md' as const,
      fullWidth: false,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'label',
    'error',
    'hint',
    'size',
    'leftIcon',
    'rightIcon',
    'fullWidth',
    'class',
    'style',
  ]);

  const getInputSize = (): JSX.CSSProperties => {
    switch (local.size) {
      case 'sm':
        return {
          height: '2rem',
          'font-size': '0.875rem',
          padding: local.leftIcon ? '0.25rem 0.5rem 0.25rem 2rem' : '0.25rem 0.5rem',
        };
      case 'lg':
        return {
          height: '3rem',
          'font-size': '1.125rem',
          padding: local.leftIcon ? '0.5rem 0.75rem 0.5rem 2.5rem' : '0.5rem 0.75rem',
        };
      default:
        return {
          height: '2.5rem',
          'font-size': '1rem',
          padding: local.leftIcon ? '0.375rem 0.625rem 0.375rem 2.25rem' : '0.375rem 0.625rem',
        };
    }
  };

  const containerStyle = (): JSX.CSSProperties => ({
    display: 'flex',
    'flex-direction': 'column',
    gap: '0.375rem',
    width: local.fullWidth ? '100%' : 'auto',
  });

  const inputWrapperStyle = (): JSX.CSSProperties => ({
    position: 'relative',
    display: 'flex',
    'align-items': 'center',
  });

  const inputStyle = (): JSX.CSSProperties => ({
    width: '100%',
    'background-color': 'var(--bg)',
    border: `1px solid ${local.error ? 'var(--color-danger)' : 'var(--border-color)'}`,
    'border-radius': 'var(--radius-md)',
    color: 'var(--text-primary)',
    'font-family': 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    ...getInputSize(),
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  const iconStyle = (position: 'left' | 'right'): JSX.CSSProperties => ({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    [position]: '0.625rem',
    color: 'var(--text-secondary)',
    'pointer-events': 'none',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
  });

  return (
    <div style={containerStyle()}>
      <Show when={local.label}>
        <label
          style={{
            'font-size': '0.875rem',
            'font-weight': '500',
            color: 'var(--text-primary)',
          }}
        >
          {local.label}
        </label>
      </Show>

      <div style={inputWrapperStyle()}>
        <Show when={local.leftIcon}>
          <span style={iconStyle('left')}>{local.leftIcon}</span>
        </Show>

        <input
          class={`glass-input ${local.class || ''}`}
          style={inputStyle()}
          {...rest}
        />

        <Show when={local.rightIcon}>
          <span style={iconStyle('right')}>{local.rightIcon}</span>
        </Show>
      </div>

      <Show when={local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--color-danger)' }}>
          {local.error}
        </span>
      </Show>

      <Show when={local.hint && !local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--text-secondary)' }}>
          {local.hint}
        </span>
      </Show>
    </div>
  );
};

// Textarea variant
export interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  fullWidth?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export const Textarea: Component<TextareaProps> = (props) => {
  const merged = mergeProps(
    {
      fullWidth: false,
      resize: 'vertical' as const,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'label',
    'error',
    'hint',
    'fullWidth',
    'resize',
    'class',
    'style',
  ]);

  const containerStyle = (): JSX.CSSProperties => ({
    display: 'flex',
    'flex-direction': 'column',
    gap: '0.375rem',
    width: local.fullWidth ? '100%' : 'auto',
  });

  const textareaStyle = (): JSX.CSSProperties => ({
    width: '100%',
    'min-height': '6rem',
    'background-color': 'var(--bg)',
    border: `1px solid ${local.error ? 'var(--color-danger)' : 'var(--border-color)'}`,
    'border-radius': 'var(--radius-md)',
    color: 'var(--text-primary)',
    'font-family': 'inherit',
    'font-size': '1rem',
    padding: '0.625rem',
    outline: 'none',
    resize: local.resize,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  return (
    <div style={containerStyle()}>
      <Show when={local.label}>
        <label
          style={{
            'font-size': '0.875rem',
            'font-weight': '500',
            color: 'var(--text-primary)',
          }}
        >
          {local.label}
        </label>
      </Show>

      <textarea
        class={`glass-input ${local.class || ''}`}
        style={textareaStyle()}
        {...rest}
      />

      <Show when={local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--color-danger)' }}>
          {local.error}
        </span>
      </Show>

      <Show when={local.hint && !local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--text-secondary)' }}>
          {local.hint}
        </span>
      </Show>
    </div>
  );
};

// Select variant
export interface SelectInputProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const SelectInput: Component<SelectInputProps> = (props) => {
  const merged = mergeProps(
    {
      size: 'md' as const,
      fullWidth: false,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'label',
    'error',
    'hint',
    'size',
    'fullWidth',
    'options',
    'class',
    'style',
  ]);

  const getSelectSize = (): JSX.CSSProperties => {
    switch (local.size) {
      case 'sm':
        return { height: '2rem', 'font-size': '0.875rem', padding: '0.25rem 2rem 0.25rem 0.5rem' };
      case 'lg':
        return { height: '3rem', 'font-size': '1.125rem', padding: '0.5rem 2.5rem 0.5rem 0.75rem' };
      default:
        return { height: '2.5rem', 'font-size': '1rem', padding: '0.375rem 2.25rem 0.375rem 0.625rem' };
    }
  };

  const containerStyle = (): JSX.CSSProperties => ({
    display: 'flex',
    'flex-direction': 'column',
    gap: '0.375rem',
    width: local.fullWidth ? '100%' : 'auto',
  });

  const selectWrapperStyle = (): JSX.CSSProperties => ({
    position: 'relative',
    display: 'flex',
    'align-items': 'center',
  });

  const selectStyle = (): JSX.CSSProperties => ({
    width: '100%',
    'background-color': 'var(--bg)',
    border: `1px solid ${local.error ? 'var(--color-danger)' : 'var(--border-color)'}`,
    'border-radius': 'var(--radius-md)',
    color: 'var(--text-primary)',
    'font-family': 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    ...getSelectSize(),
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  const ChevronIcon = () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      style={{
        position: 'absolute',
        right: '0.625rem',
        top: '50%',
        transform: 'translateY(-50%)',
        'pointer-events': 'none',
        color: 'var(--text-secondary)',
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );

  return (
    <div style={containerStyle()}>
      <Show when={local.label}>
        <label
          style={{
            'font-size': '0.875rem',
            'font-weight': '500',
            color: 'var(--text-primary)',
          }}
        >
          {local.label}
        </label>
      </Show>

      <div style={selectWrapperStyle()}>
        <select
          class={`glass-input ${local.class || ''}`}
          style={selectStyle()}
          {...rest}
        >
          {local.options.map((opt) => (
            <option value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </div>

      <Show when={local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--color-danger)' }}>
          {local.error}
        </span>
      </Show>

      <Show when={local.hint && !local.error}>
        <span style={{ 'font-size': '0.75rem', color: 'var(--text-secondary)' }}>
          {local.hint}
        </span>
      </Show>
    </div>
  );
};