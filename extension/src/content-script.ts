import type {
  VideoState,
  VideoStateMessage,
  GeometryUpdateMessage,
  VideoViewportGeometry,
  ExtensionCommandMessage,
  HeadlessStateMessage,
  HeadlessCommandMessage,
  TextModeWordLookupMessage,
  TextModeCloseHoverMessage,
  VideoScreenshotMessage,
  ParsedSubtitle,
} from './types.js';
import { parseSubtitles } from './headless/subtitleParser.js';
import {
  enableSubtitleInjection,
  disableSubtitleInjection,
  loadSubtitles,
  setSubtitleOffset,
  updateSubtitleForTime,
  updateSubtitleText,
  positionSubtitleOverVideo,
  adjustFontSize,
} from './headless/subtitleInjector.js';
import { getSitePlatform } from './platforms/index.js';
import type { PlatformSubtitleResult } from './platforms/types.js';

interface ChromeRuntime {
  sendMessage: (message: unknown, responseCallback?: (response: unknown) => void) => void;
  onMessage?: {
    addListener: (callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void) => void;
    removeListener: (callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void) => void;
  };
}

declare const chrome: {
  runtime?: ChromeRuntime;
} | undefined;

interface TrackedVideo {
  element: HTMLVideoElement;
  lastSentTime: number;
  lastSrc: string;
  isWaiting: boolean;
}

const TIMEUPDATE_THROTTLE_MS = 250;

let trackedVideo: TrackedVideo | null = null;
let mutationObserver: MutationObserver | null = null;
let videoAttrObserver: MutationObserver | null = null;
let isDestroyed = false;
let geometryInterval: ReturnType<typeof setInterval> | null = null;
let lastGeometry: VideoViewportGeometry | null = null;
let lastVolume = -1;

let headlessModeEnabled = false;
let headlessSubtitles: ParsedSubtitle[] = [];
let urlObserver: MutationObserver | null = null;
let platformCleanup: (() => void) | null = null;

function getChromeRuntime(): ChromeRuntime | undefined {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
    return chrome.runtime;
  }
  return undefined;
}

function captureVideoScreenshot(): string {
  if (!trackedVideo?.element || trackedVideo.element.readyState < 2) {
    return '';
  }

  const video = trackedVideo.element;
  const canvas = document.createElement('canvas');
  const maxWidth = 480;
  let width = video.videoWidth;
  let height = video.videoHeight;

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  ctx.drawImage(video, 0, 0, width, height);

  try {
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}

function sendVideoScreenshot(): void {
  const dataUrl = captureVideoScreenshot();
  if (!dataUrl) {
    return;
  }

  const runtime = getChromeRuntime();
  if (!runtime) {
    return;
  }

  const message: VideoScreenshotMessage = {
    type: 'VIDEO_SCREENSHOT',
    dataUrl,
    timestamp: Date.now(),
  };

  try {
    runtime.sendMessage(message);
  } catch {
    // chrome.runtime may become unavailable during navigation
  }
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function getVideoArea(el: HTMLVideoElement): number {
  if (!isVisible(el)) return 0;
  const rect = el.getBoundingClientRect();
  return rect.width * rect.height;
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

  // Traverse shadow roots
  const allElements = root.querySelectorAll('*');
  for (const el of Array.from(allElements)) {
    if (el.shadowRoot) {
      found.push(...getAllVideos(el.shadowRoot));
    }
  }

  return found;
}

function extractVideoState(video: HTMLVideoElement): VideoState {
  return {
    currentTime: video.currentTime,
    duration: video.duration,
    isPlaying: !video.paused && !video.ended,
    playbackRate: video.playbackRate,
    volume: video.volume,
    muted: video.muted,
    src: video.currentSrc || video.src || window.location.href,
    isWaiting: trackedVideo?.isWaiting ?? false,
    isFullscreen: !!document.fullscreenElement && document.fullscreenElement.contains(video),
  };
}

function sendVideoState(video: HTMLVideoElement): void {
  const runtime = getChromeRuntime();
  if (!runtime) return;

  const state = extractVideoState(video);
  const message: VideoStateMessage = {
    type: 'VIDEO_STATE',
    state,
    meta: {
      url: window.location.href,
      title: document.title,
    },
    timestamp: Date.now(),
  };

  try {
    runtime.sendMessage(message);
  } catch {
    // chrome.runtime may become unavailable during navigation
  }

  if (headlessModeEnabled) {
    updateSubtitleForTime(video.currentTime);
  }
}

function handleTimeUpdate(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;

  const now = Date.now();
  if (now - trackedVideo.lastSentTime < TIMEUPDATE_THROTTLE_MS) return;

  trackedVideo.lastSentTime = now;
  sendVideoState(this);
}

function handlePlay(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  trackedVideo.isWaiting = false;
  sendVideoState(this);
}

function handlePause(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  trackedVideo.isWaiting = false;
  sendVideoState(this);
  sendVideoScreenshot();
}

function handleSeeked(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  sendVideoState(this);
  sendVideoScreenshot();
}

function handleRateChange(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  sendVideoState(this);
}

function handleVolumeChange(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  const vol = this.volume;
  if (vol !== lastVolume) {
    lastVolume = vol;
    sendVideoState(this);
  }
}

function handleWaiting(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  trackedVideo.isWaiting = true;
  sendVideoState(this);
}

function handleCanPlay(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  if (trackedVideo.isWaiting) {
    trackedVideo.isWaiting = false;
    sendVideoState(this);
  }
}

function handleStalled(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  trackedVideo.isWaiting = true;
  sendVideoState(this);
}

function handleEnded(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  trackedVideo.isWaiting = false;
  sendVideoState(this);
}

function handleLoadedMetadata(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  if (trackedVideo) {
    trackedVideo.lastSrc = this.currentSrc || this.src || window.location.href;
  }
  sendVideoState(this);
  startPlatformExtraction(this);
}

function handleEmptied(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
    if (this.currentSrc !== trackedVideo.lastSrc) {
      trackedVideo.lastSrc = this.currentSrc || this.src || window.location.href;
      sendVideoState(this);
      startPlatformExtraction(this);
    }
}

function handleResize(): void {
  if (isDestroyed || !trackedVideo) return;
  sendGeometryUpdate(getVideoGeometry(trackedVideo.element));
}

function attachToVideo(video: HTMLVideoElement): void {
  if (trackedVideo?.element === video) return;

  detachFromVideo();

  trackedVideo = {
    element: video,
    lastSentTime: 0,
    lastSrc: video.currentSrc || video.src || window.location.href,
    isWaiting: false,
  };
  lastVolume = video.volume;

  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeeked);
  video.addEventListener('ratechange', handleRateChange);
  video.addEventListener('volumechange', handleVolumeChange);
  video.addEventListener('waiting', handleWaiting);
  video.addEventListener('canplay', handleCanPlay);
  video.addEventListener('stalled', handleStalled);
  video.addEventListener('ended', handleEnded);
  video.addEventListener('loadedmetadata', handleLoadedMetadata);
  video.addEventListener('emptied', handleEmptied);

  window.addEventListener('resize', handleResize);

  // Watch for src attribute changes
  videoAttrObserver = new MutationObserver(() => {
    if (isDestroyed || !trackedVideo) return;
    const newSrc = trackedVideo.element.currentSrc || trackedVideo.element.src;
    if (newSrc !== trackedVideo.lastSrc) {
      trackedVideo.lastSrc = newSrc;
      sendVideoState(trackedVideo.element);
      startPlatformExtraction(trackedVideo.element);
    }
  });
  videoAttrObserver.observe(video, { attributes: true, attributeFilter: ['src'] });

  sendVideoState(video);
  startGeometryPolling();
  startPlatformExtraction(video);

  if (headlessModeEnabled) {
    enableSubtitleInjection();
  }
}

function getIframeOffset(): { x: number; y: number } {
  if (window.self === window.top) return { x: 0, y: 0 };
  try {
    const frameEl = window.frameElement;
    if (frameEl) {
      const frameRect = frameEl.getBoundingClientRect();
      return { x: frameRect.x, y: frameRect.y };
    }
  } catch {
  }
  return { x: 0, y: 0 };
}

function getVideoGeometry(video: HTMLVideoElement): VideoViewportGeometry {
  const rect = video.getBoundingClientRect();
  const iframeOffset = getIframeOffset();
  return {
    rectX: rect.x + iframeOffset.x,
    rectY: rect.y + iframeOffset.y,
    width: rect.width,
    height: rect.height,
    screenX: window.screenX,
    screenY: window.screenY,
    isFullscreen: !!document.fullscreenElement && document.fullscreenElement.contains(video),
  };
}

function sendGeometryUpdate(geometry: VideoViewportGeometry): void {
  const runtime = getChromeRuntime();
  if (!runtime) return;

  // Skip geometry updates from background/hidden tabs to prevent overlay
  // from bouncing between multiple videos across tabs.
  if (document.hidden) return;

  const message: GeometryUpdateMessage = {
    type: 'GEOMETRY_UPDATE',
    geometry,
    timestamp: Date.now(),
  };

  try {
    runtime.sendMessage(message);
  } catch {
    // chrome.runtime may become unavailable during navigation
  }
}

function startGeometryPolling(): void {
  if (geometryInterval) return;

  setTimeout(() => {
    if (isDestroyed || !trackedVideo) return;
    const geometry = getVideoGeometry(trackedVideo.element);
    lastGeometry = geometry;
    sendGeometryUpdate(geometry);
  }, 100);

  let heartbeatCounter = 0;
  geometryInterval = setInterval(() => {
    if (isDestroyed || !trackedVideo) return;

    const geometry = getVideoGeometry(trackedVideo.element);
    heartbeatCounter++;

    const changed =
      !lastGeometry ||
      lastGeometry.rectX !== geometry.rectX ||
      lastGeometry.rectY !== geometry.rectY ||
      lastGeometry.width !== geometry.width ||
      lastGeometry.height !== geometry.height ||
      lastGeometry.screenX !== geometry.screenX ||
      lastGeometry.screenY !== geometry.screenY ||
      lastGeometry.isFullscreen !== geometry.isFullscreen;

    if (changed || heartbeatCounter >= 10) {
      lastGeometry = geometry;
      sendGeometryUpdate(geometry);
      if (heartbeatCounter >= 10) heartbeatCounter = 0;
    }
  }, 100);
}

function stopGeometryPolling(): void {
  if (geometryInterval) {
    clearInterval(geometryInterval);
    geometryInterval = null;
  }
  lastGeometry = null;
}

function detachFromVideo(): void {
  if (!trackedVideo) return;

  const video = trackedVideo.element;
  video.removeEventListener('timeupdate', handleTimeUpdate);
  video.removeEventListener('play', handlePlay);
  video.removeEventListener('pause', handlePause);
  video.removeEventListener('seeked', handleSeeked);
  video.removeEventListener('ratechange', handleRateChange);
  video.removeEventListener('volumechange', handleVolumeChange);
  video.removeEventListener('waiting', handleWaiting);
  video.removeEventListener('canplay', handleCanPlay);
  video.removeEventListener('stalled', handleStalled);
  video.removeEventListener('ended', handleEnded);
  video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  video.removeEventListener('emptied', handleEmptied);

  window.removeEventListener('resize', handleResize);

  if (videoAttrObserver) {
    videoAttrObserver.disconnect();
    videoAttrObserver = null;
  }

  if (platformCleanup) {
    platformCleanup();
    platformCleanup = null;
  }

  trackedVideo = null;
  lastVolume = -1;
  stopGeometryPolling();
}

function findVideoInNode(node: Node): HTMLVideoElement | null {
  if (node instanceof HTMLVideoElement) {
    return node;
  }
  if (node instanceof Element) {
    // Check shadow root
    if (node.shadowRoot) {
      const shadowVideo = getBestVideoFromRoot(node.shadowRoot);
      if (shadowVideo) return shadowVideo;
    }
    const video = node.querySelector('video');
    if (video) return video;
  }
  return null;
}

function getBestVideoFromRoot(root: Document | ShadowRoot): HTMLVideoElement | null {
  const videos = getAllVideos(root);
  if (videos.length === 0) return null;

  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const video of videos) {
    const area = getVideoArea(video);
    if (area > bestArea) {
      bestArea = area;
      best = video;
    }
  }
  return best;
}

function scanForVideo(): HTMLVideoElement | null {
  return getBestVideoFromRoot(document);
}

function shouldSwitchToNewVideo(newVideo: HTMLVideoElement): boolean {
  if (!trackedVideo) return true;
  const currentArea = getVideoArea(trackedVideo.element);
  const newArea = getVideoArea(newVideo);
  // Switch if new video is significantly larger or current is no longer visible
  return newArea > currentArea * 1.25 || currentArea === 0;
}

function handleMutations(mutations: MutationRecord[]): void {
  if (isDestroyed) return;

  let videoRemoved = false;

  for (const mutation of mutations) {
    for (const removedNode of Array.from(mutation.removedNodes)) {
      if (
        trackedVideo &&
        (removedNode === trackedVideo.element ||
          (removedNode instanceof Element && removedNode.contains(trackedVideo.element)))
      ) {
        videoRemoved = true;
        break;
      }
    }
    if (videoRemoved) break;
  }

  if (videoRemoved) {
    detachFromVideo();
  }

  if (!trackedVideo) {
    const video = scanForVideo();
    if (video) {
      attachToVideo(video);
    }
    return;
  }

  // Check if a significantly better video appeared
  for (const mutation of mutations) {
    for (const addedNode of Array.from(mutation.addedNodes)) {
      const video = findVideoInNode(addedNode);
      if (video && video !== trackedVideo.element) {
        if (shouldSwitchToNewVideo(video)) {
          attachToVideo(video);
          return;
        }
      }
    }
  }
}

function setupMutationObserver(): void {
  if (mutationObserver) return;

  mutationObserver = new MutationObserver(handleMutations);
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function teardownMutationObserver(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

function handlePlatformSubtitles(result: PlatformSubtitleResult, video: HTMLVideoElement): void {
  console.log('[mLearn:content] handlePlatformSubtitles: tracks=', result.tracks.length, 'textTracks=', result.textTracks.length);
  const runtime = getChromeRuntime();
  if (!runtime) return;

  if (result.tracks.length > 0 || result.textTracks.length > 0) {
    try {
      runtime.sendMessage({
        type: 'SUBTITLE_TRACKS',
        tracks: result.tracks,
        textTracks: result.textTracks,
        url: window.location.href,
        timestamp: Date.now(),
      });
      console.log('[mLearn:content] Sent SUBTITLE_TRACKS');
    } catch {
      // Ignore
    }
  }

  if (headlessModeEnabled && result.textTracks.length > 0) {
    const firstTrack = result.textTracks[0];
    try {
      headlessSubtitles = parseSubtitles(firstTrack.text);
      loadSubtitles(headlessSubtitles);
      updateSubtitleForTime(video.currentTime);
    } catch (e) {
      console.error('[mLearn:content] Failed to parse headless subtitles:', e);
    }
  }
}

function startPlatformExtraction(video: HTMLVideoElement): void {
  console.log('[mLearn:content] startPlatformExtraction');
  if (platformCleanup) {
    platformCleanup();
    platformCleanup = null;
  }

  const platform = getSitePlatform(window.location.href);
  console.log('[mLearn:content] Using platform:', platform.name);
  platformCleanup = platform.startMonitoring(video, (result) => {
    handlePlatformSubtitles(result, video);
  });

  if (platform.extractOnce) {
    const result = platform.extractOnce(video);
    if (result) {
      handlePlatformSubtitles(result, video);
    }
  }
}

// Listen for commands from the background script (bidirectional sync)
function handleCommandMessage(
  message: unknown,
  _sender: unknown,
  sendResponse?: (response?: unknown) => void,
): boolean | void {
  if (!trackedVideo || isDestroyed) return;

  const cmd = message as ExtensionCommandMessage;
  if (cmd.type !== 'EXTENSION_COMMAND') return;

  const video = trackedVideo.element;

  switch (cmd.command) {
    case 'play':
      video.play().catch(() => {});
      break;
    case 'pause':
      video.pause();
      break;
    case 'seek':
      if (typeof cmd.time === 'number' && isFinite(cmd.time)) {
        video.currentTime = Math.max(0, Math.min(cmd.time, video.duration || Infinity));
      }
      break;
    case 'setRate':
      if (typeof cmd.rate === 'number' && isFinite(cmd.rate)) {
        video.playbackRate = cmd.rate;
      }
      break;
    case 'setVolume':
      if (typeof cmd.volume === 'number' && isFinite(cmd.volume)) {
        video.volume = Math.max(0, Math.min(1, cmd.volume));
      }
      break;
    case 'captureScreenshot':
      sendVideoScreenshot();
      if (sendResponse) {
        sendResponse({ success: true });
      }
      return true;
  }
}

function setupCommandListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.addListener(handleCommandMessage);
}

function removeCommandListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.removeListener(handleCommandMessage);
}

// Headless mode handlers
function handleHeadlessStateChanged(enabled: boolean): void {
  headlessModeEnabled = enabled;
  if (enabled) {
    enableSubtitleInjection();
    if (trackedVideo) {
      updateSubtitleForTime(trackedVideo.element.currentTime);
    }
  } else {
    disableSubtitleInjection();
    headlessSubtitles = [];
  }
}

function handleHeadlessSubtitleLoad(content: string, format?: 'srt' | 'vtt' | 'ass'): void {
  try {
    headlessSubtitles = parseSubtitles(content, format);
    loadSubtitles(headlessSubtitles);
    if (trackedVideo) {
      updateSubtitleForTime(trackedVideo.element.currentTime);
    }
  } catch {
  }
}

function handleHeadlessSubtitleOffset(offset: number): void {
  setSubtitleOffset(offset);
  if (trackedVideo) {
    updateSubtitleForTime(trackedVideo.element.currentTime);
  }
}

function handleHeadlessCommand(cmd: HeadlessCommandMessage): void {
  if (!trackedVideo || isDestroyed) return;

  const video = trackedVideo.element;

  switch (cmd.command) {
    case 'play':
      video.play().catch(() => {});
      break;
    case 'pause':
      video.pause();
      break;
    case 'seek':
      if (typeof cmd.time === 'number' && isFinite(cmd.time)) {
        video.currentTime = Math.max(0, Math.min(cmd.time, video.duration || Infinity));
      }
      break;
    case 'setRate':
      if (typeof cmd.rate === 'number' && isFinite(cmd.rate)) {
        video.playbackRate = cmd.rate;
      }
      break;
    case 'setVolume':
      if (typeof cmd.volume === 'number' && isFinite(cmd.volume)) {
        video.volume = Math.max(0, Math.min(1, cmd.volume));
      }
      break;
  }
}

function handleHeadlessMessage(message: unknown): void {
  const msg = message as { type: string };

  switch (msg.type) {
    case 'HEADLESS_STATE_CHANGED': {
      const stateMsg = msg as HeadlessStateMessage;
      handleHeadlessStateChanged(stateMsg.enabled);
      break;
    }
    case 'HEADLESS_SUBTITLE_LOAD': {
      const loadMsg = msg as unknown as { content: string; format?: 'srt' | 'vtt' | 'ass' };
      handleHeadlessSubtitleLoad(loadMsg.content, loadMsg.format);
      break;
    }
    case 'HEADLESS_SUBTITLE_OFFSET': {
      const offsetMsg = msg as unknown as { offset: number };
      handleHeadlessSubtitleOffset(offsetMsg.offset);
      break;
    }
    case 'HEADLESS_SUBTITLE_UPDATE': {
      const updateMsg = msg as unknown as { text: string | null };
      updateSubtitleText(updateMsg.text);
      if (trackedVideo) {
        positionSubtitleOverVideo(trackedVideo.element);
      }
      break;
    }
    case 'HEADLESS_COMMAND': {
      const cmdMsg = msg as HeadlessCommandMessage;
      handleHeadlessCommand(cmdMsg);
      break;
    }
    case 'HEADLESS_SUBTITLE_FONT_SIZE': {
      const fontSizeMsg = msg as unknown as { delta: number };
      adjustFontSize(fontSizeMsg.delta);
      break;
    }
  }
}

function setupHeadlessMessageListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.addListener(handleHeadlessMessage);
}

function removeHeadlessMessageListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.removeListener(handleHeadlessMessage);
}

// ============================================================================
// Text Mode Word Lookup (Long-press) — always active, desktop decides whether to show
// ============================================================================

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressStartX = 0;
let longPressStartY = 0;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

interface WordAtPointResult {
  word: string;
  /** Full text of the containing text node / element for proper CJK tokenization context */
  contextText: string;
  /** Character offset within contextText where the user clicked */
  offset: number;
}

function getWordAtPoint(x: number, y: number): WordAtPointResult | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const text = el.textContent?.trim();
  if (!text) return null;

  const range = document.caretRangeFromPoint(x, y);
  if (!range) return null;

  const textNode = range.startContainer;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    const fullText = el.textContent || '';
    const words = fullText.split(/[\s\n]+/);
    for (const w of words) {
      if (w.length > 0) return {
        word: w.replace(/[^\w\p{L}]/gu, ''),
        contextText: fullText,
        offset: 0,
      };
    }
    return null;
  }

  const fullText = textNode.textContent || '';
  const offset = range.startOffset;
  let start = offset;
  let end = offset;

  while (start > 0 && /\w|\p{L}/u.test(fullText[start - 1])) start--;
  while (end < fullText.length && /\w|\p{L}/u.test(fullText[end])) end++;

  if (start === end) return null;
  return {
    word: fullText.slice(start, end),
    contextText: fullText,
    offset: range.startOffset,
  };
}

function sendCloseHover(): void {
  const runtime = getChromeRuntime();
  if (runtime) {
    try {
      runtime.sendMessage({ type: 'TEXT_MODE_CLOSE_HOVER' } satisfies TextModeCloseHoverMessage);
    } catch { /* empty */ }
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    sendCloseHover();
  }
}

function handleLongPressStart(e: MouseEvent): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
  sendCloseHover();
  longPressStartX = e.clientX;
  longPressStartY = e.clientY;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      const result = getWordAtPoint(e.clientX, e.clientY);
      const word = result?.word ?? '';
      const iframeOffset = getIframeOffset();
      console.log('[mLearn Content] Long-press detected, word:', word, 'at client(', longPressStartX, longPressStartY, ') screen(', window.screenX, window.screenY, ')');
      if (word.length > 0) {
        const runtime = getChromeRuntime();
        if (runtime) {
          try {
            runtime.sendMessage({
              type: 'TEXT_MODE_WORD_LOOKUP',
              word,
              x: longPressStartX + iframeOffset.x,
              y: longPressStartY + iframeOffset.y,
              screenX: window.screenX,
              screenY: window.screenY,
              contextText: result?.contextText,
              offset: result?.offset,
            } satisfies TextModeWordLookupMessage);
          console.log('[mLearn Content] Sent TEXT_MODE_WORD_LOOKUP for:', word);
        } catch (err) {
          console.log('[mLearn Content] Failed to send word lookup:', err);
        }
      }
    }
  }, LONG_PRESS_MS);
}

function handleLongPressMove(e: MouseEvent): void {
  if (longPressTimer !== null) {
    const dx = e.screenX - longPressStartX;
    const dy = e.screenY - longPressStartY;
    if (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
}

function handleLongPressEnd(): void {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function setupTextModeWordLookup(): void {
  console.log('[mLearn Content] Setting up long-press word lookup');
  document.addEventListener('mousedown', handleLongPressStart);
  document.addEventListener('mousemove', handleLongPressMove);
  document.addEventListener('mouseup', handleLongPressEnd);
  document.addEventListener('mouseleave', handleLongPressEnd);
  document.addEventListener('keydown', handleKeyDown);
}

function showTextModeToast(text: string): void {
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.style.cssText =
    'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(12px);' +
    'background:rgba(15,15,17,0.92);color:#f4f4f5;padding:10px 20px;' +
    'border-radius:9999px;font-size:13px;font-weight:500;z-index:2147483647;' +
    'font-family:"Helvetica Neue",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;' +
    'pointer-events:none;opacity:0;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.06);' +
    'transition:opacity 0.35s cubic-bezier(0.4,0,0.2,1),transform 0.35s cubic-bezier(0.4,0,0.2,1);' +
    'letter-spacing:0.01em;';
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(6px)';
    setTimeout(() => toast.remove(), 350);
  }, 2500);
}

function handleTextModeLookupMessage(message: unknown): void {
  const msg = message as { type: string; error?: string };
  if (msg.type === 'TEXT_MODE_LOOKUP_ERROR' && msg.error === 'cannot-connect') {
    showTextModeToast('mLearn: Could not connect to desktop app');
  }
}

function setupTextModeMessageListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.addListener(handleTextModeLookupMessage);
}

function removeTextModeMessageListener(): void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return;
  runtime.onMessage.removeListener(handleTextModeLookupMessage);
}

function destroy(): void {
  isDestroyed = true;
  detachFromVideo();
  teardownMutationObserver();
  stopGeometryPolling();
  removeCommandListener();
  removeHeadlessMessageListener();
  removeTextModeMessageListener();
  if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  document.removeEventListener('mousedown', handleLongPressStart);
  document.removeEventListener('mousemove', handleLongPressMove);
  document.removeEventListener('mouseup', handleLongPressEnd);
  document.removeEventListener('mouseleave', handleLongPressEnd);
  document.removeEventListener('keydown', handleKeyDown);
  disableSubtitleInjection();
  headlessSubtitles = [];
  headlessModeEnabled = false;
  if (urlObserver) {
    urlObserver.disconnect();
    urlObserver = null;
  }
}

function initContentScript(): void {
  if (isDestroyed) return;

  const video = scanForVideo();
  if (video) {
    attachToVideo(video);
  }

  if (window.self !== window.top && !video) {
    return;
  }

  setupMutationObserver();
  setupCommandListener();
  setupHeadlessMessageListener();
  setupTextModeMessageListener();
  setupTextModeWordLookup();

  let lastUrl = window.location.href;

  // Efficient SPA navigation: intercept history methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function wrappedPushState(this: History, ...args: unknown[]) {
    const result = originalPushState.apply(this, args as [unknown, string, string | URL | null | undefined]);
    checkUrlChange();
    return result;
  }

  function wrappedReplaceState(this: History, ...args: unknown[]) {
    const result = originalReplaceState.apply(this, args as [unknown, string, string | URL | null | undefined]);
    checkUrlChange();
    return result;
  }

  // Preserve function name and length for compatibility with other scripts
  Object.defineProperty(wrappedPushState, 'name', { value: 'pushState' });
  Object.defineProperty(wrappedPushState, 'length', { value: originalPushState.length });
  Object.defineProperty(wrappedReplaceState, 'name', { value: 'replaceState' });
  Object.defineProperty(wrappedReplaceState, 'length', { value: originalReplaceState.length });

  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;

  window.addEventListener('popstate', checkUrlChange);

  function checkUrlChange() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      sendCloseHover();
      if (trackedVideo && document.contains(trackedVideo.element)) {
        startPlatformExtraction(trackedVideo.element);
      } else {
        detachFromVideo();
        const newVideo = scanForVideo();
        if (newVideo) {
          attachToVideo(newVideo);
        }
      }
    }
  }

  // Fallback MutationObserver for navigation detection
  urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      checkUrlChange();
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  window.addEventListener('beforeunload', () => {
    destroy();
    urlObserver?.disconnect();
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });

  // When the tab becomes visible again, immediately send the current geometry
  // so the overlay can snap to the correct video without waiting for the
  // next polling interval.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && trackedVideo) {
      sendGeometryUpdate(getVideoGeometry(trackedVideo.element));
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
