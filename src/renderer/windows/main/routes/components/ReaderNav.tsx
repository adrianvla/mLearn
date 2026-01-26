/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import {Component, Accessor} from 'solid-js';
import { NavBtn, Tag } from '../../../../components/common';
import './ReaderNav.css';

interface ReaderNavProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  fitMode: Accessor<string>;
  pageMode: Accessor<string>;
  showOcrOverlay: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  onGoHome: () => void;
  onToggleSidebar: () => void;
  onFitModeChange: (mode: string) => void;
  onPageModeChange: (mode: string) => void;
  onToggleOcrOverlay: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  marginLeft?: string;
}

export const ReaderNav: Component<ReaderNavProps> = (props) => {

  return (
    <nav class={`reader-nav glass`}>
      <div
        class="nav-group"
        style={`${props.marginLeft ? `margin-left: ${props.marginLeft}` : ''}`}
      >
        <NavBtn onClick={props.onGoHome} title="Back to Home">
          ← Home
        </NavBtn>
        <NavBtn class="sidebar-btn" onClick={props.onToggleSidebar}>
          📑
        </NavBtn>
        <Tag class="book-title-nav">{props.bookTitle()}</Tag>
      </div>
      
      <div class="nav-group">
        <Tag class="progress">{props.progressString()}</Tag>
      </div>
      
      <div class="nav-group">
        <select
          class="glass-select"
          value={props.fitMode()}
          onChange={(e) => props.onFitModeChange(e.currentTarget.value)}
        >
          <option value="fit-height">Fit Height ↕</option>
          <option value="fit-width">Fit Width ↔</option>
        </select>
        
        <select
          class="glass-select"
          value={props.pageMode()}
          onChange={(e) => props.onPageModeChange(e.currentTarget.value)}
        >
          <option value="double">Double Page</option>
          <option value="single">Single Page</option>
        </select>
      </div>
      
      <div class="nav-group nav-arrows">
        <NavBtn onClick={props.onPrevPage}>◀</NavBtn>
        <NavBtn onClick={props.onNextPage}>▶</NavBtn>
      </div>
    </nav>
  );
};

export default ReaderNav;
