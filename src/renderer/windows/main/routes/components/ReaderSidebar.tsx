/**
 * Reader Sidebar Component
 * Page thumbnails sidebar
 */

import { Component, For, Accessor, Show, createEffect, createSignal, onCleanup, createMemo } from 'solid-js';
import { Tag, Indicator, Spinner } from '../../../../components/common';
import { useLocalization } from '../../../../context';
import './ReaderSidebar.css';

/** Maximum thumbnail width in pixels — keeps images crisp at sidebar size without aliasing */
const THUMB_MAX_WIDTH = 200;

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
  const { t } = useLocalization();
  const thumbRefs = new Map<number, HTMLDivElement>();
  const thumbUrlCache = new Map<string, string>();
  const [loadedPages, setLoadedPages] = createSignal<Set<number>>(new Set());
  const activePageIndexSet = createMemo(() => new Set(props.activePageIndices()));
  let sidebarRef: HTMLElement | undefined;

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

  const textPreview = (page: PageImage): string => {
    const preview = page.previewText || page.text || page.title || page.name;
    return preview.replace(/\s+/gu, ' ').trim();
  };

  const scrollToActivePages = (smooth: boolean = true) => {
    const activePageIndices = props.activePageIndices();
    const [firstActivePageIndex, secondActivePageIndex] = activePageIndices;
    const firstThumb = firstActivePageIndex === undefined ? undefined : thumbRefs.get(firstActivePageIndex);

    if (!firstThumb || !sidebarRef) return;

    const behavior = smooth ? 'smooth' : 'instant';

    if (secondActivePageIndex === undefined) {
      firstThumb.scrollIntoView({ behavior, block: 'center' });
      return;
    }

    const secondThumb = thumbRefs.get(secondActivePageIndex);
    if (secondThumb) {
      const firstRect = firstThumb.getBoundingClientRect();
      const secondRect = secondThumb.getBoundingClientRect();
      const containerRect = sidebarRef.getBoundingClientRect();
      const midpoint = (firstRect.top + secondRect.bottom) / 2 - containerRect.top + sidebarRef.scrollTop;
      const targetScroll = midpoint - sidebarRef.clientHeight / 2;
      sidebarRef.scrollTo({ top: targetScroll, behavior });
      return;
    }

    firstThumb.scrollIntoView({ behavior, block: 'center' });
  };

  createEffect(() => {
    const allPages = props.pages();
    const activePageIndices = props.activePageIndices();

    if (allPages.length === 0 || activePageIndices.length === 0) return;

    requestAnimationFrame(() => {
      const firstActivePageIndex = activePageIndices[0];

      if (firstActivePageIndex !== undefined && thumbRefs.has(firstActivePageIndex)) {
        scrollToActivePages(true);
      } else {
        requestAnimationFrame(() => {
          scrollToActivePages(true);
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
            )}
          </For>
        </div>
      </aside>
  );
};

export default ReaderSidebar;
