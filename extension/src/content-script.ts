import type { VideoState, VideoStateMessage, GeometryUpdateMessage, VideoViewportGeometry } from './types';

declare const chrome: {
  runtime?: {
    sendMessage: (message: unknown) => void;
  };
} | undefined;

interface TrackedVideo {
  element: HTMLVideoElement;
  lastSentTime: number;
}

const TIMEUPDATE_THROTTLE_MS = 250;

let trackedVideo: TrackedVideo | null = null;
let mutationObserver: MutationObserver | null = null;
let isDestroyed = false;
let geometryInterval: ReturnType<typeof setInterval> | null = null;
let lastGeometry: VideoViewportGeometry | null = null;

function getChromeRuntime(): { sendMessage: (message: unknown) => void } | undefined {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
    return chrome.runtime;
  }
  return undefined;
}

function extractVideoState(video: HTMLVideoElement): VideoState {
  return {
    currentTime: video.currentTime,
    duration: video.duration,
    isPlaying: !video.paused,
    playbackRate: video.playbackRate,
    src: video.currentSrc || video.src || window.location.href,
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
  sendVideoState(this);
}

function handlePause(this: HTMLVideoElement): void {
  if (isDestroyed) return;
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

function attachToVideo(video: HTMLVideoElement): void {
  if (trackedVideo?.element === video) return;

  detachFromVideo();

  trackedVideo = {
    element: video,
    lastSentTime: 0,
  };

  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeeked);
  video.addEventListener('ratechange', handleRateChange);

  sendVideoState(video);
  startGeometryPolling();
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

  // Send initial geometry after a short delay so the video has rendered
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
      lastGeometry.height !== geometry.height;

    // Send on change, or every 10 ticks (~1s) as a heartbeat
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

  trackedVideo = null;
  stopGeometryPolling();
}

function findVideoInNode(node: Node): HTMLVideoElement | null {
  if (node instanceof HTMLVideoElement) {
    return node;
  }
  if (node instanceof Element) {
    const video = node.querySelector('video');
    if (video) return video;
  }
  return null;
}

function scanForVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
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
  }

  for (const mutation of mutations) {
    for (const addedNode of Array.from(mutation.addedNodes)) {
      const video = findVideoInNode(addedNode);
      if (video && video !== trackedVideo?.element) {
        if (!trackedVideo || !trackedVideo.element.src) {
          attachToVideo(video);
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

function destroy(): void {
  isDestroyed = true;
  detachFromVideo();
  teardownMutationObserver();
  stopGeometryPolling();
}

function initContentScript(): void {
  if (isDestroyed) return;

  const video = scanForVideo();
  if (video) {
    attachToVideo(video);
  }

  setupMutationObserver();

  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (!trackedVideo) {
        const newVideo = scanForVideo();
        if (newVideo) {
          attachToVideo(newVideo);
        }
      }
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  window.addEventListener('beforeunload', () => {
    destroy();
    urlObserver.disconnect();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
