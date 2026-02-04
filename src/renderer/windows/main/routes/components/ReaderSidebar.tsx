/**
 * Reader Sidebar Component
 * Page thumbnails sidebar
 */

import {Component, For, Accessor, Show, createEffect} from 'solid-js';
import { Tag, Indicator } from '../../../../components/common';
import { useLocalization } from '../../../../context';
import './ReaderSidebar.css';

interface PageImage {
  id: string;
  src: string;
  name: string;
  index: number;
}

type PageMode = 'single' | 'double';

interface ReaderSidebarProps {
  pages: Accessor<PageImage[]>;
  currentPage: Accessor<number>;
  pageMode: Accessor<PageMode>;
  hasOcrForPage: (pageId: string) => boolean;
  onGoToPage: (index: number) => void;
}

export const ReaderSidebar: Component<ReaderSidebarProps> = (props) => {
  const { t } = useLocalization();
  const thumbRefs = new Map<number, HTMLDivElement>();
  let sidebarRef: HTMLElement | undefined;

  // Determine which pages are currently active based on page mode
  const isPageActive = (pageIndex: number): boolean => {
    const current = props.currentPage();
    const mode = props.pageMode();

    if (mode === 'single') {
      return pageIndex === current;
    } else {
      // Double page mode: current page and next page are both active
      return pageIndex === current || pageIndex === current + 1;
    }
  };

  // Helper to scroll to current page thumbnail(s)
  const scrollToCurrentPage = (pageIndex: number, mode: PageMode, smooth: boolean = true) => {
    const firstThumb = thumbRefs.get(pageIndex);
    if (!firstThumb || !sidebarRef) return;

    const behavior = smooth ? 'smooth' : 'instant';

    if (mode === 'single') {
      // Single page: just center the current page
      firstThumb.scrollIntoView({ behavior, block: 'center' });
    } else {
      // Double page: scroll to center between current and next page
      const secondThumb = thumbRefs.get(pageIndex + 1);
      if (secondThumb) {
        // Calculate midpoint between both thumbnails and scroll to it
        const firstRect = firstThumb.getBoundingClientRect();
        const secondRect = secondThumb.getBoundingClientRect();
        const containerRect = sidebarRef.getBoundingClientRect();
        const midpoint = (firstRect.top + secondRect.bottom) / 2 - containerRect.top + sidebarRef.scrollTop;
        const targetScroll = midpoint - sidebarRef.clientHeight / 2;
        sidebarRef.scrollTo({ top: targetScroll, behavior });
      } else {
        // No second page (last page in odd-total book), just center first
        firstThumb.scrollIntoView({ behavior, block: 'center' });
      }
    }
  };

  // Scroll to center between active page thumbnails when page changes or pages load
  // Track pages() to re-run when new book is loaded and refs are populated
  createEffect(() => {
    const pageIndex = props.currentPage();
    const mode = props.pageMode();
    const allPages = props.pages();

    // If no pages yet, nothing to scroll to
    if (allPages.length === 0) return;

    // Wait for refs to be populated after render
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      // Check if the ref exists now (it should after <For> renders)
      if (thumbRefs.has(pageIndex)) {
        scrollToCurrentPage(pageIndex, mode, true);
      } else {
        // If ref still doesn't exist, retry once more after a frame
        // This handles edge cases where DOM update is slightly delayed
        requestAnimationFrame(() => {
          scrollToCurrentPage(pageIndex, mode, true);
        });
      }
    });
  });

  return (
      <aside class="reader-sidebar panel" ref={sidebarRef}>
        <h2>{t('mlearn.Reader.Sidebar.Pages')}</h2>
        <div class="page-list">
          <For each={props.pages()}>
            {(page) => (
                <div
                    ref={(el) => thumbRefs.set(page.index, el)}
                    class={`page-thumb ${isPageActive(page.index) ? 'active' : ''}`}
                    onClick={() => props.onGoToPage(page.index)}
                >
                  <img src={page.src} alt={page.name} />
                  <Tag class="page-number">{page.index + 1}</Tag>
                  <Show when={props.hasOcrForPage(page.id)}>
                    <Indicator class="ocr-indicator" variant="primary" />
                  </Show>
                </div>
            )}
          </For>
        </div>
      </aside>
  );
};

export default ReaderSidebar;
