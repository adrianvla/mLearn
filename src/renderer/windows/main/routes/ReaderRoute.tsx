/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { GlassButton } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { API_ENDPOINTS } from '../../../../shared/constants';
import './reader.css';

interface PageImage {
  id: string;
  src: string;
  name: string;
  index: number;
}

type FitMode = 'fit-height' | 'fit-width';
type PageMode = 'double' | 'single';

export const ReaderRoute: Component = () => {
  const navigate = useNavigate();

  const [pages, setPages] = createSignal<PageImage[]>([]);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [fitMode, setFitMode] = createSignal<FitMode>('fit-height');
  const [pageMode, setPageMode] = createSignal<PageMode>('double');
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [bookTitle, setBookTitle] = createSignal('Nothing Loaded');
  const [ocrStatus, setOcrStatus] = createSignal('Ready');
  const [isProcessingOcr, setIsProcessingOcr] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [ocrProgress, setOcrProgress] = createSignal(0);

  const visiblePages = () => {
    const p = pages();
    const curr = currentPage();
    
    if (pageMode() === 'single') {
      return p[curr] ? [p[curr]] : [];
    } else {
      const result: PageImage[] = [];
      if (p[curr]) result.push(p[curr]);
      if (p[curr + 1]) result.push(p[curr + 1]);
      return result;
    }
  };

  const progressString = () => {
    const total = pages().length;
    if (total === 0) return '0/0';
    return `${currentPage() + 1}/${total}`;
  };

  // Check for pending book on mount
  onMount(() => {
    const pendingBook = sessionStorage.getItem('mlearn_open_book');
    if (pendingBook) {
      sessionStorage.removeItem('mlearn_open_book');
      // TODO: Load book from path
    }
  });

  // Keyboard navigation
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
      if (e.key === 'Escape') navigate('/');
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files: File[] = [];
    const directFiles = Array.from(e.dataTransfer?.files || []);
    
    for (const file of directFiles) {
      if (file.type.startsWith('image/')) {
        files.push(file);
      }
    }

    if (files.length === 0) return;

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const newPages: PageImage[] = files.map((file, index) => ({
      id: `page-${index}-${file.name}`,
      src: URL.createObjectURL(file),
      name: file.name,
      index,
    }));

    setPages(newPages);
    setCurrentPage(0);
    setBookTitle(files[0].name.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Book');
    saveToRecent(files[0].name, 'book');
  };

  const saveToRecent = (name: string, type: 'video' | 'book') => {
    try {
      const stored = localStorage.getItem('mlearn_recent_items');
      const items = stored ? JSON.parse(stored) : [];
      const newItem = { type, name, path: '', progress: 0, lastWatched: Date.now() };
      const filtered = items.filter((i: any) => i.name !== name);
      const updated = [newItem, ...filtered].slice(0, 10);
      localStorage.setItem('mlearn_recent_items', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save recent:', e);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const goToPage = (index: number) => {
    const total = pages().length;
    if (total === 0) return;
    setCurrentPage(Math.max(0, Math.min(index, total - 1)));
  };

  const prevPage = () => goToPage(currentPage() - (pageMode() === 'double' ? 2 : 1));
  const nextPage = () => goToPage(currentPage() + (pageMode() === 'double' ? 2 : 1));

  const runOcr = async () => {
    const visible = visiblePages();
    if (visible.length === 0) return;

    setIsProcessingOcr(true);
    setOcrStatus('Processing...');
    setOcrProgress(0);

    try {
      const img = document.querySelector('.page-image') as HTMLImageElement;
      if (!img) {
        setOcrStatus('No image found');
        return;
      }

      setOcrProgress(30);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      
      setOcrProgress(50);
      const response = await fetch(API_ENDPOINTS.ocr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: canvas.toDataURL('image/png') }),
      });

      if (!response.ok) throw new Error('OCR request failed');

      setOcrProgress(80);
      const result = await response.json();
      setOcrProgress(100);
      setOcrStatus(`Found ${result.blocks?.length || 0} text regions`);
    } catch (error) {
      console.error('OCR error:', error);
      setOcrStatus('OCR failed');
    } finally {
      setIsProcessingOcr(false);
      setOcrProgress(0);
    }
  };

  const goHome = () => navigate('/');

  return (
    <div
      class="reader-route"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <WindowDragRegion />

      {/* Navigation Bar */}
      <nav class="reader-nav glass">
        <div class="nav-group">
          <button class="nav-btn" onClick={goHome} title="Back to Home">
            ← Home
          </button>
          <button class="nav-btn sidebar-btn" onClick={() => setShowSidebar(!showSidebar())}>
            📑
          </button>
          <span class="book-title-nav">{bookTitle()}</span>
        </div>
        
        <div class="nav-group">
          <span class="progress">{progressString()}</span>
        </div>
        
        <div class="nav-group">
          <select
            class="glass-select"
            value={fitMode()}
            onChange={(e) => setFitMode(e.currentTarget.value as FitMode)}
          >
            <option value="fit-height">Fit Height ↕</option>
            <option value="fit-width">Fit Width ↔</option>
          </select>
          
          <select
            class="glass-select"
            value={pageMode()}
            onChange={(e) => setPageMode(e.currentTarget.value as PageMode)}
          >
            <option value="double">Double Page</option>
            <option value="single">Single Page</option>
          </select>
        </div>
        
        <div class="nav-group nav-arrows">
          <button class="nav-btn" onClick={prevPage}>◀</button>
          <button class="nav-btn" onClick={nextPage}>▶</button>
        </div>
      </nav>

      {/* Sidebar */}
      <Show when={showSidebar()}>
        <aside class="reader-sidebar glass">
          <h2>Pages</h2>
          <div class="page-thumbnails">
            <For each={pages()}>
              {(page) => (
                <div
                  class={`thumbnail ${currentPage() === page.index ? 'active' : ''}`}
                  onClick={() => goToPage(page.index)}
                >
                  <img src={page.src} alt={page.name} />
                  <span>{page.index + 1}</span>
                </div>
              )}
            </For>
          </div>
        </aside>
      </Show>

      {/* Main Content */}
      <main class={`reader-main ${showSidebar() ? 'with-sidebar' : ''} ${fitMode()}`}>
        <Show
          when={pages().length > 0}
          fallback={
            <div class={`welcome-card ${isDragging() ? 'dragging' : ''}`}>
              <div class="welcome-content">
                <h2>📖 Settle in, Reader</h2>
                <p class="welcome-intro">
                  Drag and drop a folder of images or a .pdf file anywhere in this window.
                </p>
                <div class="dropzone">
                  Drop files here to import them instantly
                </div>
                <div class="tips-grid">
                  <div class="tip">
                    <h3>📐 Shape your view</h3>
                    <p>Switch between single and double page layouts.</p>
                  </div>
                  <div class="tip">
                    <h3>🔮 OCR magic</h3>
                    <p>Trigger OCR to hover words and build flashcards.</p>
                  </div>
                  <div class="tip">
                    <h3>🔖 Progress tracking</h3>
                    <p>We track your page progress automatically.</p>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <div class={`page-container ${pageMode()}`}>
            <For each={visiblePages()}>
              {(page) => (
                <div class="page">
                  <img class="page-image" src={page.src} alt={page.name} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </main>

      {/* Status Bar */}
      <footer class="reader-status glass">
        <span class="book-title">{bookTitle()}</span>
        <span class="progress">{progressString()}</span>
        <div class="ocr-section">
          <Show when={isProcessingOcr()}>
            <div class="ocr-progress">
              <div class="bar" style={{ width: `${ocrProgress()}%` }} />
            </div>
          </Show>
          <span class="ocr-status">{ocrStatus()}</span>
          <GlassButton
            size="sm"
            onClick={runOcr}
            disabled={isProcessingOcr() || pages().length === 0}
          >
            Run OCR
          </GlassButton>
        </div>
      </footer>
    </div>
  );
};
