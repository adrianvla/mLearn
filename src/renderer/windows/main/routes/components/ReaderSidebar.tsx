/**
 * Reader Sidebar Component
 * Page thumbnails sidebar
 */

import { Component, For, Show, Accessor } from 'solid-js';

interface PageImage {
  id: string;
  src: string;
  name: string;
  index: number;
}

interface ReaderSidebarProps {
  pages: Accessor<PageImage[]>;
  currentPage: Accessor<number>;
  hasOcrForPage: (pageId: string) => boolean;
  onGoToPage: (index: number) => void;
}

export const ReaderSidebar: Component<ReaderSidebarProps> = (props) => {
  return (
    <aside class="reader-sidebar glass">
      <h2>Pages</h2>
      <div class="page-thumbnails">
        <For each={props.pages()}>
          {(page) => (
            <div
              class={`thumbnail ${props.currentPage() === page.index ? 'active' : ''} ${props.hasOcrForPage(page.id) ? 'has-ocr' : ''}`}
              onClick={() => props.onGoToPage(page.index)}
            >
              <img src={page.src} alt={page.name} />
              <span>{page.index + 1}</span>
              <Show when={props.hasOcrForPage(page.id)}>
                <span class="ocr-badge">OCR</span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
};

export default ReaderSidebar;
