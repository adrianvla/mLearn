/**
 * Modal Components Barrel Export
 */

export { Modal, type ModalProps } from './Modal';
export { 
  ConfirmDialog, 
  useConfirmDialog, 
  type ConfirmDialogProps, 
  type ConfirmVariant, 
  type ConfirmOptions 
} from './ConfirmDialog';
export { WindowOverlay, type WindowOverlayProps } from './WindowOverlay';
export { 
  LoadingOverlay, 
  type LoadingOverlayProps 
} from './LoadingOverlay';
export { 
  ErrorModal, 
  type ErrorModalProps, 
  type ErrorSeverity 
} from './ErrorModal';
export { DraggablePopup, type DraggablePopupProps } from './DraggablePopup';

// Import CSS
import './LoadingOverlay.css';
import './ErrorModal.css';
