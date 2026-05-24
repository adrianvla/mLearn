import type { ParsedSubtitle } from './subtitleParser.js';
import { findCurrentSubtitle } from './subtitleParser.js';

const SUBTITLE_CONTAINER_ID = 'mlearn-headless-subtitles';
const SUBTITLE_STYLE_ID = 'mlearn-headless-subtitle-styles';

let subtitleContainer: HTMLDivElement | null = null;
let currentSubtitles: ParsedSubtitle[] = [];
let currentOffset = 0;
let lastText: string | null = null;
let isEnabled = false;
let currentFontSize = 22;

function buildStyles(fontSize: number): string {
  return `
  #${SUBTITLE_CONTAINER_ID} {
    position: fixed;
    bottom: 56px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    z-index: 999999;
    font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: ${fontSize}px;
    font-weight: 600;
    line-height: 1.5;
    color: #ffffff;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
    text-align: center;
    padding: 0 24px;
    box-sizing: border-box;
    transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #${SUBTITLE_CONTAINER_ID}.hidden {
    opacity: 0;
    transform: translateY(6px);
  }
  #${SUBTITLE_CONTAINER_ID} .subtitle-line {
    display: inline-block;
    padding: 6px 16px;
    max-width: 90%;
    word-wrap: break-word;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
}

function injectStyles(): void {
  const existing = document.getElementById(SUBTITLE_STYLE_ID) as HTMLStyleElement | null;
  if (existing) {
    existing.textContent = buildStyles(currentFontSize);
    return;
  }
  const style = document.createElement('style');
  style.id = SUBTITLE_STYLE_ID;
  style.textContent = buildStyles(currentFontSize);
  document.head.appendChild(style);
}

function removeStyles(): void {
  const style = document.getElementById(SUBTITLE_STYLE_ID);
  if (style) {
    style.remove();
  }
}

function getAllVideos(root: Document | ShadowRoot = document): HTMLVideoElement[] {
  const found: HTMLVideoElement[] = [];
  try {
    const videos = root.querySelectorAll('video');
    for (const video of Array.from(videos)) {
      found.push(video);
    }
  } catch {
    // Some shadow roots may not support querySelector
  }

  const allElements = root.querySelectorAll('*');
  for (const el of Array.from(allElements)) {
    if (el.shadowRoot) {
      found.push(...getAllVideos(el.shadowRoot));
    }
  }

  return found;
}

export function getBestVideo(): HTMLVideoElement | null {
  const videos = getAllVideos(document);
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea && rect.width > 0 && rect.height > 0) {
      bestArea = area;
      best = video;
    }
  }

  return best;
}

function createSubtitleContainer(): HTMLDivElement {
  removeContainer();
  injectStyles();

  const container = document.createElement('div');
  container.id = SUBTITLE_CONTAINER_ID;
  container.classList.add('hidden');

  const line = document.createElement('span');
  line.className = 'subtitle-line';
  container.appendChild(line);

  document.body.appendChild(container);
  return container;
}

function handleResize(): void {
  if (!isEnabled) return;
  const video = getBestVideo();
  if (video && subtitleContainer) {
    positionSubtitleOverVideo(video);
  }
}

function handleScroll(): void {
  if (!isEnabled) return;
  const video = getBestVideo();
  if (video && subtitleContainer) {
    positionSubtitleOverVideo(video);
  }
}

export function positionSubtitleOverVideo(video: HTMLVideoElement): void {
  if (!subtitleContainer) return;

  const rect = video.getBoundingClientRect();
  subtitleContainer.style.top = `${rect.top + rect.height - 96}px`;
  subtitleContainer.style.left = `${rect.left}px`;
  subtitleContainer.style.width = `${rect.width}px`;
  subtitleContainer.style.height = 'auto';
  subtitleContainer.style.right = 'auto';
  subtitleContainer.style.bottom = 'auto';
}

export function updateSubtitleText(text: string | null): void {
  if (!subtitleContainer) return;
  const line = subtitleContainer.querySelector('.subtitle-line');
  if (!line) return;

  if (text) {
    line.textContent = text;
    subtitleContainer.classList.remove('hidden');
  } else {
    subtitleContainer.classList.add('hidden');
  }
}

export function enableSubtitleInjection(): void {
  if (isEnabled) return;
  isEnabled = true;

  if (!subtitleContainer) {
    subtitleContainer = createSubtitleContainer();
  }

  const video = getBestVideo();
  if (video) {
    positionSubtitleOverVideo(video);
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('scroll', handleScroll, true);
}

export function disableSubtitleInjection(): void {
  if (!isEnabled) return;
  isEnabled = false;

  removeContainer();
  removeStyles();

  window.removeEventListener('resize', handleResize);
  window.removeEventListener('scroll', handleScroll, true);
}

export function removeContainer(): void {
  const existing = document.getElementById(SUBTITLE_CONTAINER_ID);
  if (existing) {
    existing.remove();
  }
  subtitleContainer = null;
}

export function loadSubtitles(subtitles: ParsedSubtitle[]): void {
  currentSubtitles = subtitles;
}

export function setSubtitleOffset(offset: number): void {
  currentOffset = offset;
}

export function updateSubtitleForTime(currentTime: number): void {
  if (!isEnabled || currentSubtitles.length === 0) return;

  const subtitle = findCurrentSubtitle(currentSubtitles, currentTime, currentOffset);
  const text = subtitle?.text || null;

  if (text === lastText) return;
  lastText = text;

  updateSubtitleText(text);

  const video = getBestVideo();
  if (video && subtitleContainer) {
    positionSubtitleOverVideo(video);
  }
}

export function isSubtitleInjectionEnabled(): boolean {
  return isEnabled;
}

export function adjustFontSize(delta: number): number {
  currentFontSize = Math.max(10, Math.min(60, currentFontSize + delta));
  injectStyles();
  return currentFontSize;
}

export function getFontSize(): number {
  return currentFontSize;
}
