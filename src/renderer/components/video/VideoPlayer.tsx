/**
 * Video Player Component
 * Main video player with controls and subtitle overlay
 */

import { Component, JSX, Show, createEffect, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { useVideo, useVideoKeyboard, useCursorVisibility } from '../../hooks';
import type { MediaUsageEventContext } from '../../../shared/types';
import type { useSubtitles } from '../../hooks';
import { useVideoTouch } from '../../hooks/useVideoTouch';
import { useLocalization, useSettings } from '../../context';
import { Button } from '../common';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { getLogger } from '../../../shared/utils/logger';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { LiveWordTranslator } from '../subtitle/LiveWordTranslator';
import { VideoControls } from './VideoControls';
import './VideoPlayer.css';

const log = getLogger('renderer.video.player');
let nextPlayerId = 0;

export interface DetectedTrack {
  index: number;
  label: string;
  language: string | null;
}

export interface VideoPlayerProps {
  mediaUsageContext?: MediaUsageEventContext;
  onPlaybackStateChange?: (playing: boolean) => void;
  /** Video source URL */
  src?: string;
  /** Subtitle file content (SRT/VTT/ASS) */
  subtitleContent?: string;
  /** Mirrored subtitle HTML from a remote watch-together room host */
  remoteSubtitleHtml?: string | null;
  /** Mirrored subtitle font size from a remote watch-together room host */
  remoteSubtitleSize?: number | null;
  /** Mirrored subtitle font weight from a remote watch-together room host */
  remoteSubtitleWeight?: number | null;
  /** External subtitles hook instance (shared with route for word tracking) */
  subtitles: ReturnType<typeof useSubtitles>;
  /** Autoplay video on load */
  autoplay?: boolean;
  /** Callback when video time updates */
  onTimeUpdate?: (time: number) => void;
  /** Final position while this player still owns its media element. */
  onBeforeDetach?: (snapshot: { currentTime: number; duration: number }) => void;
  /** Identifies the element that owns playback for the containing route. */
  onMediaElement?: (element: HTMLVideoElement | null) => void;
  /** Reports whether this player has a usable source for contextual actions. */
  onLoadStateChange?: (state: 'idle' | 'loading' | 'ready' | 'error') => void;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Options forwarded to the native context menu */
  ctxMenuOptions?: { isWatchTogether?: boolean; hasContextPhrase?: boolean; canExplainPhrase?: boolean };
  /** Called when the native context menu opens so parent routes can anchor popups nearby */
  onContextMenuOpen?: (position: { x: number; y: number }) => void;
  /** Whether the word sidebar is shown */
  showWordSidebar?: boolean;
  /** Toggle word sidebar visibility */
  onToggleWordSidebar?: () => void;
  onOpenSubtitles?: () => void;
  onOpenVideo?: () => void;
  /** Audio tracks detected via ffmpeg (for formats Chromium doesn't expose) */
  detectedAudioTracks?: DetectedTrack[];
  /** Subtitle tracks detected via ffmpeg (for formats Chromium doesn't expose) */
  detectedSubtitleTracks?: DetectedTrack[];
  /** Currently active detected subtitle track index */
  activeDetectedSubtitleTrack?: number | null;
  /** Callback when user selects a detected subtitle track */
  onSelectDetectedSubtitleTrack?: (index: number | null) => void;
  /** Additional CSS class */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
}

export const VideoPlayer: Component<VideoPlayerProps> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const video = useVideo({
    getFullscreenContainer: () => containerRef ?? null,
  });
  const subtitles = props.subtitles;
  createEffect(() => props.onPlaybackStateChange?.(video.state.isPlaying));

  // Cursor visibility with 2s timeout - matches legacy behavior
  const { isVisible: controlsVisible } = useCursorVisibility({
    hideDelay: 2000,
    useBodyClass: true,
    enabled: true,
  });

  let videoRef: HTMLVideoElement | undefined;
  const playerId = ++nextPlayerId;
  const pauseOwnedVideo = (reason: string) => {
    if (!videoRef) return;
    const currentTime = videoRef.currentTime;
    const wasPaused = videoRef.paused;
    videoRef.pause();
    log.info('Playback ownership released', { playerId, reason, currentTime, wasPaused, paused: videoRef.paused, connected: videoRef.isConnected });
  };
  let containerRef: HTMLDivElement | undefined;
  const playbackVisitId = crypto.randomUUID();
  const [playbackPass, setPlaybackPass] = createSignal(0);
  const [documentActive, setDocumentActive] = createSignal(
    document.visibilityState === 'visible' && document.hasFocus(),
  );
  const updateDocumentActive = () => {
    setDocumentActive(document.visibilityState === 'visible' && document.hasFocus());
    if (document.visibilityState === 'hidden') pauseOwnedVideo('document-hidden');
  };
  onMount(() => {
    document.addEventListener('visibilitychange', updateDocumentActive);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('focus', updateDocumentActive);
    window.addEventListener('blur', updateDocumentActive);
    onCleanup(() => {
      document.removeEventListener('visibilitychange', updateDocumentActive);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('focus', updateDocumentActive);
      window.removeEventListener('blur', updateDocumentActive);
    });
  });
  const handlePageHide = () => pauseOwnedVideo('pagehide');

  // Compute video fit class
  const videoFitClass = createMemo(() => `video-fit-${settings.videoFit}`);

  // Attach video element
  onMount(() => {
    if (videoRef) {
      video.attachVideo(videoRef);
      props.onMediaElement?.(videoRef);
      const handleLoadedMetadata = () => {
        if (!isElectron()) return;
        const width = videoRef?.videoWidth || 0;
        const height = videoRef?.videoHeight || 0;
        if (!width || !height) return;
        let targetWidth = width;
        let targetHeight = height;
        const maxWidth = 1200;
        if (targetWidth > maxWidth) {
          targetHeight = Math.round(targetHeight * (maxWidth / targetWidth));
          targetWidth = maxWidth;
        }
        const chromeOffset = 120;
        getBridge().window.resizeWindow({
          width: Math.round(targetWidth),
          height: Math.round(targetHeight + chromeOffset),
        });
      };
      videoRef.addEventListener('loadedmetadata', handleLoadedMetadata);
      let timeBeforeSeek = 0;
      const handleSeeking = () => { timeBeforeSeek = video.state.currentTime; };
      const handleSeeked = () => {
        if (videoRef && videoRef.currentTime < timeBeforeSeek - 0.25) {
          setPlaybackPass((pass) => pass + 1);
        }
      };
      videoRef.addEventListener('seeking', handleSeeking);
      videoRef.addEventListener('seeked', handleSeeked);
      onCleanup(() => {
        videoRef?.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoRef?.removeEventListener('seeking', handleSeeking);
        videoRef?.removeEventListener('seeked', handleSeeked);
      });
    }
  });

  onCleanup(() => {
    if (videoRef) {
      pauseOwnedVideo('teardown');
      if (Number.isFinite(videoRef.currentTime) && Number.isFinite(videoRef.duration) && videoRef.duration > 0) {
        props.onBeforeDetach?.({ currentTime: videoRef.currentTime, duration: videoRef.duration });
      }
    }
    props.onMediaElement?.(null);
    video.detachVideo();
  });

  // Load video source
  createEffect(() => {
    if (props.src) {
      video.loadVideo(props.src);
    }
  });

  createEffect(() => {
    const source = props.src;
    const state = !source ? 'idle' : video.state.hasError ? 'error' : video.state.isLoaded ? 'ready' : 'loading';
    props.onLoadStateChange?.(state);
  });

  // Load subtitles
  createEffect(() => {
    if (props.subtitleContent) {
      subtitles.loadSubtitles(props.subtitleContent);
    }
  });

  // Update subtitles on time change
  createEffect(() => {
    const time = video.state.currentTime;
    subtitles.updateTime(time);
    props.onTimeUpdate?.(time);
  });

  // Enable keyboard shortcuts (scoped to player container)
  useVideoKeyboard(video, { getScope: () => containerRef ?? null });

  // Enable touch gestures on mobile
  useVideoTouch(video, () => containerRef);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    props.onContextMenuOpen?.({ x: e.clientX + 16, y: e.clientY + 16 });
    getBridge().window.showCtxMenu(props.ctxMenuOptions);
  };

  return (
      <div
          ref={containerRef}
          class={`video-player ${props.class || ''}`}
          style={props.style}
          onContextMenu={handleContextMenu}
      >
        <video
            ref={videoRef}
            class={`video-element ${videoFitClass()}`}
            classList={{ 'video-element-loading': !video.state.isLoaded }}
            crossorigin="anonymous"
            tabIndex={0}
            onPointerDown={() => videoRef?.focus()}
            autoplay={props.autoplay}
            onEnded={props.onEnded}
        />

        <Show when={video.state.hasError}>
          <div class="video-load-error" role="alert">
            <p>{t('mlearn.Video.LoadUnavailable')}</p>
            <Show when={props.onOpenVideo}>
              <Button variant="primary" onClick={props.onOpenVideo}>{t('mlearn.Video.UI.OpenVideo')}</Button>
            </Show>
          </div>
        </Show>

        {/* Subtitle overlay */}
        <SubtitleContainer
          mediaUsageContext={props.mediaUsageContext}
            tokens={subtitles.tokens()}
            isLoading={subtitles.isTokenizing()}
            originalText={subtitles.currentSubtitle()?.text}
          remoteHtml={props.remoteSubtitleHtml}
          remoteSize={props.remoteSubtitleSize}
          remoteWeight={props.remoteSubtitleWeight}
            subtitleStart={subtitles.currentSubtitle()?.start}
            subtitleEnd={subtitles.currentSubtitle()?.end}
            videoSrc={props.src}
            encounterId={subtitles.currentSubtitle()
              ? `${playbackVisitId}:${playbackPass()}:${props.src ?? ''}:${subtitles.currentSubtitle()!.start}:${subtitles.currentSubtitle()!.end}`
              : undefined}
            passiveObservationEligible={video.state.isPlaying && documentActive() && subtitles.observationReady()}
        />

        {/* Live word translator (inside player for fullscreen support) */}
        <LiveWordTranslator />

        {/* Video controls */}
        <VideoControls
            video={video}
            subtitles={subtitles}
            containerRef={containerRef}
            isControlsVisible={controlsVisible()}
            showWordSidebar={props.showWordSidebar}
            onToggleWordSidebar={props.onToggleWordSidebar}
            onOpenSubtitles={props.onOpenSubtitles}
            hasExternalSubtitles={Boolean(props.subtitleContent)}
            detectedAudioTracks={props.detectedAudioTracks}
            detectedSubtitleTracks={props.detectedSubtitleTracks}
            activeDetectedSubtitleTrack={props.activeDetectedSubtitleTrack}
            onSelectDetectedSubtitleTrack={props.onSelectDetectedSubtitleTrack}
        />
      </div>
  );
};
