/**
 * Confirm Dialog Component
 * Reusable confirmation dialog with danger/warning/info variants
 * Replaces inconsistent window.confirm() and ad-hoc modal implementations
 */

import { Component, Show, createSignal, JSX } from 'solid-js';
import { GlassModal } from './GlassModal';
import { GlassBtn } from './Button';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  message: string | JSX.Element;
  variant?: ConfirmVariant;
  confirmText?: string;
  cancelText?: string;
  /** Show loading state while onConfirm is executing */
  showLoading?: boolean;
}

const variantConfig = {
  danger: {
    confirmVariant: 'danger' as const,
    icon: '⚠️',
    defaultConfirmText: 'Delete',
  },
  warning: {
    confirmVariant: 'primary' as const,
    icon: '⚠️',
    defaultConfirmText: 'Continue',
  },
  info: {
    confirmVariant: 'primary' as const,
    icon: 'ℹ️',
    defaultConfirmText: 'OK',
  },
};

export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  const [isLoading, setIsLoading] = createSignal(false);
  
  const variant = () => props.variant ?? 'info';
  const config = () => variantConfig[variant()];
  
  const handleConfirm = async () => {
    if (props.showLoading) {
      setIsLoading(true);
      try {
        await props.onConfirm();
      } finally {
        setIsLoading(false);
      }
    } else {
      await props.onConfirm();
    }
    props.onClose();
  };
  
  const footer = (
    <div style={{ display: 'flex', gap: '0.75rem', 'justify-content': 'flex-end' }}>
      <GlassBtn
        variant="ghost"
        onClick={props.onClose}
        disabled={isLoading()}
      >
        {props.cancelText ?? 'Cancel'}
      </GlassBtn>
      <GlassBtn
        variant={config().confirmVariant}
        onClick={handleConfirm}
        disabled={isLoading()}
      >
        <Show when={isLoading()}>
          <span style={{ 'margin-right': '0.5rem' }}>⏳</span>
        </Show>
        {props.confirmText ?? config().defaultConfirmText}
      </GlassBtn>
    </div>
  );
  
  return (
    <GlassModal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.title ?? 'Confirm'}
      size="sm"
      footer={footer}
      closeOnOverlay={!isLoading()}
      closeOnEscape={!isLoading()}
    >
      <div style={{ display: 'flex', gap: '1rem', 'align-items': 'flex-start' }}>
        <span style={{ 'font-size': '1.5rem' }}>{config().icon}</span>
        <div style={{ flex: 1 }}>
          {typeof props.message === 'string' 
            ? <p style={{ margin: 0, color: 'var(--text-primary)' }}>{props.message}</p>
            : props.message
          }
        </div>
      </div>
    </GlassModal>
  );
};

/**
 * Hook to manage confirm dialog state
 * Usage:
 * const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
 * await showConfirm({ message: 'Delete this?', variant: 'danger' });
 */
export interface UseConfirmDialogOptions {
  defaultTitle?: string;
  defaultVariant?: ConfirmVariant;
}

export interface ConfirmOptions {
  title?: string;
  message: string | JSX.Element;
  variant?: ConfirmVariant;
  confirmText?: string;
  cancelText?: string;
}

export function useConfirmDialog(options: UseConfirmDialogOptions = {}) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [confirmOptions, setConfirmOptions] = createSignal<ConfirmOptions | null>(null);
  let resolvePromise: ((result: boolean) => void) | null = null;
  
  const showConfirm = (opts: ConfirmOptions): Promise<boolean> => {
    setConfirmOptions(opts);
    setIsOpen(true);
    
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };
  
  const handleClose = () => {
    setIsOpen(false);
    resolvePromise?.(false);
    resolvePromise = null;
  };
  
  const handleConfirm = () => {
    setIsOpen(false);
    resolvePromise?.(true);
    resolvePromise = null;
  };
  
  const ConfirmDialogElement = () => (
    <Show when={confirmOptions()}>
      <ConfirmDialog
        isOpen={isOpen()}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={confirmOptions()?.title ?? options.defaultTitle}
        message={confirmOptions()?.message ?? ''}
        variant={confirmOptions()?.variant ?? options.defaultVariant}
        confirmText={confirmOptions()?.confirmText}
        cancelText={confirmOptions()?.cancelText}
      />
    </Show>
  );
  
  return { showConfirm, ConfirmDialogElement, isOpen };
}

export default ConfirmDialog;
