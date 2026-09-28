// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

vi.mock('../../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => ({
      'mlearn.Reader.Toolbar.ViewOptions': 'View options',
      'mlearn.Reader.UI.WelcomeSplash.OpenFolder': 'Open Image Folder',
      'mlearn.Reader.UI.WelcomeSplash.OpenPdf': 'Open PDF/EPUB',
    })[key] ?? key,
  }),
}));
vi.mock('@shared/platform', () => ({ isElectron: () => false }));
vi.mock('../../../../components/common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void; class?: string }) =>
    <button class={props.class} onClick={props.onClick}>{props.children}</button>,
  Tag: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  Select: () => <select />,
  ChevronLeftIcon: () => <span />,
  ChevronRightIcon: () => <span />,
}));
vi.mock('@renderer/components/common/Icons/Icon', () => ({ default: () => <span /> }));
vi.mock('./ReaderThemePopover', () => ({ ReaderThemePopover: () => <div /> }));

describe('ReaderNav', () => {
  let host: HTMLDivElement;
  afterEach(() => host?.remove());

  it('keeps navigation visible and exposes import actions through view options', async () => {
    const { ReaderNav } = await import('./ReaderNav');
    host = document.createElement('div');
    document.body.appendChild(host);
    const openFolder = vi.fn();
    const openPdf = vi.fn();
    const dispose = render(() => <ReaderNav
      hasPages={() => true}
      bookTitle={() => 'A book'}
      progressString={() => '2/3'}
      fitMode={() => 'fit-height'}
      pageMode={() => 'single'}
      spreadDirection={() => 'left-to-right'}
      firstPageSingle={() => true}
      showOcrOverlay={() => false}
      hasOcrResult={() => false}
      onGoHome={() => undefined}
      onToggleSidebar={() => undefined}
      onToggleWordSidebar={() => undefined}
      onFitModeChange={() => undefined}
      onPageModeChange={() => undefined}
      onSpreadDirectionChange={() => undefined}
      onToggleFirstPageSingle={() => undefined}
      onToggleOcrOverlay={() => undefined}
      onOpenFolder={openFolder}
      onOpenPdf={openPdf}
      onPrevPage={() => undefined}
      onNextPage={() => undefined}
    />, host);

    expect(host.querySelector('details.reader-nav-options > summary')?.textContent).toBe('View options');
    expect(host.querySelector('details.reader-nav-options')).not.toBeNull();
    const buttons = Array.from(host.querySelectorAll('button'));
    const imageFolderButton = buttons.find(button => button.textContent === 'Open Image Folder');
    const pdfButton = buttons.find(button => button.textContent === 'Open PDF/EPUB');
    imageFolderButton?.click();
    pdfButton?.click();
    expect(openFolder).toHaveBeenCalledOnce();
    expect(openPdf).toHaveBeenCalledOnce();
    dispose();
  });
});
