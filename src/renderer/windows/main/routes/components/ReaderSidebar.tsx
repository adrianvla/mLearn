/**
 * Reader Sidebar Component
 * Page thumbnails sidebar
 */

import { Component, For, Accessor, Show, batch, createEffect, createSignal, onCleanup, createMemo } from 'solid-js';
import { Tag, Indicator, Spinner } from '../../../../components/common';
import { createVirtualizer } from '../../../../hooks';
import './ReaderSidebar.css';

/** Maximum thumbnail width in pixels — keeps images crisp at sidebar size without aliasing */
const THUMB_MAX_WIDTH = 200;
const THUMB_ASPECT_RATIO = 3 / 4;

interface PageImage {
  id: string;
  kind?: 'image' | 'text';
  src?: string;
  name: string;
  index: number;
  title?: string;
  text?: string;
  previewText?: string;
}

interface ReaderSidebarProps {
  pages: Accessor<PageImage[]>;
  activePageIndices: Accessor<number[]>;
  hasOcrForPage: (pageId: string) => boolean;
  onGoToPage: (index: number) => void;
}

export const ReaderSidebar: Component<ReaderSidebarProps> = (props) => {
  const thumbUrlCache = new Map<string, string>();
  let skipNextActivePageSync = false;
  const [loadedPages, setLoadedPages] = createSignal<Set<number>>(new Set());
  const [pageListRef, setPageListRef] = createSignal<HTMLDivElement>();
  const [thumbnailRowSize, setThumbnailRowSize] = createSignal(THUMB_MAX_WIDTH / THUMB_ASPECT_RATIO);
  const [virtualScrollReady, setVirtualScrollReady] = createSignal(false);
  const activePageIndexSet = createMemo(() => new Set(props.activePageIndices()));
  const virtualizer = createVirtualizer({
    count: () => props.pages().length,
    getScrollElement: () => pageListRef(),
    estimateSize: () => thumbnailRowSize(),
    overscan: 1,
  });

  // Reset loaded state when pages change (new book loaded)
  createEffect(() => {
    props.pages(); // track
    setLoadedPages(new Set<number>());
  });

  // Revoke all cached thumbnail blob URLs on cleanup
  onCleanup(() => {
    for (const url of thumbUrlCache.values()) URL.revokeObjectURL(url);
    thumbUrlCache.clear();
  });

  createEffect(() => {
    const element = pageListRef();
    if (!element) return;

    const measureRow = () => {
      const styles = getComputedStyle(element);
      const parsedGap = Number.parseFloat(styles.getPropertyValue('--reader-thumbnail-gap'));
      const gap = Number.isFinite(parsedGap) ? parsedGap : 0;
      const rowSize = element.clientWidth / THUMB_ASPECT_RATIO + gap;
      if (rowSize > 0) setThumbnailRowSize(rowSize);
    };

    measureRow();

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureRow);
    resizeObserver?.observe(element);

    if (!resizeObserver) window.addEventListener('resize', measureRow);

    onCleanup(() => {
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', measureRow);
    });
  });

  /**
   * Downscale a full-resolution image URL to a small thumbnail blob URL.
   * Uses an offscreen canvas and caches the result per src.
   */
  const markPageLoaded = (pageIndex: number) => {
    setLoadedPages(prev => {
      const next = new Set(prev);
      next.add(pageIndex);
      return next;
    });
  };

  const loadThumbnail = (src: string, imgEl: HTMLImageElement, pageIndex: number) => {
    const cached = thumbUrlCache.get(src);
    if (cached) {
      imgEl.src = cached;
      markPageLoaded(pageIndex);
      return;
    }

    const full = new Image();
    full.crossOrigin = 'anonymous';
    full.onload = () => {
      const scale = Math.min(1, THUMB_MAX_WIDTH / full.naturalWidth);
      const w = Math.round(full.naturalWidth * scale);
      const h = Math.round(full.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(full, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) {
            const thumbUrl = URL.createObjectURL(blob);
            thumbUrlCache.set(src, thumbUrl);
            imgEl.src = thumbUrl;
            markPageLoaded(pageIndex);
          }
        }, 'image/jpeg', 0.85);
      }
    };
    full.src = src;
  };

  const isPageActive = (pageIndex: number): boolean => {
    return activePageIndexSet().has(pageIndex);
  };

  const navigateToPage = (pageIndex: number) => {
    batch(() => {
      // The navigation callback synchronously updates activePageIndices. Do not
      // immediately re-centre the virtual list and move the clicked row away.
      skipNextActivePageSync = !isPageActive(pageIndex);
      props.onGoToPage(pageIndex);
    });
  };

  const textPreview = (page: PageImage): string => {
    const preview = page.previewText || page.text || page.title || page.name;
    return preview.replace(/\s+/gu, ' ').trim();
  };

  createEffect(() => {
    const allPages = props.pages();
    const activePageIndices = props.activePageIndices();
    const element = pageListRef();
    thumbnailRowSize();

    const firstActivePageIndex = activePageIndices[0];
    if (!element || allPages.length === 0 || firstActivePageIndex === undefined) {
      setVirtualScrollReady(false);
      return;
    }

    if (skipNextActivePageSync) {
      skipNextActivePageSync = false;
      setVirtualScrollReady(true);
      return;
    }

    virtualizer.scrollToIndex(firstActivePageIndex, { behavior: 'auto', align: 'center' });
    setVirtualScrollReady(true);
  });

  return (
      <aside class="reader-sidebar panel">
        <div class="page-list" ref={setPageListRef}>
          <div class="page-list-virtual" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            <For each={virtualScrollReady() ? virtualizer.getVirtualItems() : []}>
              {(item) => (
                <Show when={props.pages()[item.index]} keyed>
                  {(page) => (
                    <div
                      class="page-thumb-virtual-row"
                      style={{
                        height: `${item.size}px`,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      <div
                        class={`page-thumb ${isPageActive(page.index) ? 'active' : ''}`}
                        onClick={() => navigateToPage(page.index)}
                      >
                        <Show when={(page.kind ?? 'image') === 'image' && !loadedPages().has(page.index)}>
                          <div class="page-thumb-spinner">
                            <Spinner size={20} />
                          </div>
                        </Show>
                        <Show
                          when={(page.kind ?? 'image') === 'image' && page.src}
                          fallback={(
                            <div class="page-thumb-text">
                              <span>{textPreview(page)}</span>
                            </div>
                          )}
                        >
                          {(src) => (
                            <img
                              class={loadedPages().has(page.index) ? 'page-thumb-loaded' : 'page-thumb-loading'}
                              ref={(el) => loadThumbnail(src(), el, page.index)}
                              alt={page.name}
                            />
                          )}
                        </Show>
                        <Tag class="page-number">{page.index + 1}</Tag>
                        <Show when={props.hasOcrForPage(page.id)}>
                          <Indicator class="ocr-indicator" variant="primary" />
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
              )}
            </For>
          </div>
        </div>
      </aside>
  );
};

export default ReaderSidebar;
