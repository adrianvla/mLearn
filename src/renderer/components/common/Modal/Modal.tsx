/**
 * Modal Component
 * Modal dialog with themed styling
 */

import { Component, JSX, Show, createEffect, onCleanup, splitProps, mergeProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Panel } from '../Panel';
import { IconBtn } from '../Button';
import { CloseIcon } from '../Misc/Icons';
import { useLocalization } from '../../../context';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: JSX.Element | string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnEscape?: boolean;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  footer?: JSX.Element;
  children?: JSX.Element;
  /** Whether the modal should take full viewport height (minus padding) */
  fullHeight?: boolean;
  /** Optional class applied to the panel container */
  panelClass?: string;
}

export const Modal: Component<ModalProps> = (props) => {
  const { t } = useLocalization();
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
    'panelClass',
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
    'background-color': 'var(--overlay-bg)',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: 'var(--spacing-4)',
    'z-index': 'var(--z-modal)',
    animation: 'fadeIn var(--transition-normal)',
    "backdrop-filter": "blur(4px)",
  });

  const modalStyle = (): JSX.CSSProperties => ({
    'max-width': getMaxWidth(),
    width: '100%',
    'max-height': local.fullHeight ? 'calc(100vh - var(--spacing-8))' : local.size === 'full' ? 'calc(100vh - var(--spacing-8))' : '90vh',
    height: local.fullHeight ? 'calc(100vh - var(--spacing-8))' : 'auto',
    display: 'flex',
    'flex-direction': 'column',
    animation: 'slideUp var(--transition-normal)',
  });

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
          <Panel
            variant="solid"
            rounded="lg"
            padding="none"
            class={local.panelClass}
            style={modalStyle()}
          >
            {/* Header */}
            <Show when={local.title || local.showCloseButton}>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'flex-start',
                  'justify-content': 'space-between',
                  padding: 'var(--spacing-4) var(--spacing-6)',
                  'border-bottom': '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--spacing-1)' }}>
                  <Show when={local.title}>
                    <h2
                      style={{
                        margin: '0',
                        'font-size': 'var(--font-size-xl)',
                        'font-weight': 'var(--font-weight-semibold)',
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
                        'font-size': 'var(--font-size-sm)',
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
                    aria-label={t('mlearn.Global.Aria.CloseModal')}
                    onClick={local.onClose}
                    style={{ 'margin-left': 'var(--spacing-4)', 'flex-shrink': 0 }}
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
                padding: 'var(--spacing-6) var(--spacing-6) 0',
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
                  gap: 'var(--spacing-3)',
                  padding: 'var(--spacing-4) var(--spacing-6)',
                  'border-top': '1px solid var(--border-color)',
                }}
              >
                {local.footer}
              </div>
            </Show>
          </Panel>
        </div>
      </Portal>
    </Show>
  );
};
