/**
 * Reader Sidebar Component
 * Page thumbnails sidebar
 */

import {Component, For, Accessor, Show} from 'solid-js';
import { Tag, Indicator } from '../../../../components/common';
import './ReaderSidebar.css';

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
      <div class="page-list">
        <For each={props.pages()}>
          {(page) => (
            <div
              class={`page-thumb ${props.currentPage() === page.index ? 'active' : ''}`}
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
