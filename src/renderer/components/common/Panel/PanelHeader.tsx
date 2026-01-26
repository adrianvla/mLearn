/**
 * Panel Header Component
 * Reusable header with close button for aside panels (Live Word Translator, Subtitle Sync, etc.)
 * Matches the legacy .header + .btn.close pattern from the old app
 */

import { Component, JSX } from 'solid-js';
import './PanelHeader.css';

export interface PanelHeaderProps {
  /** Callback when close button is clicked */
  onClose?: () => void;
  /** Additional CSS class */
  class?: string;
  /** Custom styles */
  style?: JSX.CSSProperties;
  /** Show/hide close button (default: true) */
  showClose?: boolean;
  /** Alternative icon path for close button */
  closeIcon?: string;
  /** Children to render in the header (optional) */
  children?: JSX.Element;
}

export const PanelHeader: Component<PanelHeaderProps> = (props) => {
  const showClose = () => props.showClose !== false;
  
  return (
    <div class={`panel-header ${props.class || ''}`} style={props.style}>
      {props.children}
      {showClose() && (
        <div class="btn close" onClick={props.onClose}>
          <img src={props.closeIcon || 'assets/icons/cross.svg'} alt="close" />
        </div>
      )}
    </div>
  );
};

export default PanelHeader;
