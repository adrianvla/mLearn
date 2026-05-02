import type {
  SyncMessage,
  VideoState,
  ConnectionStatus,
  PopupMessage,
  VideoStateMessage,
  VideoViewportGeometry,
  SubtitleTracksMessage,
  ExtensionCommandMessage,
} from './types';

const MLEARN_BASE_URL = 'http://127.0.0.1:7753';
const PING_INTERVAL_SECONDS = 5;
const PING_ALARM_NAME = 'mlearn-ping';
const COMMAND_POLL_INTERVAL_SECONDS = 2;
const COMMAND_POLL_ALARM_NAME = 'mlearn-command-poll';
const SYNC_DEBOUNCE_MS = 500;
const GEOMETRY_DEBOUNCE_MS = 50;
const MAX_RETRY_DELAY_MS = 30000;
const INITIAL_RETRY_DELAY_MS = 1000;

let status: ConnectionStatus = 'disconnected';
let lastVideoState: VideoState | null = null;
let lastSubtitleTracks: SubtitleTracksMessage | null = null;
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

function isVideoStateMessage(message: unknown): message is VideoStateMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as Record<string, unknown>).type === 'VIDEO_STATE' &&
    'state' in message &&
    typeof (message as Record<string, unknown>).state === 'object'
  );
}

function isGeometryUpdateMessage(message: unknown): message is { type: 'GEOMETRY_UPDATE'; geometry: VideoViewportGeometry } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as Record<string, unknown>).type === 'GEOMETRY_UPDATE' &&
    'geometry' in message &&
    typeof (message as Record<string, unknown>).geometry === 'object'
  );
}

function isSubtitleTracksMessage(message: unknown): message is SubtitleTracksMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as Record<string, unknown>).type === 'SUBTITLE_TRACKS'
  );
}

function isPopupMessage(message: unknown): message is PopupMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof (message as Record<string, unknown>).type === 'string'
  );
}

function isSyncMessage(message: unknown): message is { type: 'SYNC_STATE' | 'GET_STATE'; videoState?: VideoState; tabId?: number } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ((message as Record<string, unknown>).type === 'SYNC_STATE' || (message as Record<string, unknown>).type === 'GET_STATE')
  );
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      // Video state from content script
      if (isVideoStateMessage(message)) {
        const meta = message.meta;
        handleVideoState(message.state, meta, _sender.tab?.id);
        sendResponse({ received: true });
        return true;
      }

      // Geometry update from content script
      if (isGeometryUpdateMessage(message)) {
        const viewportGeometry = message.geometry;
        const windowId = _sender.tab?.windowId;

        if (windowId !== undefined && chrome.windows) {
          chrome.windows.get(windowId).then((win) => {
            const left = win.left ?? viewportGeometry.screenX;
            const top = (win.top && win.top > 0) ? win.top : viewportGeometry.screenY;
            const absoluteGeometry = {
              x: left + viewportGeometry.rectX,
              y: top + viewportGeometry.rectY,
              width: viewportGeometry.width,
              height: viewportGeometry.height,
              isFullscreen: viewportGeometry.isFullscreen,
            };
            handleGeometryUpdate(absoluteGeometry);
            sendResponse({ received: true });
          }).catch(() => {
            handleGeometryUpdate({
              x: viewportGeometry.screenX + viewportGeometry.rectX,
              y: viewportGeometry.screenY + viewportGeometry.rectY,
              width: viewportGeometry.width,
              height: viewportGeometry.height,
              isFullscreen: viewportGeometry.isFullscreen,
            });
            sendResponse({ received: true });
          });
        } else {
          handleGeometryUpdate({
            x: viewportGeometry.rectX,
            y: viewportGeometry.rectY,
            width: viewportGeometry.width,
            height: viewportGeometry.height,
            isFullscreen: viewportGeometry.isFullscreen,
          });
          sendResponse({ received: true });
        }
        return true;
      }

      // Subtitle tracks from content script
      if (isSubtitleTracksMessage(message)) {
        lastSubtitleTracks = message;
        forwardSubtitleTracks(message);
        sendResponse({ received: true });
        return true;
      }

      // Extension commands from popup or overlay (forward to active tab)
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).type === 'EXTENSION_COMMAND'
      ) {
        const cmd = message as ExtensionCommandMessage;
        sendCommandToActiveTab(cmd.command, {
          time: cmd.time,
          rate: cmd.rate,
          volume: cmd.volume,
        }).then(() => {
          sendResponse({ received: true });
        }).catch(() => {
          sendResponse({ received: false });
        });
        return true;
      }

      // Sync state from other sources
      if (isSyncMessage(message)) {
        if (message.type === 'SYNC_STATE' && message.videoState) {
          handleVideoState(message.videoState, undefined, message.tabId);
          sendResponse({ received: true });
          return true;
        }

        if (message.type === 'GET_STATE') {
          sendResponse({ status, lastVideoState, lastSubtitleTracks });
          return true;
        }
      }

      // Popup messages
      if (isPopupMessage(message)) {
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
          fetch(`${MLEARN_BASE_URL}/api/overlay-launch`, { method: 'POST' }).catch(() => {});
          sendResponse(buildPopupStateResponse());
          return true;
        }
      }

      return false;
    }
  );
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let geometryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGeometry: { x: number; y: number; width: number; height: number; isFullscreen: boolean } | null = null;

function handleVideoState(state: VideoState, meta?: { url: string; title: string }, _tabId?: number): void {
  lastVideoState = state;

  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }

  syncDebounceTimer = setTimeout(() => {
    forwardVideoState(state, meta);
  }, SYNC_DEBOUNCE_MS);
}

function handleGeometryUpdate(geometry: { x: number; y: number; width: number; height: number; isFullscreen: boolean }): void {
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

async function forwardGeometry(geometry: { x: number; y: number; width: number; height: number; isFullscreen: boolean }): Promise<void> {
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
      volume: state.volume ?? 1,
      muted: state.muted ?? false,
      isWaiting: state.isWaiting ?? false,
      isFullscreen: state.isFullscreen ?? false,
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

async function forwardSubtitleTracks(message: SubtitleTracksMessage): Promise<void> {
  if (status === 'disconnected') {
    return;
  }

  try {
    await fetch(`${MLEARN_BASE_URL}/api/overlay-subtitles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: message.tracks,
        textTracks: message.textTracks,
        url: message.url,
      }),
    });
  } catch {
    // Non-critical; don't change connection status
  }
}

/** Send a command to the active tab's content script */
export async function sendCommandToActiveTab(command: ExtensionCommandMessage['command'], params?: { time?: number; rate?: number; volume?: number }): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      const message: ExtensionCommandMessage = {
        type: 'EXTENSION_COMMAND',
        command,
        timestamp: Date.now(),
        ...params,
      };
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch {
    // Tab may not have content script injected
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
    if (alarm.name === COMMAND_POLL_ALARM_NAME) {
      pollCommands();
    }
  };

  chrome.alarms.onAlarm.addListener(pingAlarmListener);

  chrome.alarms.create(PING_ALARM_NAME, {
    periodInMinutes: PING_INTERVAL_SECONDS / 60,
    delayInMinutes: PING_INTERVAL_SECONDS / 60,
  });

  chrome.alarms.create(COMMAND_POLL_ALARM_NAME, {
    periodInMinutes: COMMAND_POLL_INTERVAL_SECONDS / 60,
    delayInMinutes: COMMAND_POLL_INTERVAL_SECONDS / 60,
  });
}

async function pollCommands(): Promise<void> {
  try {
    const response = await fetch(`${MLEARN_BASE_URL}/api/command-poll`, {
      method: 'GET',
    });
    if (!response.ok) return;
    const data = (await response.json()) as { commands: Array<{ command: string; time?: number; rate?: number; volume?: number }> };
    if (!data.commands || data.commands.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return;

    for (const cmd of data.commands) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTENSION_COMMAND',
          command: cmd.command,
          time: cmd.time,
          rate: cmd.rate,
          volume: cmd.volume,
          timestamp: Date.now(),
        });
      } catch {
        // Tab may not have content script
      }
    }
  } catch {
    // Ignore polling errors
  }
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
