import type { ParsedSubtitle } from './subtitleParser.js';
import { findCurrentSubtitle } from './subtitleParser.js';

const SUBTITLE_CONTAINER_ID = 'mlearn-headless-subtitles';
const SUBTITLE_STYLE_ID = 'mlearn-headless-subtitle-styles';

let subtitleContainer: HTMLDivElement | null = null;
let currentSubtitles: ParsedSubtitle[] = [];
let currentOffset = 0;
let lastText: string | null = null;
let isEnabled = false;

const defaultStyles = `
  #${SUBTITLE_CONTAINER_ID} {
    position: absolute;
    bottom: 48px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    z-index: 999999;
    font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.5;
    color: #ffffff;
    text-shadow: 0 0 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 0, 0, 0.5);
    text-align: center;
    padding: 0 20px;
    box-sizing: border-box;
    transition: opacity 0.15s ease;
  }
  #${SUBTITLE_CONTAINER_ID}.hidden {
    opacity: 0;
  }
  #${SUBTITLE_CONTAINER_ID} .subtitle-line {
    display: inline-block;
    background: rgba(0, 0, 0, 0.6);
    padding: 4px 12px;
    border-radius: 4px;
    max-width: 90%;
    word-wrap: break-word;
  }
`;

function injectStyles(): void {
  if (document.getElementById(SUBTITLE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SUBTITLE_STYLE_ID;
  style.textContent = defaultStyles;
  document.head.appendChild(style);
}

function removeStyles(): void {
  const style = document.getElementById(SUBTITLE_STYLE_ID);
  if (style) {
    style.remove();
  }
}

function getBestVideo(): HTMLVideoElement | null {
  const videos = document.querySelectorAll('video');
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;

  for (const video of Array.from(videos)) {
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

function positionOverVideo(video: HTMLVideoElement): void {
  if (!subtitleContainer) return;

  const rect = video.getBoundingClientRect();
  subtitleContainer.style.top = `${rect.top + rect.height - 96}px`;
  subtitleContainer.style.left = `${rect.left}px`;
  subtitleContainer.style.width = `${rect.width}px`;
  subtitleContainer.style.height = 'auto';
}

function updateSubtitleText(text: string | null): void {
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
    positionOverVideo(video);
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
    positionOverVideo(video);
  }
}

export function isSubtitleInjectionEnabled(): boolean {
  return isEnabled;
}

function handleResize(): void {
  if (!isEnabled) return;
  const video = getBestVideo();
  if (video && subtitleContainer) {
    positionOverVideo(video);
  }
}

function handleScroll(): void {
  if (!isEnabled) return;
  const video = getBestVideo();
  if (video && subtitleContainer) {
    positionOverVideo(video);
  }
}