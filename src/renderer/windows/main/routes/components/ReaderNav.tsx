/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import {Component, Accessor} from 'solid-js';
import { NavBtn, Tag, Select } from '../../../../components/common';
import { useLocalization } from '../../../../context';
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
  const { t } = useLocalization();

  return (
    <nav class={`reader-nav panel`}>
      <div
        class="nav-group"
        style={`${props.marginLeft ? `margin-left: ${props.marginLeft}` : ''}`}
      >
        <NavBtn onClick={props.onGoHome} title={t('mlearn.Reader.Toolbar.BackToHome')}>
          {t('mlearn.Reader.Toolbar.Home')}
        </NavBtn>
        <NavBtn class="sidebar-btn" onClick={props.onToggleSidebar}>
          <Icon icon="sidebar" color={"currentColor"} class={""}/>
        </NavBtn>
      </div>
        <div class="nav-group">
            <Tag class="book-title-nav label-secondary" headless size={"sm"}>{props.bookTitle()}</Tag>
        </div>
      
      <div class="nav-group">
        <Tag class="progress label-secondary" headless size={"sm"}>{props.progressString()}</Tag>
      </div>
      
      <div class="nav-group">
        <Select
          options={[
            { value: 'fit-height', label: t('mlearn.Reader.Toolbar.FitHeight') },
            { value: 'fit-width', label: t('mlearn.Reader.Toolbar.FitWidth') },
          ]}
          value={props.fitMode()}
          onChange={(e) => props.onFitModeChange(e.currentTarget.value)}
        />
        
        <Select
          options={[
            { value: 'double', label: t('mlearn.Reader.Toolbar.DoublePage') },
            { value: 'single', label: t('mlearn.Reader.Toolbar.SinglePage') },
          ]}
          value={props.pageMode()}
          onChange={(e) => props.onPageModeChange(e.currentTarget.value)}
        />
        
        {props.pageMode() === 'double' && (
          <NavBtn
            onClick={props.onToggleFirstPageSingle}
            title={props.firstPageSingle() ? t('mlearn.Reader.Toolbar.FirstPageSingleTooltip') : t('mlearn.Reader.Toolbar.FirstPagePairedTooltip')}
            class={props.firstPageSingle() ? 'active' : ''}
          >
            {props.firstPageSingle() ? t('mlearn.Reader.Toolbar.PageLayoutSingle') : t('mlearn.Reader.Toolbar.PageLayoutPaired')}
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
