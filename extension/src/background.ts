import type {
  SyncMessage,
  VideoState,
  ConnectionStatus,
  PopupMessage,
  VideoStateMessage,
  VideoViewportGeometry,
  SubtitleTracksMessage,
  ExtensionCommandMessage,
  HeadlessMode,
  HeadlessPopupState,
  HeadlessStateMessage,
  HeadlessSubtitleMessage,
  HeadlessCommandMessage,
  TextModeWordLookupMessage,
  WatchTogetherExtensionState,
  WatchTogetherRoomSessionExt,
  WatchTogetherPlaybackPayloadExt,
  WatchTogetherRoomStateExt,
  ParsedSubtitle,
  VideoScreenshotMessage,
} from './types.js';
import {
  loadHeadlessMode,
  setHeadlessMode,
  isHeadlessEnabled,
  toggleHeadlessMode,
} from './headless/headlessState.js';
import { parseSubtitles, findCurrentSubtitle, findPreviousSubForSync, findNextSub } from './headless/subtitleParser.js';
import { loadAuthToken, saveAuthToken, clearAuthToken, getAuthToken } from './headless/authTokenCache.js';

const MLEARN_BASE_URL = 'http://127.0.0.1:7753';
const DEFAULT_CLOUD_API_URL = 'https://mlearn-cloud.kikan.net';
const PING_INTERVAL_SECONDS = 5;
const PING_ALARM_NAME = 'mlearn-ping';
const COMMAND_POLL_INTERVAL_SECONDS = 2;
const COMMAND_POLL_ALARM_NAME = 'mlearn-command-poll';
const SYNC_DEBOUNCE_MS = 150;
const GEOMETRY_DEBOUNCE_MS = 50;
const MAX_RETRY_DELAY_MS = 30000;
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 5000;

let status: ConnectionStatus = 'disconnected';
let lastVideoState: VideoState | null = null;
let lastSubtitleTracks: SubtitleTracksMessage | null = null;
let retryDelay = INITIAL_RETRY_DELAY_MS;
let pingAlarmListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;

let headlessMode: HeadlessMode = 'disabled';
let headlessSubtitleOffset = 0;
let headlessSubtitlesLoaded = false;
let headlessCurrentSubtitleText: string | null = null;
let headlessSubtitleFilename: string | null = null;
let parsedSubtitles: ParsedSubtitle[] = [];

let watchTogetherState: WatchTogetherExtensionState = {
  isInRoom: false,
  roomCode: null,
  role: null,
  peerCount: 0,
  isConnecting: false,
  error: null,
};
let currentRoomSession: WatchTogetherRoomSessionExt | null = null;
let roomAccessToken = '';
let unsubscribeRealtimeRef: (() => void) | null = null;
let ownerSyncInterval: ReturnType<typeof setInterval> | null = null;

let cloudApiUrl = DEFAULT_CLOUD_API_URL;

const activeVideoFrames = new Map<number, number>();
let activeVideoTabId: number | undefined;

export async function fetchAuthTokenFromDesktop(): Promise<void> {
  try {
    const response = await fetchWithTimeout(`${MLEARN_BASE_URL}/api/extension-auth-token`);
    if (!response.ok) {
      console.error('[mLearn Background] fetchAuthTokenFromDesktop failed:', response.status, response.statusText);
      return;
    }
    const data = (await response.json()) as { accessToken?: string };
    await saveAuthToken(data.accessToken || '');
  } catch (error) {
    console.error('[mLearn Background] fetchAuthTokenFromDesktop error:', error instanceof Error ? error.message : String(error));
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Timeout', 'AbortError'));
  }, timeoutMs);

  try {
    if (init.signal) {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
      if (init.signal.aborted) {
        controller.abort();
      }
    }
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function initServiceWorker(): void {
  status = 'connecting';
  setupPingAlarm();
  void fetchAuthTokenFromDesktop();
  void loadAuthToken();
  setupMessageListener();
  setupTabActivatedListener();
}

function setupTabActivatedListener(): void {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    console.log('[mLearn Background] Tab activated:', activeInfo.tabId);
    chrome.tabs.get(activeInfo.tabId).then((tab) => {
      const tabUrl = tab.url;
      console.log('[mLearn Background] Tab URL:', tabUrl);
      if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('about:') || tabUrl.startsWith('edge://') || tabUrl.startsWith('moz-extension://')) {
        console.log('[mLearn Background] Skipping internal URL');
        return;
      }
      fetchWithTimeout(`${MLEARN_BASE_URL}/api/active-url-changed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tabUrl }),
      }).then(() => {
        console.log('[mLearn Background] Sent active-url-changed for:', tabUrl);
      }).catch((err) => {
        console.log('[mLearn Background] Failed to send active-url-changed:', err);
      });
    }).catch((err) => {
      console.log('[mLearn Background] Failed to get tab:', err);
    });
  });
}

export async function initHeadlessMode(): Promise<void> {
  const mode = await loadHeadlessMode();
  headlessMode = mode;

  if (mode === 'enabled' && status === 'connected') {
    disableHeadlessMode();
  }

  if (mode === 'enabled' && status !== 'connected') {
    notifyContentScriptsOfHeadlessState();
  }
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

function setConnectionStatus(newStatus: ConnectionStatus): void {
  if (status !== newStatus) {
    status = newStatus;
    notifyContentScriptsOfStatus();

    if (status === 'connected') {
      disableHeadlessMode();
    } else {
      notifyPopupOfState();
    }
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
    headlessState: buildHeadlessPopupState(),
    watchTogetherState: buildWatchTogetherPopupState(),
    accessToken: getAuthToken(),
  };
}

function buildHeadlessPopupState(): HeadlessPopupState {
  return {
    mode: headlessMode,
    subtitleOffset: headlessSubtitleOffset,
    subtitlesLoaded: headlessSubtitlesLoaded,
    currentSubtitleText: headlessCurrentSubtitleText,
    subtitleFilename: headlessSubtitleFilename,
  };
}

function buildWatchTogetherPopupState(): WatchTogetherExtensionState {
  return { ...watchTogetherState };
}

function notifyPopupOfState(): void {
  const message = buildPopupStateResponse();
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Popup may not be open
  }
}

async function handleHeadlessModeToggle(): Promise<HeadlessMode> {
  const next = await toggleHeadlessMode();
  headlessMode = next;

  if (next === 'enabled') {
    headlessSubtitleOffset = 0;
    headlessSubtitlesLoaded = false;
    headlessCurrentSubtitleText = null;
    headlessSubtitleFilename = null;
    parsedSubtitles = [];
  }

  notifyContentScriptsOfHeadlessState();
  notifyPopupOfState();

  return next;
}

function disableHeadlessMode(): void {
  if (headlessMode === 'disabled') return;

  headlessMode = 'disabled';
  setHeadlessMode('disabled');

  headlessSubtitleOffset = 0;
  headlessSubtitlesLoaded = false;
  headlessCurrentSubtitleText = null;
  headlessSubtitleFilename = null;
  parsedSubtitles = [];

  if (watchTogetherState.isInRoom) {
    handleLeaveWatchTogetherRoom().catch(() => {});
  }

  notifyContentScriptsOfHeadlessState();
  notifyPopupOfState();
}

function notifyContentScriptsOfHeadlessState(): void {
  const message: HeadlessStateMessage = {
    type: 'HEADLESS_STATE_CHANGED',
    enabled: isHeadlessEnabled(),
  };
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        const frameId = activeVideoFrames.get(tab.id);
        if (frameId !== undefined) {
          chrome.tabs.sendMessage(tab.id, message, { frameId }).catch(() => {});
        } else {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    }
  });
}

function handleHeadlessSubtitleLoad(content: string, format?: 'srt' | 'vtt' | 'ass', filename?: string): void {
  parsedSubtitles = parseSubtitles(content, format);
  headlessSubtitlesLoaded = parsedSubtitles.length > 0;
  headlessSubtitleFilename = headlessSubtitlesLoaded ? (filename ?? null) : null;

  const loadMessage = {
    type: 'HEADLESS_SUBTITLE_LOAD' as const,
    content,
    format,
  };
  const targetTabId = activeVideoTabId;
  if (targetTabId !== undefined) {
    const frameId = activeVideoFrames.get(targetTabId);
    if (frameId !== undefined) {
      chrome.tabs.sendMessage(targetTabId, loadMessage, { frameId }).catch(() => {});
    } else {
      chrome.tabs.sendMessage(targetTabId, loadMessage).catch(() => {});
    }
  } else {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, loadMessage).catch(() => {});
      }
    });
  }

  if (lastVideoState && headlessSubtitlesLoaded) {
    handleHeadlessVideoStateUpdate(lastVideoState);
  } else {
    sendHeadlessSubtitleToActiveTab(null);
  }

  notifyPopupOfState();
}

function handleHeadlessSubtitleOffsetChange(offset: number): void {
  headlessSubtitleOffset = offset;

  const targetTabId = activeVideoTabId;
  if (targetTabId !== undefined) {
    chrome.tabs.sendMessage(targetTabId, { type: 'HEADLESS_SUBTITLE_OFFSET', offset }).catch(() => {});
  } else {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, { type: 'HEADLESS_SUBTITLE_OFFSET', offset }).catch(() => {});
      }
    });
  }

  if (lastVideoState) {
    handleHeadlessVideoStateUpdate(lastVideoState);
  } else {
    sendHeadlessSubtitleToActiveTab(headlessCurrentSubtitleText);
  }

  notifyPopupOfState();
}

function handleSnapSubtitleOffset(direction: 'backward' | 'forward'): void {
  if (!lastVideoState || parsedSubtitles.length === 0) return;

  const adjustedTime = lastVideoState.currentTime + headlessSubtitleOffset;
  let sub: ParsedSubtitle | null = null;

  if (direction === 'backward') {
    sub = findPreviousSubForSync(parsedSubtitles, adjustedTime);
  } else {
    sub = findNextSub(parsedSubtitles, adjustedTime);
  }

  if (sub) {
    const newOffset = sub.start - lastVideoState.currentTime;
    handleHeadlessSubtitleOffsetChange(newOffset);
  }
}

function handleHeadlessVideoStateUpdate(state: VideoState): void {
  if (!isHeadlessEnabled()) return;

  if (headlessSubtitlesLoaded && parsedSubtitles.length > 0) {
    const subtitle = findCurrentSubtitle(parsedSubtitles, state.currentTime, headlessSubtitleOffset);
    const text = subtitle?.text || null;

    if (text !== headlessCurrentSubtitleText) {
      headlessCurrentSubtitleText = text;
      sendHeadlessSubtitleToActiveTab(text);
    }
  }
}

function sendHeadlessSubtitleToActiveTab(text: string | null): void {
  const targetTabId = activeVideoTabId;
  if (targetTabId !== undefined) {
    const frameId = activeVideoFrames.get(targetTabId);
    const message: HeadlessSubtitleMessage = {
      type: 'HEADLESS_SUBTITLE_UPDATE',
      text,
      offset: headlessSubtitleOffset,
    };
    if (frameId !== undefined) {
      chrome.tabs.sendMessage(targetTabId, message, { frameId }).catch(() => {});
    } else {
      chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
    }
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab?.id !== undefined) {
      const frameId = activeVideoFrames.get(tab.id);
      const message: HeadlessSubtitleMessage = {
        type: 'HEADLESS_SUBTITLE_UPDATE',
        text,
        offset: headlessSubtitleOffset,
      };
      if (frameId !== undefined) {
        chrome.tabs.sendMessage(tab.id, message, { frameId }).catch(() => {});
      } else {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  });
}

async function fetchWatchTogether<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Watch-together request failed: ${response.status}`);
  }
  return payload;
}

async function createWatchTogetherRoom(
  accessToken: string,
  payload: WatchTogetherPlaybackPayloadExt,
): Promise<WatchTogetherRoomSessionExt> {
  const response = await fetchWatchTogether<{
    data: {
      role: 'owner' | 'viewer';
      canControl: boolean;
      room: WatchTogetherRoomStateExt;
      socket: { url: string; protocol: string };
    };
    actions: {
      refresh: { method: string; url: string };
      connect_socket: { method: string; url: string };
      update_state?: { method: string; url: string };
      close_room?: { method: string; url: string };
      leave_room?: { method: string; url: string };
    };
  }>(`${cloudApiUrl}/api/watch-together/rooms`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    role: response.data.role,
    canControl: response.data.canControl,
    room: response.data.room,
    socket: response.data.socket,
    actions: response.actions,
  };
}

async function joinWatchTogetherRoom(
  roomCode: string,
  accessToken: string,
): Promise<WatchTogetherRoomSessionExt> {
  const response = await fetchWatchTogether<{
    data: {
      role: 'owner' | 'viewer';
      canControl: boolean;
      room: WatchTogetherRoomStateExt;
      socket: { url: string; protocol: string };
    };
    actions: {
      refresh: { method: string; url: string };
      connect_socket: { method: string; url: string };
      update_state?: { method: string; url: string };
      close_room?: { method: string; url: string };
      leave_room?: { method: string; url: string };
    };
  }>(`${cloudApiUrl}/api/watch-together/rooms/join`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase() }),
  });

  return {
    role: response.data.role,
    canControl: response.data.canControl,
    room: response.data.room,
    socket: response.data.socket,
    actions: response.actions,
  };
}

async function leaveWatchTogetherRoomApi(session: WatchTogetherRoomSessionExt, accessToken: string): Promise<void> {
  if (!session.actions.leave_room) return;
  await fetchWatchTogether<Record<string, never>>(session.actions.leave_room.url, accessToken, {
    method: session.actions.leave_room.method,
  });
}

async function closeWatchTogetherRoomApi(session: WatchTogetherRoomSessionExt, accessToken: string): Promise<void> {
  if (!session.actions.close_room) return;
  await fetchWatchTogether<Record<string, never>>(session.actions.close_room.url, accessToken, {
    method: session.actions.close_room.method,
  });
}

async function updateWatchTogetherRoomStateApi(
  session: WatchTogetherRoomSessionExt,
  accessToken: string,
  payload: WatchTogetherPlaybackPayloadExt,
): Promise<void> {
  if (!session.actions.update_state) return;
  await fetchWatchTogether<Record<string, never>>(session.actions.update_state.url, accessToken, {
    method: session.actions.update_state.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function handleCreateWatchTogetherRoom(accessToken?: string): Promise<void> {
  const token = accessToken || getAuthToken();
  if (!token) {
    watchTogetherState.isConnecting = false;
    watchTogetherState.error = 'No access token available';
    notifyPopupOfState();
    return;
  }

  watchTogetherState.isConnecting = true;
  watchTogetherState.error = null;

  try {
    const payload: WatchTogetherPlaybackPayloadExt = {
      currentTime: lastVideoState?.currentTime ?? 0,
      paused: !(lastVideoState?.isPlaying ?? false),
      playbackRate: lastVideoState?.playbackRate ?? 1,
      mediaUrl: lastVideoState?.src,
    };

    const session = await createWatchTogetherRoom(token, payload);
    activateRoom(session, token);
  } catch (error) {
    watchTogetherState.isConnecting = false;
    watchTogetherState.error = error instanceof Error ? error.message : 'Failed to create room';
    notifyPopupOfState();
  }
}

async function handleJoinWatchTogetherRoom(roomCode: string, accessToken?: string): Promise<void> {
  const token = accessToken || getAuthToken();
  if (!token) {
    watchTogetherState.isConnecting = false;
    watchTogetherState.error = 'No access token available';
    notifyPopupOfState();
    return;
  }

  watchTogetherState.isConnecting = true;
  watchTogetherState.error = null;

  try {
    const session = await joinWatchTogetherRoom(roomCode, token);
    activateRoom(session, token);
  } catch (error) {
    watchTogetherState.isConnecting = false;
    watchTogetherState.error = error instanceof Error ? error.message : 'Failed to join room';
    notifyPopupOfState();
  }
}

async function handleLeaveWatchTogetherRoom(): Promise<void> {
  if (!currentRoomSession) {
    cleanupRoomConnection();
    return;
  }

  try {
    if (currentRoomSession.role === 'owner') {
      await closeWatchTogetherRoomApi(currentRoomSession, roomAccessToken);
    } else {
      await leaveWatchTogetherRoomApi(currentRoomSession, roomAccessToken);
    }
  } catch {
    // Ignore errors on leave
  }

  cleanupRoomConnection();
}

function activateRoom(session: WatchTogetherRoomSessionExt, accessToken: string): void {
  cleanupRoomConnection();

  currentRoomSession = session;
  roomAccessToken = accessToken;

  watchTogetherState = {
    isInRoom: true,
    roomCode: session.room.roomCode,
    role: session.role,
    peerCount: session.room.peerCount ?? 0,
    isConnecting: false,
    error: null,
  };

  notifyPopupOfState();

  try {
    const socket = new WebSocket(session.socket.url, [session.socket.protocol, accessToken]);
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    unsubscribeRealtimeRef = () => {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      unsubscribeRealtimeRef = null;
    };

    socket.addEventListener('open', () => {
      pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send('ping');
        }
      }, 30000);
    });

    socket.addEventListener('message', (event) => {
      const data = String(event.data);
      if (data === 'pong') {
        return;
      }

      try {
        const payload = JSON.parse(data) as
          | { type: 'room-state'; room: WatchTogetherRoomStateExt }
          | { type: 'peer-joined'; room: WatchTogetherRoomStateExt; peerId: string }
          | { type: 'peer-left'; room: WatchTogetherRoomStateExt; peerId: string };

        if (payload.type === 'room-state') {
          const room = payload.room;
          watchTogetherState.peerCount = room.peerCount ?? 0;
          if (currentRoomSession) {
            currentRoomSession = { ...currentRoomSession, room };
          }

          if (session.role === 'viewer' && lastVideoState) {
            if (Math.abs(room.currentTime - lastVideoState.currentTime) > 2) {
              forwardHeadlessCommand({
                type: 'HEADLESS_COMMAND',
                command: 'seek',
                time: room.currentTime,
              });
            }
            if (room.paused && lastVideoState.isPlaying) {
              forwardHeadlessCommand({ type: 'HEADLESS_COMMAND', command: 'pause' });
            } else if (!room.paused && !lastVideoState.isPlaying) {
              forwardHeadlessCommand({ type: 'HEADLESS_COMMAND', command: 'play' });
            }
            if (room.playbackRate !== lastVideoState.playbackRate) {
              forwardHeadlessCommand({
                type: 'HEADLESS_COMMAND',
                command: 'setRate',
                rate: room.playbackRate,
              });
            }
          }

          notifyPopupOfState();
        } else if (payload.type === 'peer-joined' || payload.type === 'peer-left') {
          watchTogetherState.peerCount = payload.room.peerCount ?? 0;
          if (currentRoomSession) {
            currentRoomSession = { ...currentRoomSession, room: payload.room };
          }
          notifyPopupOfState();
        }
      } catch {
        // Ignore parse errors
      }
    });

    socket.addEventListener('error', () => {
      watchTogetherState.error = 'WebSocket error';
      notifyPopupOfState();
    });

    socket.addEventListener('close', (event) => {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (!event.wasClean) {
        watchTogetherState.error = 'Connection closed unexpectedly';
        notifyPopupOfState();
      }
      if (watchTogetherState.isInRoom) {
        cleanupRoomConnection();
      }
    });
  } catch {
    watchTogetherState.error = 'Failed to connect to room';
    notifyPopupOfState();
  }

  if (session.role === 'owner' && session.actions.update_state) {
    if (ownerSyncInterval) {
      clearInterval(ownerSyncInterval);
    }
    ownerSyncInterval = setInterval(() => {
      if (!lastVideoState || !currentRoomSession) return;

      updateWatchTogetherRoomStateApi(currentRoomSession, roomAccessToken, {
        currentTime: lastVideoState.currentTime,
        paused: !lastVideoState.isPlaying,
        playbackRate: lastVideoState.playbackRate ?? 1,
        mediaUrl: lastVideoState.src,
      });
    }, 1000);
  }
}

function cleanupRoomConnection(): void {
  if (unsubscribeRealtimeRef) {
    unsubscribeRealtimeRef();
    unsubscribeRealtimeRef = null;
  }

  if (ownerSyncInterval) {
    clearInterval(ownerSyncInterval);
    ownerSyncInterval = null;
  }

  watchTogetherState = {
    isInRoom: false,
    roomCode: null,
    role: null,
    peerCount: 0,
    isConnecting: false,
    error: null,
  };

  currentRoomSession = null;
  roomAccessToken = '';

  notifyPopupOfState();
}

function forwardHeadlessCommand(command: HeadlessCommandMessage): void {
  const targetTabId = activeVideoTabId;
  if (targetTabId !== undefined) {
    chrome.tabs.sendMessage(targetTabId, command).catch(() => {});
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab?.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, command).catch(() => {});
    }
  });
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

function isVideoScreenshotMessage(message: unknown): message is VideoScreenshotMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as Record<string, unknown>).type === 'VIDEO_SCREENSHOT' &&
    'dataUrl' in message &&
    typeof (message as Record<string, unknown>).dataUrl === 'string'
  );
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      // Allow cloud API URL override from any popup message
      if (
        typeof message === 'object' &&
        message !== null &&
        'cloudApiUrl' in message &&
        typeof (message as Record<string, unknown>).cloudApiUrl === 'string'
      ) {
        cloudApiUrl = (message as Record<string, unknown>).cloudApiUrl as string;
      }

      // Video state from content script
      if (isVideoStateMessage(message)) {
        const meta = message.meta;
        const tabId = _sender.tab?.id;
        const frameId = _sender.frameId;
        if (tabId !== undefined) {
          activeVideoTabId = tabId;
        }
        if (tabId !== undefined && frameId !== undefined) {
          activeVideoFrames.set(tabId, frameId);
        }
        handleVideoState(message.state, meta, tabId);
        sendResponse({ received: true });
        return true;
      }

      // Geometry update from content script
      if (isGeometryUpdateMessage(message)) {
        if (isHeadlessEnabled()) {
          sendResponse({ received: true });
          return true;
        }

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

      // Video screenshot from content script
      if (isVideoScreenshotMessage(message)) {
        forwardVideoScreenshot(message.dataUrl, message.timestamp);
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

      // Text mode word lookup from content script (long-press)
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).type === 'TEXT_MODE_WORD_LOOKUP'
      ) {
        const { word, x, y, screenX, screenY, contextText, offset } = message as TextModeWordLookupMessage;
        const windowId = _sender.tab?.windowId;

        const forwardLookup = (absX: number, absY: number) => {
          fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-text-lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, x: absX, y: absY, contextText, offset }),
          }).then((resp) => {
            if (!resp.ok && _sender.tab?.id) {
              chrome.tabs.sendMessage(_sender.tab.id, {
                type: 'TEXT_MODE_LOOKUP_ERROR',
                error: 'cannot-connect',
              }).catch(() => {});
            }
          }).catch(() => {
            if (_sender.tab?.id) {
              chrome.tabs.sendMessage(_sender.tab.id, {
                type: 'TEXT_MODE_LOOKUP_ERROR',
                error: 'cannot-connect',
              }).catch(() => {});
            }
          });
        };

        if (windowId !== undefined && chrome.windows) {
          chrome.windows.get(windowId).then((win) => {
            const left = win.left ?? screenX;
            const top = (win.top && win.top > 0) ? win.top : screenY;
            forwardLookup(left + x, top + y);
          }).catch(() => {
            forwardLookup(screenX + x, screenY + y);
          });
        } else {
          forwardLookup(screenX + x, screenY + y);
        }

        sendResponse({ received: true });
        return true;
      }

      if (
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).type === 'TEXT_MODE_CLOSE_HOVER'
      ) {
      fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-close-hover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {});
        sendResponse({ received: true });
        return true;
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
          fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-launch`, { method: 'POST' }).catch(() => {});
          sendResponse(buildPopupStateResponse());
          return true;
        }

        if (message.type === 'TOGGLE_HEADLESS_MODE') {
          handleHeadlessModeToggle().then(() => {
            sendResponse({
              type: 'HEADLESS_STATE_UPDATE',
              headlessState: buildHeadlessPopupState(),
              watchTogetherState: buildWatchTogetherPopupState(),
            });
          });
          return true;
        }

        if (message.type === 'GET_HEADLESS_STATE') {
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'LOAD_SUBTITLES') {
          if (message.subtitleContent) {
            handleHeadlessSubtitleLoad(message.subtitleContent, message.subtitleFormat, message.subtitleFilename);
          }
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SET_SUBTITLE_OFFSET') {
          if (typeof message.offset === 'number') {
            handleHeadlessSubtitleOffsetChange(message.offset);
          }
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SET_SUBTITLE_OFFSET_EXPLICIT') {
          if (typeof message.explicitOffset === 'number') {
            handleHeadlessSubtitleOffsetChange(message.explicitOffset);
          }
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SNAP_SUBTITLE_OFFSET_BACKWARD') {
          handleSnapSubtitleOffset('backward');
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SNAP_SUBTITLE_OFFSET_FORWARD') {
          handleSnapSubtitleOffset('forward');
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SET_SUBTITLE_FONT_SIZE') {
          if (typeof message.fontSizeDelta === 'number') {
            const targetTabId = activeVideoTabId;
            if (targetTabId !== undefined) {
              chrome.tabs.sendMessage(targetTabId, { type: 'HEADLESS_SUBTITLE_FONT_SIZE', delta: message.fontSizeDelta }).catch(() => {});
            } else {
              chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
                if (tab?.id !== undefined) {
                  chrome.tabs.sendMessage(tab.id, { type: 'HEADLESS_SUBTITLE_FONT_SIZE', delta: message.fontSizeDelta }).catch(() => {});
                }
              });
            }
          }
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'WATCH_TOGETHER_CREATE_ROOM') {
          const token = message.accessToken || getAuthToken();
          if (token) {
            handleCreateWatchTogetherRoom(token).then(() => {
              sendResponse({
                type: 'HEADLESS_STATE_UPDATE',
                headlessState: buildHeadlessPopupState(),
                watchTogetherState: buildWatchTogetherPopupState(),
              });
            });
          } else {
            sendResponse({
              type: 'HEADLESS_STATE_UPDATE',
              headlessState: buildHeadlessPopupState(),
              watchTogetherState: buildWatchTogetherPopupState(),
            });
          }
          return true;
        }

        if (message.type === 'WATCH_TOGETHER_JOIN_ROOM') {
          const token = message.accessToken || getAuthToken();
          if (message.roomCode && token) {
            handleJoinWatchTogetherRoom(message.roomCode, token).then(() => {
              sendResponse({
                type: 'HEADLESS_STATE_UPDATE',
                headlessState: buildHeadlessPopupState(),
                watchTogetherState: buildWatchTogetherPopupState(),
              });
            });
          } else {
            sendResponse({
              type: 'HEADLESS_STATE_UPDATE',
              headlessState: buildHeadlessPopupState(),
              watchTogetherState: buildWatchTogetherPopupState(),
            });
          }
          return true;
        }

        if (message.type === 'WATCH_TOGETHER_LEAVE_ROOM') {
          handleLeaveWatchTogetherRoom().then(() => {
            sendResponse({
              type: 'HEADLESS_STATE_UPDATE',
              headlessState: buildHeadlessPopupState(),
              watchTogetherState: buildWatchTogetherPopupState(),
            });
          });
          return true;
        }

        if (message.type === 'WATCH_TOGETHER_GET_STATE') {
          sendResponse({
            type: 'HEADLESS_STATE_UPDATE',
            headlessState: buildHeadlessPopupState(),
            watchTogetherState: buildWatchTogetherPopupState(),
          });
          return true;
        }

        if (message.type === 'SIGN_OUT') {
          clearAuthToken().then(() => {
            sendResponse(buildPopupStateResponse());
          });
          return true;
        }

        if (message.type === 'GET_AUTH_TOKEN') {
          fetchAuthTokenFromDesktop().then(() => {
            sendResponse(buildPopupStateResponse());
          });
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
let geometryAbortController: AbortController | null = null;

function handleVideoState(state: VideoState, meta?: { url: string; title: string }, _tabId?: number): void {
  lastVideoState = state;
  notifyPopupOfState();

  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }

  syncDebounceTimer = setTimeout(() => {
    if (isHeadlessEnabled()) {
      handleHeadlessVideoStateUpdate(state);
    } else {
      forwardVideoState(state, meta);
    }
  }, SYNC_DEBOUNCE_MS);
}

function handleGeometryUpdate(geometry: { x: number; y: number; width: number; height: number; isFullscreen: boolean }): void {
  if (isHeadlessEnabled()) {
    return;
  }

  pendingGeometry = geometry;

  if (geometryDebounceTimer) {
    clearTimeout(geometryDebounceTimer);
  }

  geometryDebounceTimer = setTimeout(() => {
    if (pendingGeometry) {
      if (geometryAbortController) {
        geometryAbortController.abort();
      }
      geometryAbortController = new AbortController();
      forwardGeometry(pendingGeometry, geometryAbortController.signal);
      pendingGeometry = null;
    }
  }, GEOMETRY_DEBOUNCE_MS);
}

async function forwardGeometry(geometry: { x: number; y: number; width: number; height: number; isFullscreen: boolean }, signal?: AbortSignal): Promise<void> {
  if (status === 'disconnected') {
    return;
  }

  try {
    const response = await fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-geometry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geometry),
      signal,
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
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    handleConnectionError();
  }
}

async function forwardVideoScreenshot(dataUrl: string, timestamp: number): Promise<void> {
  if (status === 'disconnected') {
    return;
  }

  try {
    await fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-video-screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dataUrl, timestamp }),
    });
  } catch {
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
      videoSrc: state.src,
    };
    const response = await fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-sync`, {
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
  if (isHeadlessEnabled()) {
    console.log('[mLearn:bg] forwardSubtitleTracks: skipped, headless enabled');
    return;
  }

  if (status === 'disconnected') {
    console.log('[mLearn:bg] forwardSubtitleTracks: skipped, disconnected');
    return;
  }

  try {
    console.log('[mLearn:bg] forwardSubtitleTracks: sending', message.textTracks.length, 'textTracks');
    await fetchWithTimeout(`${MLEARN_BASE_URL}/api/overlay-subtitles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: message.tracks,
        textTracks: message.textTracks,
        url: message.url,
        timestamp: message.timestamp,
      }),
    });
    console.log('[mLearn:bg] forwardSubtitleTracks: sent successfully');
  } catch (err) {
    console.log('[mLearn:bg] forwardSubtitleTracks: failed', err);
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
    const response = await fetchWithTimeout(`${MLEARN_BASE_URL}/api/ping`, {
      method: 'GET',
    });

    if (response.ok) {
      retryDelay = INITIAL_RETRY_DELAY_MS;
      if (status !== 'connected') {
        setConnectionStatus('connected');
        await fetchAuthTokenFromDesktop();
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
    const response = await fetchWithTimeout(`${MLEARN_BASE_URL}/api/command-poll`, {
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

  cleanupRoomConnection();

  chrome.alarms.clear(PING_ALARM_NAME);
  chrome.alarms.clear(COMMAND_POLL_ALARM_NAME);
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
void initHeadlessMode();
