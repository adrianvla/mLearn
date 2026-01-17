/**
 * Reader Window
 * Manga/Image OCR reader with text extraction and translation
 * Ported from reader module in the original mLearn app
 */

import { Component, createSignal, For, Show, onMount, createEffect, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings } from '../../context';
import { GlassButton } from '../../components/common';
import { API_ENDPOINTS } from '../../../shared/constants';
import './reader.css';
import ReaderWelcomeCard from "../main/routes/components/ReaderWelcomeCard";

// Storage key for reader positions
const READER_POSITIONS_KEY = 'mlearn_reader_positions';

interface PageImage {
  id: string;
  src: string;
  name: string;
  index: number;
}

type FitMode = 'fit-height' | 'fit-width';
type PageMode = 'double' | 'single';

// Helper to get/set page positions from storage
function getReaderPositions(): Record<string, number> {
  try {
    const stored = localStorage.getItem(READER_POSITIONS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveReaderPosition(bookKey: string, page: number): void {
  try {
    const positions = getReaderPositions();
    positions[bookKey] = page;
    localStorage.setItem(READER_POSITIONS_KEY, JSON.stringify(positions));
  } catch (e) {
    console.error('Failed to save reader position:', e);
  }
}

function getReaderPosition(bookKey: string): number {
  const positions = getReaderPositions();
  return positions[bookKey] ?? 0;
}

const ReaderContent: Component = () => {
  const { settings } = useSettings();

  const [pages, setPages] = createSignal<PageImage[]>([]);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [fitMode, setFitMode] = createSignal<FitMode>('fit-height');
  const [pageMode, setPageMode] = createSignal<PageMode>('double');
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [bookTitle, setBookTitle] = createSignal('Nothing Loaded');
  const [bookKey, setBookKey] = createSignal<string>(''); // Key for position storage
  const [ocrStatus, setOcrStatus] = createSignal('Ready');
  const [isProcessingOcr, setIsProcessingOcr] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [ocrProgress, setOcrProgress] = createSignal(0);

  // Save position when page changes (with debounce)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const key = bookKey();
    const page = currentPage();
    if (!key) return;
    
    // Debounce saves
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveReaderPosition(key, page);
    }, 500);
  });
  
  onCleanup(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
  });

  // Get visible pages based on current page and mode
  const visiblePages = () => {
    const p = pages();
    const curr = currentPage();
    
    if (pageMode() === 'single') {
      return p[curr] ? [p[curr]] : [];
    } else {
      // Double page mode - show current and next
      const result: PageImage[] = [];
      if (p[curr]) result.push(p[curr]);
      if (p[curr + 1]) result.push(p[curr + 1]);
      return result;
    }
  };

  // Progress string
  const progressString = () => {
    const total = pages().length;
    if (total === 0) return '0/0';
    const curr = currentPage() + 1;
    return `${curr}/${total}`;
  };

  // Handle file drop
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer?.items || []);
    const files: File[] = [];

    // Handle directory or files
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          // Check if it's an image
          if (file.type.startsWith('image/')) {
            files.push(file);
          }
          // TODO: Handle PDF files
        }
      }
    }

    // Also check files directly
    const directFiles = Array.from(e.dataTransfer?.files || []);
    for (const file of directFiles) {
      if (file.type.startsWith('image/') && !files.some(f => f.name === file.name)) {
        files.push(file);
      }
    }

    if (files.length === 0) return;

    // Sort files by name
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    // Create page objects
    const newPages: PageImage[] = files.map((file, index) => ({
      id: `page-${index}-${file.name}`,
      src: URL.createObjectURL(file),
      name: file.name,
      index,
    }));

    // Generate a key based on first file name for position tracking
    const title = files[0].name.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Book';
    const key = `reader_${title}_${files.length}`;
    
    setPages(newPages);
    setBookTitle(title);
    setBookKey(key);
    
    // Restore saved position for this document
    const savedPage = getReaderPosition(key);
    const validPage = Math.min(savedPage, newPages.length - 1);
    setCurrentPage(validPage >= 0 ? validPage : 0);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Navigation
  const goToPage = (index: number) => {
    const total = pages().length;
    if (total === 0) return;
    
    let newPage = index;
    
    if (newPage < 0) newPage = 0;
    if (newPage >= total) newPage = total - 1;
    
    setCurrentPage(newPage);
  };

  const prevPage = () => {
    const step = pageMode() === 'double' ? 2 : 1;
    goToPage(currentPage() - step);
  };

  const nextPage = () => {
    const step = pageMode() === 'double' ? 2 : 1;
    goToPage(currentPage() + step);
  };

  // Handle keyboard navigation
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // Run OCR on current page
  const runOcr = async () => {
    const visible = visiblePages();
    if (visible.length === 0 || !settings.ocrEnabled) return;

    setIsProcessingOcr(true);
    setOcrStatus('Processing...');
    setOcrProgress(0);

    try {
      // Get the first visible page image
      const img = document.querySelector('.page-image') as HTMLImageElement;
      if (!img) {
        setOcrStatus('No image found');
        return;
      }

      setOcrProgress(30);

      // Create canvas and get image data
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      setOcrProgress(50);

      // Send to OCR endpoint
      const response = await fetch(API_ENDPOINTS.ocr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });

      if (!response.ok) {
        throw new Error('OCR request failed');
      }

      setOcrProgress(80);

      const result = await response.json();
      setOcrProgress(100);
      setOcrStatus(`Found ${result.blocks?.length || 0} text regions`);
      
      // TODO: Display OCR results as hoverable text overlays
    } catch (error) {
      console.error('OCR error:', error);
      setOcrStatus('OCR failed');
    } finally {
      setIsProcessingOcr(false);
      setOcrProgress(0);
    }
  };

  return (
    <div
      class="reader-window"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Navigation Bar */}
      <nav class="reader-nav glass">
        <div class="nav-group">
          <button
            class="nav-btn sidebar-btn"
            onClick={() => setShowSidebar(!showSidebar())}
          >
            📑
          </button>
          <h1 class="nav-title">mLearn Reader</h1>
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
            <ReaderWelcomeCard isDragging={isDragging}/>
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

// Main App with providers
export const ReaderApp: Component = () => {
  return (
    <WindowWrapper>
      <ReaderContent />
    </WindowWrapper>
  );
};

export default ReaderApp;
