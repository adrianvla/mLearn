import type { SyncMessage, VideoState, ConnectionStatus, PopupMessage, VideoStateMessage, VideoViewportGeometry } from './types';

const MLEARN_BASE_URL = 'http://127.0.0.1:7753';
const PING_INTERVAL_SECONDS = 5;
const PING_ALARM_NAME = 'mlearn-ping';
const SYNC_DEBOUNCE_MS = 500;
const GEOMETRY_DEBOUNCE_MS = 50;
const MAX_RETRY_DELAY_MS = 30000;
const INITIAL_RETRY_DELAY_MS = 1000;

let status: ConnectionStatus = 'disconnected';
let lastVideoState: VideoState | null = null;
let retryDelay = INITIAL_RETRY_DELAY_MS;
let pingAlarmListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;

export function initServiceWorker(): void {
  status = 'connecting';
  setupPingAlarm();
  setupMessageListener();
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

function setConnectionStatus(newStatus: ConnectionStatus): void {
  if (status !== newStatus) {
    status = newStatus;
    notifyContentScriptsOfStatus();
  }
}

function notifyContentScriptsOfStatus(): void {
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CONNECTION_STATUS',
          status,
        }).catch(() => {});
      }
    }
  });
}

function buildPopupStateResponse(): PopupMessage {
  return {
    type: 'POPUP_STATE_UPDATE',
    connectionStatus: status,
    videoState: lastVideoState ?? undefined,
    timestamp: Date.now(),
  };
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (message: SyncMessage | PopupMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
            if (message.type === 'VIDEO_STATE' && 'state' in message && message.state) {
              const meta = (message as unknown as VideoStateMessage).meta;
              handleVideoState(message.state as VideoState, meta, message.tabId);
              sendResponse({ received: true });
              return true;
            }

      if (message.type === 'GEOMETRY_UPDATE' && 'geometry' in message && message.geometry) {
        const viewportGeometry = message.geometry as VideoViewportGeometry;
        const windowId = _sender.tab?.windowId;

        if (windowId !== undefined && chrome.windows) {
          chrome.windows.get(windowId).then((win) => {
            const left = win.left ?? viewportGeometry.screenX;
            // On macOS chrome.windows.get() can return top: 0 incorrectly;
            // fall back to window.screenY from the content script when that happens
            const top = (win.top && win.top > 0) ? win.top : viewportGeometry.screenY;
            const absoluteGeometry = {
              x: left + viewportGeometry.rectX,
              y: top + viewportGeometry.rectY,
              width: viewportGeometry.width,
              height: viewportGeometry.height,
            };
            handleGeometryUpdate(absoluteGeometry);
            sendResponse({ received: true });
          }).catch(() => {
            handleGeometryUpdate({
              x: viewportGeometry.screenX + viewportGeometry.rectX,
              y: viewportGeometry.screenY + viewportGeometry.rectY,
              width: viewportGeometry.width,
              height: viewportGeometry.height,
            });
            sendResponse({ received: true });
          });
        } else {
          handleGeometryUpdate({
            x: viewportGeometry.rectX,
            y: viewportGeometry.rectY,
            width: viewportGeometry.width,
            height: viewportGeometry.height,
          });
          sendResponse({ received: true });
        }
        return true;
      }

      if (message.type === 'SYNC_STATE' && message.videoState) {
        handleVideoState(message.videoState, undefined, message.tabId);
        sendResponse({ received: true });
        return true;
      }

      if (message.type === 'GET_STATE') {
        sendResponse({ status, lastVideoState });
        return true;
      }

      if (message.type === 'GET_POPUP_STATE') {
        pingMlearn().then(() => {
          sendResponse(buildPopupStateResponse());
        });
        return true;
      }

      if (message.type === 'REQUEST_SYNC') {
        if (lastVideoState) {
          handleVideoState(lastVideoState);
        }
        sendResponse(buildPopupStateResponse());
        return true;
      }

      if (message.type === 'OPEN_OVERLAY') {
        fetch(`${MLEARN_BASE_URL}/api/overlay-launch`, { method: 'POST' })
          .catch(() => {});
        sendResponse(buildPopupStateResponse());
        return true;
      }

      return false;
    }
  );
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let geometryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGeometry: { x: number; y: number; width: number; height: number } | null = null;

function handleVideoState(state: VideoState, meta?: { url: string; title: string }, _tabId?: number): void {
  lastVideoState = state;

  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }

  syncDebounceTimer = setTimeout(() => {
    forwardVideoState(state, meta);
  }, SYNC_DEBOUNCE_MS);
}

function handleGeometryUpdate(geometry: { x: number; y: number; width: number; height: number }): void {
  pendingGeometry = geometry;

  if (geometryDebounceTimer) {
    clearTimeout(geometryDebounceTimer);
  }

  geometryDebounceTimer = setTimeout(() => {
    if (pendingGeometry) {
      forwardGeometry(pendingGeometry);
      pendingGeometry = null;
    }
  }, GEOMETRY_DEBOUNCE_MS);
}

async function forwardGeometry(geometry: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (status === 'disconnected') {
    return;
  }

  try {
    const response = await fetch(`${MLEARN_BASE_URL}/api/overlay-geometry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geometry),
    });

    if (response.ok) {
      retryDelay = INITIAL_RETRY_DELAY_MS;
      if (status !== 'connected') {
        setConnectionStatus('connected');
      }
    } else {
      handleConnectionError();
    }
  } catch (error) {
    handleConnectionError();
  }
}

async function forwardVideoState(state: VideoState, meta?: { url: string; title: string }): Promise<void> {
  if (status === 'disconnected') {
    return;
  }

  try {
    const payload = {
      currentTime: state.currentTime,
      duration: state.duration,
      isPlaying: state.isPlaying,
      playbackRate: state.playbackRate ?? 1,
      url: meta?.url ?? state.src,
      title: meta?.title,
    };
    const response = await fetch(`${MLEARN_BASE_URL}/api/overlay-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      retryDelay = INITIAL_RETRY_DELAY_MS;
      if (status !== 'connected') {
        setConnectionStatus('connected');
      }
    } else {
      handleConnectionError();
    }
  } catch (error) {
    handleConnectionError();
  }
}

function handleConnectionError(): void {
  if (status !== 'disconnected') {
    setConnectionStatus('disconnected');
  }

  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
}

async function pingMlearn(): Promise<void> {
  try {
    const response = await fetch(`${MLEARN_BASE_URL}/api/ping`, {
      method: 'GET',
    });

    if (response.ok) {
      retryDelay = INITIAL_RETRY_DELAY_MS;
      if (status !== 'connected') {
        setConnectionStatus('connected');
        if (lastVideoState) {
          forwardVideoState(lastVideoState);
        }
      }
    } else {
      handleConnectionError();
    }
  } catch (error) {
    handleConnectionError();
  }
}

function setupPingAlarm(): void {
  if (pingAlarmListener) {
    chrome.alarms.onAlarm.removeListener(pingAlarmListener);
  }

  pingAlarmListener = (alarm: chrome.alarms.Alarm) => {
    if (alarm.name === PING_ALARM_NAME) {
      pingMlearn();
    }
  };

  chrome.alarms.onAlarm.addListener(pingAlarmListener);

  chrome.alarms.create(PING_ALARM_NAME, {
    periodInMinutes: PING_INTERVAL_SECONDS / 60,
    delayInMinutes: PING_INTERVAL_SECONDS / 60,
  });
}

export function cleanupServiceWorker(): void {
  if (pingAlarmListener) {
    chrome.alarms.onAlarm.removeListener(pingAlarmListener);
    pingAlarmListener = null;
  }

  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }

  if (geometryDebounceTimer) {
    clearTimeout(geometryDebounceTimer);
    geometryDebounceTimer = null;
  }

  chrome.alarms.clearAll();
}

export function handleSyncMessage(message: SyncMessage): void {
  if (message.type === 'SYNC_STATE' && message.videoState) {
    handleVideoState(message.videoState, undefined, message.tabId);
  }
}

export function sendVideoState(state: VideoState): void {
  handleVideoState(state);
}

export function getLastVideoState(): VideoState | null {
  return lastVideoState;
}

initServiceWorker();