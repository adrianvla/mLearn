/**
 * ErrorModal Component
 * Modal for displaying critical errors from the main process
 * Uses the Modal component for consistent styling
 * Includes retry, quit, and copy error actions
 */

import { Component, Show, createSignal, JSX, mergeProps } from 'solid-js';
import { Modal } from './Modal';
import { Btn } from '../Button';
import { ErrorIcon, WarningIcon } from '../Misc/Icons';
import { useLocalization } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { isElectron } from '../../../../shared/platform';
import './ErrorModal.css';

export type ErrorSeverity = 'error' | 'fatal' | 'warning';

export interface ErrorModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Error severity level */
  severity?: ErrorSeverity;
  /** Error title */
  title?: string;
  /** Error message to display */
  message: string;
  /** Technical details (collapsible) */
  details?: string;
  /** Called when user clicks retry */
  onRetry?: () => void;
  /** Called when user clicks quit */
  onQuit?: () => void;
  /** Called when modal is closed */
  onClose?: () => void;
  /** Show retry button */
  showRetry?: boolean;
  /** Show quit button */
  showQuit?: boolean;
  /** Show close button */
  showClose?: boolean;
  /** Custom actions to render */
  actions?: JSX.Element;
}

export const ErrorModal: Component<ErrorModalProps> = (props) => {
  const { t } = useLocalization();
  const [showDetails, setShowDetails] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const merged = mergeProps(
    {
      severity: 'error' as const,
      showRetry: true,
      showQuit: true,
      showClose: false,
    },
    props
  );

  const severityConfig = {
    error: {
      icon: <ErrorIcon size={24} />,
      colorClass: 'error-modal--error',
      defaultTitle: t('mlearn.ErrorModal.Title.Error'),
    },
    fatal: {
      icon: <ErrorIcon size={24} />,
      colorClass: 'error-modal--fatal',
      defaultTitle: t('mlearn.ErrorModal.Title.Fatal'),
    },
    warning: {
      icon: <WarningIcon size={24} />,
      colorClass: 'error-modal--warning',
      defaultTitle: t('mlearn.ErrorModal.Title.Warning'),
    },
  };

  const config = () => severityConfig[merged.severity];

  const handleCopyError = async () => {
    const errorText = [
      `Error: ${merged.title || config().defaultTitle}`,
      `Message: ${merged.message}`,
      merged.details ? `Details: ${merged.details}` : '',
      `Timestamp: ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');

    try {
      if (isElectron()) {
        getBridge().files.writeToClipboard(errorText);
      } else {
        await navigator.clipboard.writeText(errorText);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy error:', e);
    }
  };

  const handleRetry = () => {
    merged.onRetry?.();
  };

  const handleQuit = () => {
    if (merged.onQuit) {
      merged.onQuit();
    } else {
      getBridge().window.closeWindow();
    }
  };

  const handleClose = () => {
    merged.onClose?.();
  };

  const hasClose = () => !!(merged.showClose && merged.onClose);

  const footer = (
    <div class="error-modal-actions">
      <Btn
        variant="ghost"
        size="sm"
        onClick={handleCopyError}
      >
        {copied() 
          ? t('mlearn.ErrorModal.Copied')
          : t('mlearn.ErrorModal.CopyError')
        }
      </Btn>
      
      <div class="error-modal-actions-primary">
        {merged.actions}
        
        <Show when={merged.showRetry && merged.onRetry}>
          <Btn
            variant="primary"
            onClick={handleRetry}
          >
            {t('mlearn.Global.TryAgain')}
          </Btn>
        </Show>
        
        <Show when={merged.showQuit}>
          <Btn
            variant={merged.severity === 'fatal' ? 'danger' : 'ghost'}
            onClick={handleQuit}
          >
            {t('mlearn.ErrorModal.Quit')}
          </Btn>
        </Show>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={merged.isOpen}
      onClose={handleClose}
      title={
        <>
          <div class="error-modal-header-icon">
            {merged.title || config().defaultTitle}
            <span class="error-modal-icon">{config().icon}</span>
          </div>
        </>
      }
      size="lg"
      closeOnEscape={hasClose()}
      closeOnOverlay={hasClose()}
      showCloseButton={hasClose()}
      panelClass={`error-modal-panel ${config().colorClass}`}
      footer={footer}
    >

      <div class="error-modal-content">
        <p class="error-modal-message">{merged.message}</p>

        <Show when={merged.details}>
          <button 
            class="error-modal-details-toggle"
            onClick={() => setShowDetails(!showDetails())}
          >
            {showDetails() 
              ? t('mlearn.ErrorModal.HideDetails')
              : t('mlearn.ErrorModal.ShowDetails')
            }
          </button>
          
          <Show when={showDetails()}>
            <pre class="error-modal-details">{merged.details}</pre>
          </Show>
        </Show>
      </div>
    </Modal>
  );
};

export default ErrorModal;
