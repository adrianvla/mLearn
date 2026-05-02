import type {
  VideoState,
  VideoStateMessage,
  GeometryUpdateMessage,
  VideoViewportGeometry,
  ExtensionCommandMessage,
} from './types';

interface ChromeRuntime {
  sendMessage: (message: unknown, responseCallback?: (response: unknown) => void) => void;
  onMessage?: {
    addListener: (callback: (message: unknown) => void) => void;
    removeListener: (callback: (message: unknown) => void) => void;
  };
}

declare const chrome: {
  runtime?: ChromeRuntime;
} | undefined;

interface TrackedVideo {
  element: HTMLVideoElement;
  lastSentTime: number;
  lastSrc: string;
}

const TIMEUPDATE_THROTTLE_MS = 250;

let trackedVideo: TrackedVideo | null = null;
let mutationObserver: MutationObserver | null = null;
let videoAttrObserver: MutationObserver | null = null;
let isDestroyed = false;
let geometryInterval: ReturnType<typeof setInterval> | null = null;
let lastGeometry: VideoViewportGeometry | null = null;
let lastVolume = -1;
let isWaiting = false;

function getChromeRuntime(): ChromeRuntime | undefined {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
    return chrome.runtime;
  }
  return undefined;
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

function getBestVideo(): HTMLVideoElement | null {
  const videos = getAllVideos();
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
    isWaiting: isWaiting,
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
}

function handleTimeUpdate(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;

  const now = Date.now();
  if (now - trackedVideo.lastSentTime < TIMEUPDATE_THROTTLE_MS) return;

  trackedVideo.lastSentTime = now;
  sendVideoState(this);
}

function handlePlay(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  isWaiting = false;
  sendVideoState(this);
}

function handlePause(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  isWaiting = false;
  sendVideoState(this);
}

function handleSeeked(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  sendVideoState(this);
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
  if (isDestroyed) return;
  isWaiting = true;
  sendVideoState(this);
}

function handleCanPlay(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  if (isWaiting) {
    isWaiting = false;
    sendVideoState(this);
  }
}

function handleStalled(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  isWaiting = true;
  sendVideoState(this);
}

function handleEnded(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  isWaiting = false;
  sendVideoState(this);
}

function handleLoadedMetadata(this: HTMLVideoElement): void {
  if (isDestroyed) return;
  if (trackedVideo) {
    trackedVideo.lastSrc = this.currentSrc || this.src || window.location.href;
  }
  sendVideoState(this);
  extractAndSendSubtitles(this);
}

function handleEmptied(this: HTMLVideoElement): void {
  if (isDestroyed || !trackedVideo) return;
  if (this.currentSrc !== trackedVideo.lastSrc) {
    trackedVideo.lastSrc = this.currentSrc || this.src || window.location.href;
    sendVideoState(this);
    extractAndSendSubtitles(this);
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
      extractAndSendSubtitles(trackedVideo.element);
    }
  });
  videoAttrObserver.observe(video, { attributes: true, attributeFilter: ['src'] });

  sendVideoState(video);
  startGeometryPolling();
  extractAndSendSubtitles(video);
}

function getVideoGeometry(video: HTMLVideoElement): VideoViewportGeometry {
  const rect = video.getBoundingClientRect();
  return {
    rectX: rect.x,
    rectY: rect.y,
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

  trackedVideo = null;
  lastVolume = -1;
  isWaiting = false;
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

function extractAndSendSubtitles(video: HTMLVideoElement): void {
  const runtime = getChromeRuntime();
  if (!runtime) return;

  const tracks: Array<{ kind: string; src: string; srclang: string; label: string }> = [];
  const textTracks: Array<{ language: string; text: string }> = [];

  // Check <track> children
  for (const track of Array.from(video.querySelectorAll('track'))) {
    tracks.push({
      kind: track.kind,
      src: track.src,
      srclang: track.srclang,
      label: track.label,
    });
  }

  // Check textTracks API for loaded cues
  if (video.textTracks) {
    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      if (tt.mode === 'showing' || tt.mode === 'hidden') {
        const cues: string[] = [];
        const cueList = tt.cues;
        if (cueList) {
          for (let j = 0; j < cueList.length; j++) {
            const cue = cueList[j] as VTTCue;
            if (cue.text) cues.push(cue.text);
          }
        }
        if (cues.length > 0) {
          textTracks.push({
            language: tt.language || tt.label || 'unknown',
            text: cues.join('\n'),
          });
        }
      }
    }
  }

  if (tracks.length > 0 || textTracks.length > 0) {
    try {
      runtime.sendMessage({
        type: 'SUBTITLE_TRACKS',
        tracks,
        textTracks,
        url: window.location.href,
        timestamp: Date.now(),
      });
    } catch {
      // Ignore
    }
  }
}

// Listen for commands from the background script (bidirectional sync)
function handleCommandMessage(message: unknown): void {
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

function destroy(): void {
  isDestroyed = true;
  detachFromVideo();
  teardownMutationObserver();
  stopGeometryPolling();
  removeCommandListener();
}

function initContentScript(): void {
  if (isDestroyed) return;

  const video = scanForVideo();
  if (video) {
    attachToVideo(video);
  }

  setupMutationObserver();
  setupCommandListener();

  let lastUrl = window.location.href;

  // Efficient SPA navigation: intercept history methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(...args: unknown[]) {
    originalPushState.apply(this, args as [unknown, string, string | URL | null | undefined]);
    checkUrlChange();
  };

  history.replaceState = function replaceState(...args: unknown[]) {
    originalReplaceState.apply(this, args as [unknown, string, string | URL | null | undefined]);
    checkUrlChange();
  };

  window.addEventListener('popstate', checkUrlChange);

  function checkUrlChange() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Re-evaluate video on URL change
      if (!trackedVideo || !document.contains(trackedVideo.element)) {
        detachFromVideo();
        const newVideo = scanForVideo();
        if (newVideo) {
          attachToVideo(newVideo);
        }
      }
    }
  }

  // Fallback MutationObserver for navigation detection
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      checkUrlChange();
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  window.addEventListener('beforeunload', () => {
    destroy();
    urlObserver.disconnect();
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
