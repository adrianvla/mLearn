/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import {Component, Accessor, Show, createSignal} from 'solid-js';
import { Button, Tag, Select, ChevronLeftIcon, ChevronRightIcon } from '../../../../components/common';
import { useLocalization } from '../../../../context';
import { isElectron } from '@shared/platform';
import './ReaderNav.css';
import Icon from "@renderer/components/common/Icons/Icon";
import { ReaderThemePopover } from './ReaderThemePopover';

interface ReaderNavProps {
  hasPages: Accessor<boolean>;
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  fitMode: Accessor<string>;
  pageMode: Accessor<string>;
  spreadDirection: Accessor<string>;
  firstPageSingle: Accessor<boolean>;
  showOcrOverlay: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  showTextTheme?: boolean;
  onGoHome: () => void;
  onToggleSidebar: () => void;
  onToggleWordSidebar: () => void;
  onFitModeChange: (mode: string) => void;
  onPageModeChange: (mode: string) => void;
  onSpreadDirectionChange: (direction: string) => void;
  onToggleFirstPageSingle: () => void;
  onToggleOcrOverlay: () => void;
  onOpenFolder: () => void;
  onOpenPdf: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export const ReaderNav: Component<ReaderNavProps> = (props) => {
  const { t } = useLocalization();
  const [themePopoverOpen, setThemePopoverOpen] = createSignal(false);
  let themeTriggerRef: HTMLButtonElement | undefined;

  const closeThemePopover = () => {
    setThemePopoverOpen(false);
    themeTriggerRef?.focus();
  };

  const handleThemeTriggerClick = (e: MouseEvent) => {
    themeTriggerRef = e.currentTarget as HTMLButtonElement;
    setThemePopoverOpen((open) => !open);
  };

  return (
    <nav class={`reader-nav panel`}>
      {/* Childless drag overlay: avoids Chromium bug where -webkit-app-region: drag
          on a complex element with children corrupts the OS drag hitbox bitmap,
          freezing all mouse events window-wide (electron/electron#1354) */}
      <Show when={isElectron()}>
        <div class="reader-nav-drag-region" />
      </Show>
      <div class="nav-group">
        <Show when={props.hasPages()}>
          <Button buttonType="nav" class="sidebar-btn" onClick={props.onToggleSidebar} aria-label={t('mlearn.Reader.Toolbar.ToggleContents')}>
            <Icon icon="sidebar" color={"currentColor"} class={""}/>
          </Button>
        </Show>
        <Button buttonType="nav" onClick={props.onGoHome} title={t('mlearn.Reader.Toolbar.BackToHome')}>
          {t('mlearn.Reader.Toolbar.Home')}
        </Button>
      </div>
      <Show when={props.hasPages()}>
        <div class="nav-group reader-nav-title">
            <Tag class="book-title-nav label-secondary" headless size={"sm"}>{props.bookTitle()}</Tag>
        </div>
      
      <div class="nav-group">
        <Tag class="progress label-secondary" headless size={"sm"}>{props.progressString()}</Tag>
      </div>
      
      <details class="nav-group reader-nav-options">
        <summary aria-label={t('mlearn.Reader.Toolbar.ViewOptions')}>{t('mlearn.Reader.Toolbar.ViewOptions')}</summary>
        <div class="reader-nav-options-panel">
        <Button buttonType="nav" onClick={props.onOpenFolder}>
          {t('mlearn.Reader.UI.WelcomeSplash.OpenFolder')}
        </Button>
        <Button buttonType="nav" onClick={props.onOpenPdf}>
          {t('mlearn.Reader.UI.WelcomeSplash.OpenPdf')}
        </Button>
        <Show when={props.showTextTheme}>
          <Button buttonType="nav"
            onClick={handleThemeTriggerClick}
            active={themePopoverOpen()}
            title={t('mlearn.Reader.Themes.Button')}
            aria-haspopup="true"
            aria-expanded={themePopoverOpen()}
          >
            {t('mlearn.Reader.Themes.Button')}
          </Button>
          <ReaderThemePopover
            open={themePopoverOpen}
            anchor={() => themeTriggerRef}
            onClose={closeThemePopover}
          />
        </Show>

        <Select
          options={[
            { value: 'fit-height', label: t('mlearn.Reader.Toolbar.FitHeight') },
            { value: 'fit-width', label: t('mlearn.Reader.Toolbar.FitWidth') },
          ]}
          aria-label={t('mlearn.Reader.Toolbar.PageFit')}
          value={props.fitMode()}
          onChange={(e) => props.onFitModeChange(e.currentTarget.value)}
        />
        
        <Select
          options={[
            { value: 'double', label: t('mlearn.Reader.Toolbar.DoublePage') },
            { value: 'single', label: t('mlearn.Reader.Toolbar.SinglePage') },
          ]}
          aria-label={t('mlearn.Reader.Toolbar.PageLayout')}
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
              aria-label={t('mlearn.Reader.Toolbar.PageOrder')}
              value={props.spreadDirection()}
              onChange={(e) => props.onSpreadDirectionChange(e.currentTarget.value)}
            />
            <Button buttonType="nav"
              onClick={props.onToggleFirstPageSingle}
              title={props.firstPageSingle() ? t('mlearn.Reader.Toolbar.FirstPageSingleTooltip') : t('mlearn.Reader.Toolbar.FirstPagePairedTooltip')}
              class={props.firstPageSingle() ? 'active' : ''}
            >
              {props.firstPageSingle() ? t('mlearn.Reader.Toolbar.PageLayoutSingle') : t('mlearn.Reader.Toolbar.PageLayoutPaired')}
            </Button>
          </>
        )}
        </div>
      </details>

      <div class="nav-group nav-arrows">
        <Button buttonType="nav" onClick={props.onPrevPage} aria-label={t('mlearn.Reader.Toolbar.PreviousPage')}><ChevronLeftIcon size={16} /></Button>
        <Button buttonType="nav" onClick={props.onNextPage} aria-label={t('mlearn.Reader.Toolbar.NextPage')}><ChevronRightIcon size={16} /></Button>
      </div>

      <div class="nav-group">
        <Button buttonType="nav" class="sidebar-btn sidebar-btn-right" onClick={props.onToggleWordSidebar} title={t('mlearn.Reader.Toolbar.ToggleUnknownWordsSidebar')}>
          <Icon icon="sidebar" color={"currentColor"} class={"reader-nav-icon-mirrored"} />
        </Button>
      </div>
      </Show>
    </nav>
  );
};

export default ReaderNav;
