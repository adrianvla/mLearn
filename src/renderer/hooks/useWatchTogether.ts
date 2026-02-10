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

import { createSignal, onCleanup } from 'solid-js';

export interface WatchTogetherMessage {
  action: string;
  time?: number;
  url?: string;
  video_playing?: boolean;
  subtitle?: string;
  size?: number;
  weight?: number;
}

interface UseWatchTogetherOptions {
  /** Returns the HTMLVideoElement to control, or null when not available. */
  getVideo: () => HTMLVideoElement | null;
  /** Returns the current video source URL (for request-response). */
  getVideoSrc: () => string;
}

export function useWatchTogether(options: UseWatchTogetherOptions) {
  const [isActive, setIsActive] = createSignal(false);
  const cleanups: Array<() => void> = [];

  // ---------------------------------------------------------------------------
  // IPC listeners — registered once and cleaned up on unmount
  // ---------------------------------------------------------------------------

  if (window.mLearnIPC) {
    // When the main process confirms watch-together is available, activate.
    cleanups.push(
      window.mLearnIPC.onWatchTogetherLaunch(() => {
        setIsActive(true);
      }),
    );

    // Incoming messages from tethered clients (forwarded by the web server).
    cleanups.push(
      window.mLearnIPC.onWatchTogetherRequest((raw: unknown) => {
        if (typeof raw === 'string') {
          handleIncomingMessage(raw);
        }
      }),
    );
  }

  onCleanup(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  });

  // ---------------------------------------------------------------------------
  // Activate / deactivate
  // ---------------------------------------------------------------------------

  /** Call once to tell the main process we want watch-together mode. */
  function activate(): void {
    window.mLearnIPC?.isWatchingTogether();
    setIsActive(true);
  }

  /** Deactivate watch-together — stop broadcasting. */
  function deactivate(): void {
    setIsActive(false);
  }

  /** Toggle watch-together on/off. */
  function toggle(): void {
    if (isActive()) deactivate();
    else activate();
  }

  // ---------------------------------------------------------------------------
  // Outgoing — broadcast local video events to all connected clients
  // ---------------------------------------------------------------------------

  function send(msg: WatchTogetherMessage): void {
    if (!isActive()) return;
    window.mLearnIPC?.watchTogetherSend(JSON.stringify(msg));
  }

  /** Call when the local video starts playing. */
  function sendPlay(time: number): void {
    send({ action: 'play', time });
  }

  /** Call when the local video is paused. */
  function sendPause(time: number): void {
    send({ action: 'pause', time });
  }

  /** Call when the user seeks. */
  function sendSync(time: number): void {
    send({ action: 'sync', time });
  }

  /**
   * Broadcast current subtitle HTML so that tethered clients without their
   * own subtitles can display the desktop's rendered text.
   */
  function sendSubtitles(html: string, size: number, weight: number): void {
    send({ action: 'subtitles', subtitle: html, size, weight });
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
    } catch {
      return;
    }

    // When not active only respond to new-client sync requests so that
    // tethered browsers can still get the desktop's state on connect.
    if (!isActive()) {
      if (!msg.action) {
        // Empty `{}` from a newly connected client — send current state.
        const video = options.getVideo();
        if (video) {
          // Send directly via IPC even though isActive() is false.
          window.mLearnIPC?.watchTogetherSend(JSON.stringify({
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
    /** Whether watch-together mode is currently active. */
    isActive,
    /** Activate watch-together mode (notifies main process). */
    activate,
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
    /** True while applying a remote command — suppress re-broadcast. */
    get isSuppressed() { return suppressEvents; },
  };
}
