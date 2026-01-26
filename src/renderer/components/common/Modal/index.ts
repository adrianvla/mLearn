/**
 * Modal Components Barrel Export
 */

export { 
  GlassModal, 
  ConfirmDialog as BasicConfirmDialog, 
  type GlassModalProps, 
  type ConfirmDialogProps as BasicConfirmDialogProps 
} from './GlassModal';
export { 
  ConfirmDialog, 
  useConfirmDialog, 
  type ConfirmDialogProps, 
  type ConfirmVariant, 
  type ConfirmOptions 
} from './ConfirmDialog';
export { WindowOverlay } from './WindowOverlay';

// Export type for WindowOverlay if it has props
export type { WindowOverlayProps } from './WindowOverlay';
