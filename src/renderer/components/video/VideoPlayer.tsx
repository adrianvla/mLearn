/**
 * Video Player Component
 * Main video player with controls and subtitle overlay
 */

import { Component, JSX, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { useVideo, useVideoKeyboard, useCursorVisibility } from '../../hooks';
import type { useSubtitles } from '../../hooks';
import { useVideoTouch } from '../../hooks/useVideoTouch';
import { useSettings } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { LiveWordTranslator } from '../subtitle/LiveWordTranslator';
import { VideoControls } from './VideoControls';
import './VideoPlayer.css';

export interface VideoPlayerProps {
  /** Video source URL */
  src?: string;
  /** Subtitle file content (SRT/VTT/ASS) */
  subtitleContent?: string;
  /** External subtitles hook instance (shared with route for word tracking) */
  subtitles: ReturnType<typeof useSubtitles>;
  /** Autoplay video on load */
  autoplay?: boolean;
  /** Callback when video time updates */
  onTimeUpdate?: (time: number) => void;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Options forwarded to the native context menu */
  ctxMenuOptions?: { isWatchTogether?: boolean };
  /** Whether the word sidebar is shown */
  showWordSidebar?: boolean;
  /** Toggle word sidebar visibility */
  onToggleWordSidebar?: () => void;
  /** Additional CSS class */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
}

export const VideoPlayer: Component<VideoPlayerProps> = (props) => {
  const { settings } = useSettings();
  const video = useVideo();
  const subtitles = props.subtitles;

  // Cursor visibility with 2s timeout - matches legacy behavior
  const { isVisible: controlsVisible } = useCursorVisibility({
    hideDelay: 2000,
    useBodyClass: true,
    enabled: true,
  });

  let videoRef: HTMLVideoElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  // Compute video fit class
  const videoFitClass = createMemo(() => {
    const fit = settings.videoFit || 'contain';
    return `video-fit-${fit}`;
  });

  // Attach video element
  onMount(() => {
    if (videoRef) {
      video.attachVideo(videoRef);
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
      onCleanup(() => {
        videoRef?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      });
    }
  });

  onCleanup(() => {
    video.detachVideo();
  });

  // Load video source
  createEffect(() => {
    if (props.src) {
      video.loadVideo(props.src);
    }
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

  // Enable keyboard shortcuts
  useVideoKeyboard(video);

  // Enable touch gestures on mobile
  useVideoTouch(video, () => containerRef);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
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
            autoplay={props.autoplay}
            onEnded={props.onEnded}
        />

        {/* Subtitle overlay */}
        <SubtitleContainer
            tokens={subtitles.tokens()}
            isLoading={subtitles.isTokenizing()}
            originalText={subtitles.currentSubtitle()?.text}
            subtitleStart={subtitles.currentSubtitle()?.start}
            subtitleEnd={subtitles.currentSubtitle()?.end}
            videoSrc={props.src}
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
        />
      </div>
  );
};
