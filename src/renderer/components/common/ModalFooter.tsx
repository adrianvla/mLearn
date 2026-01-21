/**
 * ModalFooter Component
 * Standard footer for modal dialogs with action buttons
 */

import { Component, Show, JSX } from 'solid-js';
import './ModalFooter.css';

export interface ModalFooterProps {
  /** Cancel button text (default: "Cancel") */
  cancelText?: string;
  /** Confirm button text (default: "Confirm") */
  confirmText?: string;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Confirm button handler */
  onConfirm?: () => void;
  /** Confirm button variant */
  confirmVariant?: 'primary' | 'danger' | 'success';
  /** Disable confirm button */
  confirmDisabled?: boolean;
  /** Show loading state on confirm button */
  loading?: boolean;
  /** Hide cancel button */
  hideCancel?: boolean;
  /** Additional content to show on the left side */
  leftContent?: JSX.Element;
  /** Additional class */
  class?: string;
}

/**
 * ModalFooter - Standard footer with Cancel and Confirm buttons
 * 
 * Usage:
 * <ModalFooter
 *   onCancel={handleClose}
 *   onConfirm={handleSave}
 *   confirmText="Save"
 *   confirmVariant="primary"
 * />
 */
export const ModalFooter: Component<ModalFooterProps> = (props) => {
  const confirmClass = () => {
    const variant = props.confirmVariant || 'primary';
    return `modal-footer-btn modal-footer-btn-${variant}`;
  };

  return (
    <div class={`modal-footer ${props.class || ''}`}>
      <Show when={props.leftContent}>
        <div class="modal-footer-left">
          {props.leftContent}
        </div>
      </Show>
      
      <div class="modal-footer-actions">
        <Show when={!props.hideCancel}>
          <button
            type="button"
            class="modal-footer-btn modal-footer-btn-cancel"
            onClick={props.onCancel}
          >
            {props.cancelText || 'Cancel'}
          </button>
        </Show>
        
        <button
          type="button"
          class={confirmClass()}
          onClick={props.onConfirm}
          disabled={props.confirmDisabled || props.loading}
        >
          <Show when={props.loading}>
            <span class="modal-footer-spinner" />
          </Show>
          {props.confirmText || 'Confirm'}
        </button>
      </div>
    </div>
  );
};

export default ModalFooter;
