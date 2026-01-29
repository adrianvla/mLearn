/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import {Component, Accessor} from 'solid-js';
import { NavBtn, Tag, Select } from '../../../../components/common';
import './ReaderNav.css';
import Icon from "@renderer/components/common/Icons/Icon";

interface ReaderNavProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  fitMode: Accessor<string>;
  pageMode: Accessor<string>;
  firstPageSingle: Accessor<boolean>;
  showOcrOverlay: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  onGoHome: () => void;
  onToggleSidebar: () => void;
  onFitModeChange: (mode: string) => void;
  onPageModeChange: (mode: string) => void;
  onToggleFirstPageSingle: () => void;
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
          <Icon icon="sidebar" color={"currentColor"} class={""}/>
        </NavBtn>
        <Tag class="book-title-nav label-secondary" headless size={"sm"}>{props.bookTitle()}</Tag>
      </div>
      
      <div class="nav-group">
        <Tag class="progress label-secondary" headless size={"sm"}>{props.progressString()}</Tag>
      </div>
      
      <div class="nav-group">
        <Select
          options={[
            { value: 'fit-height', label: 'Fit Height ↕' },
            { value: 'fit-width', label: 'Fit Width ↔' },
          ]}
          value={props.fitMode()}
          onChange={(e) => props.onFitModeChange(e.currentTarget.value)}
        />
        
        <Select
          options={[
            { value: 'double', label: 'Double Page' },
            { value: 'single', label: 'Single Page' },
          ]}
          value={props.pageMode()}
          onChange={(e) => props.onPageModeChange(e.currentTarget.value)}
        />
        
        {props.pageMode() === 'double' && (
          <NavBtn
            onClick={props.onToggleFirstPageSingle}
            title={props.firstPageSingle() ? 'First page is single (click to pair)' : 'First page is paired (click to make single)'}
            class={props.firstPageSingle() ? 'active' : ''}
          >
            {props.firstPageSingle() ? '1|2+3' : '1+2|3+4'}
          </NavBtn>
        )}
      </div>
      
      <div class="nav-group nav-arrows">
        <NavBtn onClick={props.onPrevPage}>◀</NavBtn>
        <NavBtn onClick={props.onNextPage}>▶</NavBtn>
      </div>
    </nav>
  );
};

export default ReaderNav;
