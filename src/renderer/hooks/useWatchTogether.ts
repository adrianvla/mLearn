/**
 * Watch Together Hook
 *
 * Two modes:
 * 1. **Local** — Desktop broadcasts to tethered browser clients via WebSocket
 *    (port 7753) through the Electron web server.
 * 2. **Room** (owner / viewer) — Peers connect via WebRTC (SimplePeer) with
 *    signaling relayed through the BFF Worker Durable Object WebSocket.
 *    Playback sync and media distribution flow over WebRTC data channels.
 */

import { createMemo, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import {
  closeWatchTogetherRoom,
  leaveWatchTogetherRoom,
  type WatchTogetherRoomSession,
  type WatchTogetherRoomState,
} from '../services/watchTogetherRoomService';
import {
  createPeerService,
  type PeerDataMessage,
  type PeerServiceInstance,
  type SignalingSocket,
} from '../services/watchTogetherPeerService';
import {
  createMediaDistribution,
  type MediaDistributionInstance,
  type MediaOfferHandle,
  type MediaTransferMetadata,
} from '../services/mediaDistributionService';

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
  const [connectedPeerCount, setConnectedPeerCount] = createSignal(0);

  // Media distribution state exposed to UI
  const [mediaSendProgress, setMediaSendProgress] = createSignal(0);
  const [mediaReceiveProgress, setMediaReceiveProgress] = createSignal(0);
  const [isSendingMedia, setIsSendingMedia] = createSignal(false);
  const [isReceivingMedia, setIsReceivingMedia] = createSignal(false);
  const [pendingMediaOffer, setPendingMediaOffer] = createSignal<{ meta: MediaTransferMetadata; handle: MediaOfferHandle } | null>(null);
  const [mediaSendComplete, setMediaSendComplete] = createSignal(false);
  const [mediaReceiveResult, setMediaReceiveResult] = createSignal<{ file: Blob; meta: MediaTransferMetadata } | null>(null);
  const [receivedMediaUrl, setReceivedMediaUrl] = createSignal<{ url: string; title: string } | null>(null);
  const [roomClosedByHost, setRoomClosedByHost] = createSignal(false);

  const cleanups: Array<() => void> = [];
  const isActive = createMemo(() => mode() !== 'inactive');
  const canControl = createMemo(() => mode() === 'local' || mode() === 'room-owner');
  const isRoomMode = createMemo(() => mode() === 'room-owner' || mode() === 'room-viewer');

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
  // WebRTC peer service + media distribution
  // ---------------------------------------------------------------------------

  let roomAccessToken = '';
  let peerServiceRef: PeerServiceInstance | null = null;
  let mediaDistRef: MediaDistributionInstance | null = null;
  let latestSubtitleState: RemoteSubtitleState | null = null;

  function handlePeerDataMessage(_fromUserId: string, message: PeerDataMessage): void {
    // Route media-related messages to the media distribution service
    if (message.type.startsWith('media-')) {
      mediaDistRef?.handleDataMessage(_fromUserId, message);
      return;
    }

    // Sync messages — only applied when in viewer mode
    if (mode() !== 'room-viewer') return;

    const video = options.getVideo();
    if (!video) return;

    switch (message.type) {
      case 'sync-state': {
        // Notify UI of new media URL so it can load the video
        if (message.mediaUrl) {
          const current = receivedMediaUrl();
          if (!current || current.url !== message.mediaUrl) {
            setReceivedMediaUrl({ url: message.mediaUrl, title: message.mediaTitle });
          }
        }
        suppressEvents = true;
        if (Math.abs(video.currentTime - message.currentTime) > 0.75) {
          video.currentTime = message.currentTime;
        }
        if (Math.abs(video.playbackRate - message.playbackRate) > 0.01) {
          video.playbackRate = message.playbackRate;
        }
        if (message.paused) {
          video.pause();
          suppressEvents = false;
        } else {
          video.play().finally(() => { suppressEvents = false; });
        }
        if (message.subtitlesHtml) {
          setRemoteSubtitle({
            html: message.subtitlesHtml,
            size: message.subtitleSize ?? 32,
            weight: message.subtitleWeight ?? 700,
          });
        } else {
          setRemoteSubtitle(null);
        }
        break;
      }

      case 'sync-play':
        suppressEvents = true;
        if (message.time !== undefined) video.currentTime = message.time;
        video.play().finally(() => { suppressEvents = false; });
        break;

      case 'sync-pause':
        suppressEvents = true;
        if (message.time !== undefined) video.currentTime = message.time;
        video.pause();
        suppressEvents = false;
        break;

      case 'sync-seek':
        suppressEvents = true;
        if (message.time !== undefined) video.currentTime = message.time;
        suppressEvents = false;
        break;

      case 'sync-subtitles':
        setRemoteSubtitle({ html: message.html, size: message.size, weight: message.weight });
        break;
    }
  }

  function setupPeerService(session: WatchTogetherRoomSession, accessToken: string, localUserId: string): void {
    const signalingConfig: SignalingSocket = {
      url: session.socket.url,
      protocol: session.socket.protocol,
      accessToken,
    };

    const peerService = createPeerService(signalingConfig, localUserId, {
      onPeerConnected: () => {
        setConnectedPeerCount(peerServiceRef?.getConnectedPeerIds().length ?? 0);

        // When a new peer connects and we're the owner, send the current state
        if (mode() === 'room-owner') {
          sendFullState();
        }
      },
      onPeerDisconnected: () => {
        setConnectedPeerCount(peerServiceRef?.getConnectedPeerIds().length ?? 0);
      },
      onDataMessage: handlePeerDataMessage,
      onBinaryChunk: (fromUserId, chunkType, chunkIndex, data) => {
        mediaDistRef?.handleBinaryChunk(fromUserId, chunkType, chunkIndex, data);
      },
      onSignalingError: (error) => {
        if (error === 'room-closed') {
          setRoomClosedByHost(true);
          deactivate();
          return;
        }
        console.error('[WatchTogether] Signaling error:', error);
      },
    });

    peerServiceRef = peerService;

    // Set up media distribution
    mediaDistRef = createMediaDistribution(peerService, {
      onSendProgress: (progress) => setMediaSendProgress(progress),
      onSendComplete: () => {
        setIsSendingMedia(false);
        setMediaSendComplete(true);
      },
      onSendError: (error) => {
        console.error('[WatchTogether] Media send error:', error);
        setIsSendingMedia(false);
      },
    }, {
      onOffer: (meta, handle) => {
        setPendingMediaOffer({ meta, handle });
      },
      onReceiveProgress: (progress) => setMediaReceiveProgress(progress),
      onReceiveComplete: (file, meta) => {
        setIsReceivingMedia(false);
        setMediaReceiveResult({ file, meta });
      },
      onReceiveError: (error) => {
        console.error('[WatchTogether] Media receive error:', error);
        setIsReceivingMedia(false);
      },
    });
  }

  function sendFullState(): void {
    if (!peerServiceRef || mode() !== 'room-owner') return;

    const video = options.getVideo();
    const payload: PeerDataMessage = {
      type: 'sync-state',
      mediaUrl: options.getVideoSrc(),
      mediaTitle: options.getVideoTitle?.() || '',
      currentTime: video?.currentTime ?? 0,
      paused: video?.paused ?? true,
      playbackRate: video?.playbackRate ?? 1,
      subtitlesHtml: latestSubtitleState?.html ?? null,
      subtitleSize: latestSubtitleState?.size ?? null,
      subtitleWeight: latestSubtitleState?.weight ?? null,
    };

    peerServiceRef.sendToAll(payload);
  }

  // ---------------------------------------------------------------------------
  // Room state helpers (kept for room metadata, not for real-time sync)
  // ---------------------------------------------------------------------------

  function extractRemoteSubtitle(nextRoomState: WatchTogetherRoomState): RemoteSubtitleState | null {
    if (!nextRoomState.subtitlesHtml) return null;
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
    mediaDistRef?.destroy();
    mediaDistRef = null;
    peerServiceRef?.destroy();
    peerServiceRef = null;
    roomAccessToken = '';
    latestSubtitleState = null;
    setRoomSession(null);
    setRoomState(null);
    setRemoteSubtitle(null);
    setConnectedPeerCount(0);
    resetMediaState();
  }

  function resetMediaState(): void {
    setMediaSendProgress(0);
    setMediaReceiveProgress(0);
    setIsSendingMedia(false);
    setIsReceivingMedia(false);
    setPendingMediaOffer(null);
    setMediaSendComplete(false);
    setMediaReceiveResult(null);
    setReceivedMediaUrl(null);
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

  // ---------------------------------------------------------------------------
  // Activate / deactivate
  // ---------------------------------------------------------------------------

  function activate(): void {
    cleanupRoomConnection();
    bridge.watchTogether.isWatchingTogether();
    setMode('local');
  }

  function activateRoomWithUserId(session: WatchTogetherRoomSession, accessToken: string, localUserId: string): void {
    const previousMode = mode();
    const previousSession = roomSession();
    const previousAccessToken = roomAccessToken;

    cleanupRoomConnection();
    releaseRoomSession(previousMode, previousSession, previousAccessToken, 'while switching rooms');
    roomAccessToken = accessToken;
    setRoomSession(session);
    applyRoomState(session.room);
    setMode(session.canControl ? 'room-owner' : 'room-viewer');

    setupPeerService(session, accessToken, localUserId);
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

  async function runSuppressed(task: () => void | Promise<void>): Promise<void> {
    suppressEvents = true;
    try {
      await task();
    } finally {
      suppressEvents = false;
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
    if (mode() === 'room-owner' && peerServiceRef) {
      peerServiceRef.sendToAll({ type: 'sync-play', time });
    }
  }

  function sendPause(time: number): void {
    if (mode() === 'local') {
      send({ action: 'pause', time });
      return;
    }
    if (mode() === 'room-owner' && peerServiceRef) {
      peerServiceRef.sendToAll({ type: 'sync-pause', time });
    }
  }

  function sendSync(time: number): void {
    if (mode() === 'local') {
      send({ action: 'sync', time });
      return;
    }
    if (mode() === 'room-owner' && peerServiceRef) {
      peerServiceRef.sendToAll({ type: 'sync-seek', time });
    }
  }

  function sendSubtitles(html: string, size: number, weight: number): void {
    if (mode() === 'local') {
      send({ action: 'subtitles', subtitle: html, size, weight });
      return;
    }
    latestSubtitleState = { html, size, weight };
    if (mode() === 'room-owner' && peerServiceRef) {
      peerServiceRef.sendToAll({ type: 'sync-subtitles', html, size, weight });
    }
  }

  // ---------------------------------------------------------------------------
  // Media distribution
  // ---------------------------------------------------------------------------

  function startMediaDistribution(file: Blob, fileName: string, subtitleContent: string | null): void {
    if (!mediaDistRef) return;
    setIsSendingMedia(true);
    setMediaSendProgress(0);
    setMediaSendComplete(false);
    mediaDistRef.startDistribution(file, fileName, subtitleContent);
  }

  function cancelMediaDistribution(): void {
    mediaDistRef?.cancelDistribution();
    setIsSendingMedia(false);
    setMediaSendProgress(0);
  }

  function acceptMediaOffer(): void {
    const offer = pendingMediaOffer();
    if (!offer) return;
    offer.handle.accept();
    setPendingMediaOffer(null);
    setIsReceivingMedia(true);
    setMediaReceiveProgress(0);
  }

  function rejectMediaOffer(): void {
    const offer = pendingMediaOffer();
    if (!offer) return;
    offer.handle.reject();
    setPendingMediaOffer(null);
  }

  function clearMediaReceiveResult(): void {
    setMediaReceiveResult(null);
  }

  function clearRoomClosedByHost(): void {
    setRoomClosedByHost(false);
  }

  function clearReceivedMediaUrl(): void {
    setReceivedMediaUrl(null);
  }

  // ---------------------------------------------------------------------------
  // Incoming — apply remote commands to the local video element (local mode)
  // ---------------------------------------------------------------------------

  let suppressEvents = false;

  function handleIncomingMessage(raw: string): void {
    let msg: WatchTogetherMessage;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error(e);
      return;
    }

    if (mode() !== 'local') {
      if (!msg.action) {
        if (mode() !== 'inactive') return;

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
    connectedPeerCount,
    activate,
    activateRoomWithUserId,
    deactivate,
    toggle,
    sendPlay,
    sendPause,
    sendSync,
    sendSubtitles,
    runSuppressed,
    get isSuppressed() { return suppressEvents; },

    // Media distribution
    isSendingMedia,
    isReceivingMedia,
    mediaSendProgress,
    mediaReceiveProgress,
    mediaSendComplete,
    mediaReceiveResult,
    pendingMediaOffer,
    startMediaDistribution,
    cancelMediaDistribution,
    acceptMediaOffer,
    rejectMediaOffer,
    clearMediaReceiveResult,
    receivedMediaUrl,
    roomClosedByHost,
    clearRoomClosedByHost,
    clearReceivedMediaUrl,
  };
}
