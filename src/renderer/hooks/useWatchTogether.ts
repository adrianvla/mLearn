/**
 * Watch Together Hook
 * Coordinates shared playback between the desktop app (master) and tethered
 * browser clients connected via WebSocket through the web server on port 7753.
 *
 * When active the desktop becomes a "Watch Together Master": play/pause/seek
 * events on the renderer's video element are broadcast to all connected
 * clients, and incoming commands from other masters are applied locally.
 *
 * Mirrors the feature set of the tethered core.js client.
 */

import { createMemo, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import {
  closeWatchTogetherRoom,
  leaveWatchTogetherRoom,
  subscribeToWatchTogetherRoom,
  updateWatchTogetherRoomState,
  type WatchTogetherRoomSession,
  type WatchTogetherRoomState,
  type WatchTogetherRoomUpdatePayload,
} from '../services/watchTogetherRoomService';

export interface WatchTogetherMessage {
  action: string;
  time?: number;
  url?: string;
  video_playing?: boolean;
  subtitle?: string;
  size?: number;
  weight?: number;
}

export interface RemoteSubtitleState {
  html: string;
  size: number;
  weight: number;
}

export type WatchTogetherMode = 'inactive' | 'local' | 'room-owner' | 'room-viewer';

interface UseWatchTogetherOptions {
  /** Returns the HTMLVideoElement to control, or null when not available. */
  getVideo: () => HTMLVideoElement | null;
  /** Returns the current video source URL (for request-response). */
  getVideoSrc: () => string;
  /** Returns the current media title for cloud room sync. */
  getVideoTitle?: () => string;
}

export function useWatchTogether(options: UseWatchTogetherOptions) {
  const [mode, setMode] = createSignal<WatchTogetherMode>('inactive');
  const [roomSession, setRoomSession] = createSignal<WatchTogetherRoomSession | null>(null);
  const [roomState, setRoomState] = createSignal<WatchTogetherRoomState | null>(null);
  const [remoteSubtitle, setRemoteSubtitle] = createSignal<RemoteSubtitleState | null>(null);
  const cleanups: Array<() => void> = [];
  const isActive = createMemo(() => mode() !== 'inactive');
  const canControl = createMemo(() => mode() === 'local' || mode() === 'room-owner');
  const isRoomMode = createMemo(() => mode() === 'room-owner' || mode() === 'room-viewer');

  // ---------------------------------------------------------------------------
  // IPC listeners — registered once and cleaned up on unmount
  // ---------------------------------------------------------------------------

  const bridge = getBridge();

  // When the main process confirms watch-together is available, activate.
  cleanups.push(
    bridge.watchTogether.onWatchTogetherLaunch(() => {
      if (mode() === 'inactive') {
        setMode('local');
      }
    }),
  );

  // Incoming messages from tethered clients (forwarded by the web server).
  cleanups.push(
    bridge.watchTogether.onWatchTogetherRequest((raw: unknown) => {
      if (typeof raw === 'string') {
        handleIncomingMessage(raw);
      }
    }),
  );

  onCleanup(() => {
    const session = roomSession();
    const accessToken = roomAccessToken;
    const activeMode = mode();

    cleanupRoomConnection();

    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;

    releaseRoomSession(activeMode, session, accessToken, 'during cleanup');
  });

  // ---------------------------------------------------------------------------
  // Activate / deactivate
  // ---------------------------------------------------------------------------

  let roomAccessToken = '';
  let roomCleanup: (() => void) | null = null;
  let latestSubtitleState: RemoteSubtitleState | null = null;

  function extractRemoteSubtitle(nextRoomState: WatchTogetherRoomState): RemoteSubtitleState | null {
    if (!nextRoomState.subtitlesHtml) {
      return null;
    }

    return {
      html: nextRoomState.subtitlesHtml,
      size: nextRoomState.subtitleSize ?? 32,
      weight: nextRoomState.subtitleWeight ?? 700,
    };
  }

  function applyRoomState(nextRoomState: WatchTogetherRoomState): void {
    setRoomState(nextRoomState);
    setRemoteSubtitle(extractRemoteSubtitle(nextRoomState));
    setRoomSession((current) => current ? { ...current, room: nextRoomState } : current);
  }

  function cleanupRoomConnection(): void {
    roomCleanup?.();
    roomCleanup = null;
    roomAccessToken = '';
    latestSubtitleState = null;
    setRoomSession(null);
    setRoomState(null);
    setRemoteSubtitle(null);
  }

  function releaseRoomSession(
    activeMode: WatchTogetherMode,
    session: WatchTogetherRoomSession | null,
    accessToken: string,
    context: string,
  ): void {
    if (!session || !accessToken) {
      return;
    }

    if (activeMode === 'room-owner') {
      void closeWatchTogetherRoom(session, accessToken).catch((error) => {
        console.error(`[WatchTogether] Failed to close room ${context}`, error);
      });
      return;
    }

    if (activeMode === 'room-viewer') {
      void leaveWatchTogetherRoom(session, accessToken).catch((error) => {
        console.error(`[WatchTogether] Failed to leave room ${context}`, error);
      });
    }
  }

  /** Call once to tell the main process we want local websocket watch-together mode. */
  function activate(): void {
    cleanupRoomConnection();
    bridge.watchTogether.isWatchingTogether();
    setMode('local');
  }

  function activateRoom(session: WatchTogetherRoomSession, accessToken: string): void {
    const previousMode = mode();
    const previousSession = roomSession();
    const previousAccessToken = roomAccessToken;

    cleanupRoomConnection();
    releaseRoomSession(previousMode, previousSession, previousAccessToken, 'while switching rooms');
    roomAccessToken = accessToken;
    setRoomSession(session);
    applyRoomState(session.room);
    setMode(session.canControl ? 'room-owner' : 'room-viewer');

    roomCleanup = subscribeToWatchTogetherRoom(session, accessToken, (nextRoomState) => {
      applyRoomState(nextRoomState);
    });
  }

  /** Deactivate watch-together — stop broadcasting. */
  function deactivate(): void {
    const activeMode = mode();
    const session = roomSession();
    const accessToken = roomAccessToken;

    setMode('inactive');
    cleanupRoomConnection();
    releaseRoomSession(activeMode, session, accessToken, 'during manual disconnect');
  }

  /** Toggle watch-together on/off. */
  function toggle(): void {
    if (isActive()) deactivate();
    else activate();
  }

  async function runSuppressed(task: () => void | Promise<void>): Promise<void> {
    suppressEvents = true;
    try {
      await task();
    } finally {
      suppressEvents = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Outgoing — broadcast local video events to all connected clients
  // ---------------------------------------------------------------------------

  function send(msg: WatchTogetherMessage): void {
    if (mode() !== 'local') return;
    bridge.watchTogether.watchTogetherSend(JSON.stringify(msg));
  }

  function buildRoomUpdatePayload(overrides: Partial<WatchTogetherRoomUpdatePayload>): WatchTogetherRoomUpdatePayload | null {
    const currentRoomState = roomState();
    const video = options.getVideo();
    const mediaUrl = overrides.mediaUrl ?? options.getVideoSrc();

    if (!mediaUrl) {
      return null;
    }

    const fallbackTitle = options.getVideoTitle?.() || currentRoomState?.mediaTitle || '';

    return {
      mediaUrl,
      mediaTitle: overrides.mediaTitle ?? fallbackTitle,
      currentTime: overrides.currentTime ?? video?.currentTime ?? currentRoomState?.currentTime ?? 0,
      paused: overrides.paused ?? video?.paused ?? currentRoomState?.paused ?? true,
      playbackRate: overrides.playbackRate ?? video?.playbackRate ?? currentRoomState?.playbackRate ?? 1,
      subtitlesHtml: overrides.subtitlesHtml ?? latestSubtitleState?.html ?? currentRoomState?.subtitlesHtml ?? null,
      subtitleSize: overrides.subtitleSize ?? latestSubtitleState?.size ?? currentRoomState?.subtitleSize ?? null,
      subtitleWeight: overrides.subtitleWeight ?? latestSubtitleState?.weight ?? currentRoomState?.subtitleWeight ?? null,
    };
  }

  function syncRoomState(overrides: Partial<WatchTogetherRoomUpdatePayload>): void {
    if (mode() !== 'room-owner') return;

    const session = roomSession();
    if (!session || !roomAccessToken) return;

    const payload = buildRoomUpdatePayload(overrides);
    if (!payload) return;

    void updateWatchTogetherRoomState(session, roomAccessToken, payload)
      .then((nextSession) => {
        setRoomSession(nextSession);
        applyRoomState(nextSession.room);
      })
      .catch((error) => {
        console.error('[WatchTogether] Failed to update room state', error);
      });
  }

  /** Call when the local video starts playing. */
  function sendPlay(time: number): void {
    if (mode() === 'local') {
      send({ action: 'play', time });
      return;
    }

    syncRoomState({ currentTime: time, paused: false });
  }

  /** Call when the local video is paused. */
  function sendPause(time: number): void {
    if (mode() === 'local') {
      send({ action: 'pause', time });
      return;
    }

    syncRoomState({ currentTime: time, paused: true });
  }

  /** Call when the user seeks. */
  function sendSync(time: number): void {
    if (mode() === 'local') {
      send({ action: 'sync', time });
      return;
    }

    syncRoomState({ currentTime: time });
  }

  /**
   * Broadcast current subtitle HTML so that tethered clients without their
   * own subtitles can display the desktop's rendered text.
   */
  function sendSubtitles(html: string, size: number, weight: number): void {
    if (mode() === 'local') {
      send({ action: 'subtitles', subtitle: html, size, weight });
      return;
    }

    latestSubtitleState = { html, size, weight };
    syncRoomState({ subtitlesHtml: html, subtitleSize: size, subtitleWeight: weight });
  }

  // ---------------------------------------------------------------------------
  // Incoming — apply remote commands to the local video element
  // ---------------------------------------------------------------------------

  /**
   * Guard flag: while we are programmatically changing the video (e.g.
   * setting currentTime, calling play/pause), we suppress the event
   * listeners on the <video> so they don't re-broadcast back out.
   */
  let suppressEvents = false;

  function handleIncomingMessage(raw: string): void {
    let msg: WatchTogetherMessage;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error(e);
      return;
    }

    // Only local websocket mode responds to tethered browser sync requests.
    // When fully inactive, still respond to new-client sync requests so that
    // tethered browsers can still get the desktop's state on connect.
    if (mode() !== 'local') {
      if (!msg.action) {
        if (mode() !== 'inactive') {
          return;
        }

        // Empty `{}` from a newly connected client — send current state.
        const video = options.getVideo();
        if (video) {
          // Send directly via IPC even though isActive() is false.
          bridge.watchTogether.watchTogetherSend(JSON.stringify({
            action: 'request-response',
            url: options.getVideoSrc(),
            time: video.currentTime,
            video_playing: !video.paused,
          }));
        }
      }
      return;
    }

    const video = options.getVideo();

    switch (msg.action) {
      case 'play':
        if (video) {
          suppressEvents = true;
          if (msg.time !== undefined) video.currentTime = msg.time;
          video.play().finally(() => { suppressEvents = false; });
        }
        break;

      case 'pause':
        if (video) {
          suppressEvents = true;
          if (msg.time !== undefined) video.currentTime = msg.time;
          video.pause();
          suppressEvents = false;
        }
        break;

      case 'sync':
        if (video && msg.time !== undefined) {
          suppressEvents = true;
          video.currentTime = msg.time;
          suppressEvents = false;
        }
        break;

      case 'request-response':
        // Another master sent current state — apply it locally.
        if (video && msg.time !== undefined) {
          suppressEvents = true;
          video.currentTime = msg.time;
          if (msg.video_playing) {
            video.play().finally(() => { suppressEvents = false; });
          } else {
            suppressEvents = false;
          }
        }
        break;

      // A new WS client just connected and sent an empty `{}` — respond
      // with the desktop's current state so the client can sync up.
      default:
        if (video) {
          send({
            action: 'request-response',
            url: options.getVideoSrc(),
            time: video.currentTime,
            video_playing: !video.paused,
          });
        }
        break;
    }
  }

  return {
    mode,
    /** Whether watch-together mode is currently active. */
    isActive,
    /** Whether the current mode is a cloud room mode. */
    isRoomMode,
    /** Whether the current user can control the shared playback state. */
    canControl,
    /** Current cloud room session metadata, if any. */
    roomSession,
    /** Latest room state received or sent through the cloud room mode. */
    roomState,
    /** Latest remote subtitle HTML mirrored from the room host. */
    remoteSubtitle,
    /** Activate watch-together mode (notifies main process). */
    activate,
    /** Activate Supabase-backed room-code mode. */
    activateRoom,
    /** Deactivate watch-together mode. */
    deactivate,
    /** Toggle watch-together on/off. */
    toggle,
    /** Send play event — call from the video 'play' listener. */
    sendPlay,
    /** Send pause event — call from the video 'pause' listener. */
    sendPause,
    /** Send sync event — call from the video 'seeked' listener. */
    sendSync,
    /** Broadcast current subtitle HTML to tethered clients. */
    sendSubtitles,
    /** Run video mutations without rebroadcasting them back out. */
    runSuppressed,
    /** True while applying a remote command — suppress re-broadcast. */
    get isSuppressed() { return suppressEvents; },
  };
}
