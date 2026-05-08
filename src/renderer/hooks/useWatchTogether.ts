/**
 * Watch Together Hook
 *
 * Two modes:
 * 1. **Local** — Desktop broadcasts to tethered browser clients via WebSocket
 *    (port 7753) through the Electron web server.
 * 2. **Room** (owner / viewer) — Room state is synced via Worker WebSocket.
 *    The Worker broadcasts room-state messages to all connected clients.
 */

import { createMemo, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import {
  closeWatchTogetherRoom,
  leaveWatchTogetherRoom,
  updateWatchTogetherRoomState,
  subscribeToWatchTogetherRoom,
  type WatchTogetherRoomSession,
  type WatchTogetherRoomState,
} from '../services/watchTogetherRoomService';
import { getLogger } from '../../shared/utils/logger';
import { showToast, updateToast } from '../components/common/Feedback/Toast';
import { useLocalization } from '../context';

const log = getLogger("renderer.hooks.useWatchTogether");

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
  /** Called when a remote play command is received and no local video element is available. */
  onReceivePlay?: (time: number) => void;
  /** Called when a remote pause command is received and no local video element is available. */
  onReceivePause?: (time: number) => void;
  /** Called when a remote seek command is received and no local video element is available. */
  onReceiveSeek?: (time: number) => void;
  /** When true, the hook runs in overlay mode and skips video element time checks. */
  isOverlay?: boolean;
  /** Returns the current playback time when in overlay mode. */
  getCurrentTime?: () => number;
}

export function useWatchTogether(options: UseWatchTogetherOptions) {
  const { t } = useLocalization();
  const [mode, setMode] = createSignal<WatchTogetherMode>('inactive');
  const [roomSession, setRoomSession] = createSignal<WatchTogetherRoomSession | null>(null);
  const [roomState, setRoomState] = createSignal<WatchTogetherRoomState | null>(null);
  const [remoteSubtitle, setRemoteSubtitle] = createSignal<RemoteSubtitleState | null>(null);
  const [peerCount, setPeerCount] = createSignal<number>(0);

  const cleanups: Array<() => void> = [];
  const isActive = createMemo(() => mode() !== 'inactive');
  const canControl = createMemo(() => mode() === 'local' || mode() === 'room-owner');
  const isRoomMode = createMemo(() => mode() === 'room-owner' || mode() === 'room-viewer');

  let peerJoinToastId: number | null = null;

  // ---------------------------------------------------------------------------
  // IPC listeners — registered once and cleaned up on unmount
  // ---------------------------------------------------------------------------

  const bridge = getBridge();

  cleanups.push(
    bridge.watchTogether.onWatchTogetherLaunch(() => {
      if (mode() === 'inactive') {
        setMode('local');
      }
    }),
  );

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
  // Room state helpers
  // ---------------------------------------------------------------------------

  let roomAccessToken = '';
  let unsubscribeRealtimeRef: (() => void) | null = null;

  function applyRoomState(nextRoomState: WatchTogetherRoomState): void {
    const currentRoomState = roomState();
    if (
      currentRoomState
      && currentRoomState.roomId === nextRoomState.roomId
      && currentRoomState.stateVersion > nextRoomState.stateVersion
    ) {
      return;
    }

    setRoomState(nextRoomState);
    setRoomSession((current) => current ? { ...current, room: nextRoomState } : current);
  }

  async function persistRoomPlaybackState(
    currentTime: number,
    paused: boolean,
    playbackRate: number,
    subtitleHtml?: string,
    subtitleSize?: number,
    subtitleWeight?: number,
    mediaUrl?: string,
    mediaTitle?: string,
  ): Promise<void> {
    if (mode() !== 'room-owner') {
      return;
    }

    const session = roomSession();
    if (!session?.actions.update_state || !roomAccessToken) {
      return;
    }

    try {
      const payload: {
        currentTime: number;
        paused: boolean;
        playbackRate: number;
        subtitleHtml?: string;
        subtitleSize?: number;
        subtitleWeight?: number;
        mediaUrl?: string;
        mediaTitle?: string;
      } = {
        currentTime,
        paused,
        playbackRate,
      };
      if (subtitleHtml !== undefined) {
        payload.subtitleHtml = subtitleHtml;
        payload.subtitleSize = subtitleSize;
        payload.subtitleWeight = subtitleWeight;
      }
      if (mediaUrl !== undefined) {
        payload.mediaUrl = mediaUrl;
      }
      if (mediaTitle !== undefined) {
        payload.mediaTitle = mediaTitle;
      }
      const updatedSession = await updateWatchTogetherRoomState(session, roomAccessToken, payload);
      applyRoomState(updatedSession.room);
    } catch (error) {
      log.error('[WatchTogether] Failed to persist room playback state', error);
    }
  }

  function cleanupRoomConnection(): void {
    unsubscribeRealtimeRef?.();
    unsubscribeRealtimeRef = null;
    roomAccessToken = '';
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
    if (!session || !accessToken) return;

    if (activeMode === 'room-owner') {
      void closeWatchTogetherRoom(session, accessToken).catch((error) => {
        log.error(`[WatchTogether] Failed to close room ${context}`, error);
      });
      return;
    }

    if (activeMode === 'room-viewer') {
      void leaveWatchTogetherRoom(session, accessToken).catch((error) => {
        log.error(`[WatchTogether] Failed to leave room ${context}`, error);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Activate / deactivate
  // ---------------------------------------------------------------------------

  function activate(): void {
    cleanupRoomConnection();
    bridge.watchTogether.isWatchingTogether();
    setMode('local');
  }

  function activateRoomWithUserId(session: WatchTogetherRoomSession, accessToken: string, _localUserId: string): void {
    const previousMode = mode();
    const previousSession = roomSession();
    const previousAccessToken = roomAccessToken;

    cleanupRoomConnection();
    releaseRoomSession(previousMode, previousSession, previousAccessToken, 'while switching rooms');
    roomAccessToken = accessToken;
    setRoomSession(session);
    applyRoomState(session.room);
    setMode(session.canControl ? 'room-owner' : 'room-viewer');

    unsubscribeRealtimeRef = subscribeToWatchTogetherRoom(
      session,
      accessToken,
      (nextState) => {
        applyRoomState(nextState);
        setPeerCount(nextState.peerCount ?? 0);

        if (mode() === 'room-viewer') {
          // Handle subtitles
          if (nextState.subtitleHtml) {
            setRemoteSubtitle({
              html: nextState.subtitleHtml,
              size: nextState.subtitleSize ?? 32,
              weight: nextState.subtitleWeight ?? 700,
            });
          } else {
            setRemoteSubtitle(null);
          }
          // Sync video
          if (!options.isOverlay) {
            const video = options.getVideo();
            if (video) {
              runSuppressed(() => {
                if (Math.abs(video.currentTime - nextState.currentTime) > 0.75) {
                  video.currentTime = nextState.currentTime;
                }
                if (Math.abs(video.playbackRate - nextState.playbackRate) > 0.01) {
                  video.playbackRate = nextState.playbackRate;
                }
                if (nextState.paused) {
                  video.pause();
                } else {
                  void video.play().catch(() => {});
                }
              });
            }
          } else {
            options.onReceiveSeek?.(nextState.currentTime);
            if (nextState.paused) {
              options.onReceivePause?.(nextState.currentTime);
            } else {
              options.onReceivePlay?.(nextState.currentTime);
            }
          }
        }

        // Handle room closed
        if (nextState.status === 'closed') {
          deactivate();
        }
      },
      (event) => {
        if (event.type === 'joined') {
          setPeerCount(event.room.peerCount ?? 0);
          if (mode() === 'room-owner') {
            const count = event.room.peerCount ?? 0;
            const message = count === 1
              ? t('mlearn.WatchTogether.Code.PeerJoinedSingular')
              : t('mlearn.WatchTogether.Code.PeerJoinedPlural').replace('{count}', String(count));
            if (peerJoinToastId !== null) {
              updateToast(peerJoinToastId, { message, variant: 'info' });
            } else {
              peerJoinToastId = showToast({
                message,
                variant: 'info',
                duration: 5000,
              });
              setTimeout(() => {
                peerJoinToastId = null;
              }, 5500);
            }
          }
        } else if (event.type === 'left') {
          setPeerCount(event.room.peerCount ?? 0);
        }
      },
    );
  }

  function deactivate(): void {
    const activeMode = mode();
    const session = roomSession();
    const accessToken = roomAccessToken;

    setMode('inactive');
    cleanupRoomConnection();
    releaseRoomSession(activeMode, session, accessToken, 'during manual disconnect');
  }

  function toggle(): void {
    if (isActive()) deactivate();
    else activate();
  }

  // Reentrant suppressEvents using a counter instead of a boolean
  let suppressCount = 0;

  function runSuppressed(task: () => void | Promise<void>): void {
    suppressCount++;
    const result = task();
    if (result && typeof result.then === 'function') {
      result.finally(() => { suppressCount--; });
    } else {
      suppressCount--;
    }
  }

  // ---------------------------------------------------------------------------
  // Outgoing — broadcast local video events
  // ---------------------------------------------------------------------------

  function send(msg: WatchTogetherMessage): void {
    if (mode() !== 'local') return;
    bridge.watchTogether.watchTogetherSend(JSON.stringify(msg));
  }

  function sendPlay(time: number): void {
    if (mode() === 'local') {
      send({ action: 'play', time });
      return;
    }
    if (mode() === 'room-owner') {
      void persistRoomPlaybackState(time, false, options.getVideo()?.playbackRate ?? roomState()?.playbackRate ?? 1);
    }
  }

  function sendPause(time: number): void {
    if (mode() === 'local') {
      send({ action: 'pause', time });
      return;
    }
    if (mode() === 'room-owner') {
      void persistRoomPlaybackState(time, true, options.getVideo()?.playbackRate ?? roomState()?.playbackRate ?? 1);
    }
  }

  function sendSync(time: number): void {
    if (mode() === 'local') {
      send({ action: 'sync', time });
      return;
    }
    if (mode() === 'room-owner') {
      void persistRoomPlaybackState(
        time,
        options.getVideo()?.paused ?? roomState()?.paused ?? true,
        options.getVideo()?.playbackRate ?? roomState()?.playbackRate ?? 1,
        undefined,
        undefined,
        undefined,
        options.getVideoSrc(),
        options.getVideoTitle?.(),
      );
    }
  }

  function sendSubtitles(html: string, size: number, weight: number): void {
    if (mode() === 'local') {
      send({ action: 'subtitles', subtitle: html, size, weight });
      return;
    }
    if (mode() === 'room-owner') {
      const video = options.isOverlay ? null : options.getVideo();
      void persistRoomPlaybackState(
        options.isOverlay
          ? (options.getCurrentTime?.() ?? 0)
          : (video?.currentTime ?? roomState()?.currentTime ?? 0),
        video ? video.paused : (roomState()?.paused ?? true),
        video?.playbackRate ?? roomState()?.playbackRate ?? 1,
        html,
        size,
        weight,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Incoming — apply remote commands to the local video element (local mode)
  // ---------------------------------------------------------------------------

  function handleIncomingMessage(raw: string): void {
    let msg: WatchTogetherMessage;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      log.error("error", e);
      return;
    }

    if (mode() !== 'local') {
      if (!msg.action) {
        if (mode() !== 'inactive') return;

        if (options.isOverlay) {
          bridge.watchTogether.watchTogetherSend(JSON.stringify({
            action: 'request-response',
            url: options.getVideoSrc(),
            time: options.getCurrentTime?.() ?? 0,
            video_playing: false,
          }));
          return;
        }

        const video = options.getVideo();
        if (video) {
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

    if (options.isOverlay) {
      switch (msg.action) {
        case 'play':
          if (msg.time !== undefined) options.onReceivePlay?.(msg.time);
          break;
        case 'pause':
          if (msg.time !== undefined) options.onReceivePause?.(msg.time);
          break;
        case 'sync':
          if (msg.time !== undefined) options.onReceiveSeek?.(msg.time);
          break;
        case 'request-response':
          if (msg.time !== undefined) {
            options.onReceiveSeek?.(msg.time);
            if (msg.video_playing) {
              options.onReceivePlay?.(msg.time);
            } else {
              options.onReceivePause?.(msg.time);
            }
          }
          break;
        default:
          break;
      }
      return;
    }

    const video = options.getVideo();

    switch (msg.action) {
      case 'play':
        if (video) {
          runSuppressed(() => {
            if (msg.time !== undefined) video.currentTime = msg.time;
            return video.play().catch(() => {});
          });
        }
        break;

      case 'pause':
        if (video) {
          runSuppressed(() => {
            if (msg.time !== undefined) video.currentTime = msg.time;
            video.pause();
          });
        }
        break;

      case 'sync': {
        const syncTime = msg.time;
        if (video && syncTime !== undefined) {
          runSuppressed(() => {
            video.currentTime = syncTime;
          });
        }
        break;
      }

      case 'request-response': {
        const reqTime = msg.time;
        if (video && reqTime !== undefined) {
          runSuppressed(() => {
            video.currentTime = reqTime;
            if (msg.video_playing) {
              void video.play().catch(() => {});
            }
          });
        }
        break;
      }

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
    isActive,
    isRoomMode,
    canControl,
    roomSession,
    roomState,
    remoteSubtitle,
    peerCount,
    activate,
    activateRoomWithUserId,
    deactivate,
    toggle,
    sendPlay,
    sendPause,
    sendSync,
    sendSubtitles,
    runSuppressed,
    get isSuppressed() { return suppressCount > 0; },
  };
}
