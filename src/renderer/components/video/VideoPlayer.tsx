/**
 * Video Player Component
 * Main video player with controls and subtitle overlay
 */

import { Component, JSX, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { useVideo, useVideoKeyboard, useSubtitles, useCursorVisibility } from '../../hooks';
import { useSettings } from '../../context';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { VideoControls } from './VideoControls';
import './VideoPlayer.css';

export interface VideoPlayerProps {
  /** Video source URL */
  src?: string;
  /** Subtitle file content (SRT/VTT/ASS) */
  subtitleContent?: string;
  /** Autoplay video on load */
  autoplay?: boolean;
  /** Callback when video time updates */
  onTimeUpdate?: (time: number) => void;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Additional CSS class */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
}

export const VideoPlayer: Component<VideoPlayerProps> = (props) => {
  const { settings } = useSettings();
  const video = useVideo();
  const subtitles = useSubtitles();

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
        if (!window.mLearnIPC) return;
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
        window.mLearnIPC.resizeWindow({
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
    const time = video.state().currentTime;
    subtitles.updateTime(time);
    props.onTimeUpdate?.(time);
  });

  // Enable keyboard shortcuts
  useVideoKeyboard(video);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    window.mLearnIPC?.showCtxMenu();
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
        />

        {/* Video controls */}
        <VideoControls
            video={video}
            subtitles={subtitles}
            containerRef={containerRef}
            isControlsVisible={controlsVisible()}
        />
      </div>
  );
};
