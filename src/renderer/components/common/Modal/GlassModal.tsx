/**
 * Glass Modal Component
 * Modal dialog with glassmorphism styling
 */

import { Component, JSX, Show, createEffect, onCleanup, splitProps, mergeProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { GlassPanel } from '../Panel';
import { IconBtn } from '../Button';

export interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnEscape?: boolean;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  footer?: JSX.Element;
  children?: JSX.Element;
  /** Whether the modal should take full viewport height (minus padding) */
  fullHeight?: boolean;
}

export const GlassModal: Component<GlassModalProps> = (props) => {
  const merged = mergeProps(
    {
      size: 'md' as const,
      closeOnEscape: true,
      closeOnOverlay: true,
      showCloseButton: true,
      fullHeight: false,
    },
    props
  );

  const [local] = splitProps(merged, [
    'isOpen',
    'onClose',
    'title',
    'subtitle',
    'size',
    'closeOnEscape',
    'closeOnOverlay',
    'showCloseButton',
    'footer',
    'children',
    'fullHeight',
  ]);

  // Handle escape key
  createEffect(() => {
    if (!local.isOpen || !local.closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        local.onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    onCleanup(() => document.removeEventListener('keydown', handleEscape));
  });

  // Lock body scroll when open
  createEffect(() => {
    if (local.isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      onCleanup(() => {
        document.body.style.overflow = originalOverflow;
      });
    }
  });

  const getMaxWidth = () => {
    switch (local.size) {
      case 'sm':
        return '24rem';
      case 'lg':
        return '48rem';
      case 'xl':
        return '64rem';
      case 'full':
        return 'calc(100vw - 2rem)';
      default:
        return '32rem';
    }
  };

  const overlayStyle = (): JSX.CSSProperties => ({
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    'background-color': 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: '1rem',
    'z-index': '1000',
    animation: 'fadeIn 0.2s ease',
  });

  const modalStyle = (): JSX.CSSProperties => ({
    'max-width': getMaxWidth(),
    width: '100%',
    'max-height': local.fullHeight ? 'calc(100vh - 2rem)' : local.size === 'full' ? 'calc(100vh - 2rem)' : '90vh',
    height: local.fullHeight ? 'calc(100vh - 2rem)' : 'auto',
    display: 'flex',
    'flex-direction': 'column',
    animation: 'slideUp 0.2s ease',
  });

  const CloseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );

  return (
    <Show when={local.isOpen}>
      <Portal>
        <div
          style={overlayStyle()}
          onClick={(e) => {
            if (e.target === e.currentTarget && local.closeOnOverlay) {
              local.onClose();
            }
          }}
        >
          <GlassPanel
            variant="dark"
            blur="lg"
            rounded="lg"
            padding="none"
            style={modalStyle()}
          >
            {/* Header */}
            <Show when={local.title || local.showCloseButton}>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'flex-start',
                  'justify-content': 'space-between',
                  padding: '1rem 1.5rem',
                  'border-bottom': '1px solid var(--glass-border)',
                }}
              >
                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.25rem' }}>
                  <Show when={local.title}>
                    <h2
                      style={{
                        margin: '0',
                        'font-size': '1.25rem',
                        'font-weight': '600',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {local.title}
                    </h2>
                  </Show>
                  <Show when={local.subtitle}>
                    <p
                      style={{
                        margin: '0',
                        'font-size': '0.875rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {local.subtitle}
                    </p>
                  </Show>
                </div>
                <Show when={local.showCloseButton}>
                  <IconBtn
                    variant="ghost"
                    size="sm"
                    aria-label="Close modal"
                    onClick={local.onClose}
                    style={{ 'margin-left': '1rem', 'flex-shrink': 0 }}
                  >
                    <CloseIcon />
                  </IconBtn>
                </Show>
              </div>
            </Show>

            {/* Content */}
            <div
              style={{
                flex: '1',
                overflow: 'auto',
                padding: '1.5rem',
              }}
            >
              {local.children}
            </div>

            {/* Footer */}
            <Show when={local.footer}>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'flex-end',
                  gap: '0.75rem',
                  padding: '1rem 1.5rem',
                  'border-top': '1px solid var(--glass-border)',
                }}
              >
                {local.footer}
              </div>
            </Show>
          </GlassPanel>
        </div>
      </Portal>
    </Show>
  );
};

// Confirmation dialog helper
export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  const merged = mergeProps(
    {
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      variant: 'default' as const,
    },
    props
  );

  return (
    <GlassModal
      isOpen={merged.isOpen}
      onClose={merged.onCancel}
      title={merged.title}
      size="sm"
      footer={
        <>
          <button
            class="glass-button"
            onClick={merged.onCancel}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {merged.cancelText}
          </button>
          <button
            class={merged.variant === 'danger' ? 'glass-button-danger' : 'glass-button-primary'}
            onClick={merged.onConfirm}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {merged.confirmText}
          </button>
        </>
      }
    >
      <p style={{ margin: '0', color: 'var(--text-secondary)' }}>
        {merged.message}
      </p>
    </GlassModal>
  );
};
