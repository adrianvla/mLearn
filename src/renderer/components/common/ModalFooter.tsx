/**
 * ModalFooter Component
 * Standard footer for modal dialogs with action buttons
 */

import { Component, Show, JSX } from 'solid-js';
import { Button } from './Button';
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
  const confirmVariant = () => {
    const variant = props.confirmVariant || 'primary';
    return variant;
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
          <Button
            buttonType="glass"
            variant="secondary"
            onClick={props.onCancel}
            class="modal-footer-btn-cancel"
          >
            {props.cancelText || 'Cancel'}
          </Button>
        </Show>
        
        <Button
          buttonType="glass"
          variant={confirmVariant()}
          onClick={props.onConfirm}
          disabled={props.confirmDisabled}
          loading={props.loading}
        >
          {props.confirmText || 'Confirm'}
        </Button>
      </div>
    </div>
  );
};

export default ModalFooter;
