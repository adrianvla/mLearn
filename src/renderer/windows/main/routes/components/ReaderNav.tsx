/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import {Component, Accessor, Show} from 'solid-js';
import { NavBtn, Tag, Select, ChevronLeftIcon, ChevronRightIcon } from '../../../../components/common';
import { useLocalization } from '../../../../context';
import { isElectron } from '@shared/platform';
import './ReaderNav.css';
import Icon from "@renderer/components/common/Icons/Icon";

interface ReaderNavProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  fitMode: Accessor<string>;
  pageMode: Accessor<string>;
  spreadDirection: Accessor<string>;
  firstPageSingle: Accessor<boolean>;
  showOcrOverlay: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  onGoHome: () => void;
  onToggleSidebar: () => void;
  onToggleWordSidebar: () => void;
  onFitModeChange: (mode: string) => void;
  onPageModeChange: (mode: string) => void;
  onSpreadDirectionChange: (direction: string) => void;
  onToggleFirstPageSingle: () => void;
  onToggleOcrOverlay: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export const ReaderNav: Component<ReaderNavProps> = (props) => {
  const { t } = useLocalization();

  return (
    <nav class={`reader-nav panel`}>
      {/* Childless drag overlay: avoids Chromium bug where -webkit-app-region: drag
          on a complex element with children corrupts the OS drag hitbox bitmap,
          freezing all mouse events window-wide (electron/electron#1354) */}
      <Show when={isElectron()}>
        <div class="reader-nav-drag-region" />
      </Show>
      <div class="nav-group">
        <NavBtn class="sidebar-btn" onClick={props.onToggleSidebar}>
          <Icon icon="sidebar" color={"currentColor"} class={""}/>
        </NavBtn>
        <NavBtn onClick={props.onGoHome} title={t('mlearn.Reader.Toolbar.BackToHome')}>
          {t('mlearn.Reader.Toolbar.Home')}
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
          <>
            <Select
              options={[
                { value: 'right-to-left', label: t('mlearn.Reader.Toolbar.SpreadRightToLeft') },
                { value: 'left-to-right', label: t('mlearn.Reader.Toolbar.SpreadLeftToRight') },
              ]}
              value={props.spreadDirection()}
              onChange={(e) => props.onSpreadDirectionChange(e.currentTarget.value)}
            />
            <NavBtn
              onClick={props.onToggleFirstPageSingle}
              title={props.firstPageSingle() ? t('mlearn.Reader.Toolbar.FirstPageSingleTooltip') : t('mlearn.Reader.Toolbar.FirstPagePairedTooltip')}
              class={props.firstPageSingle() ? 'active' : ''}
            >
              {props.firstPageSingle() ? t('mlearn.Reader.Toolbar.PageLayoutSingle') : t('mlearn.Reader.Toolbar.PageLayoutPaired')}
            </NavBtn>
          </>
        )}
      </div>
      
      <div class="nav-group nav-arrows">
        <NavBtn onClick={props.onPrevPage}><ChevronLeftIcon size={16} /></NavBtn>
        <NavBtn onClick={props.onNextPage}><ChevronRightIcon size={16} /></NavBtn>
      </div>

      <div class="nav-group">
        <NavBtn class="sidebar-btn sidebar-btn-right" onClick={props.onToggleWordSidebar} title={t('mlearn.Reader.Toolbar.ToggleUnknownWordsSidebar')}>
          <Icon icon="sidebar" color={"currentColor"} class={"reader-nav-icon-mirrored"} />
        </NavBtn>
      </div>
    </nav>
  );
};

export default ReaderNav;
