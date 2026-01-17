/**
 * Video Player Component
 * Main video player with controls and subtitle overlay
 */

import { Component, JSX, createEffect, onMount, onCleanup } from 'solid-js';
import { useVideo, useVideoKeyboard, useSubtitles, useCursorVisibility } from '../../hooks';
import { useSettings } from '../../context';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { VideoControls } from './VideoControls';

export interface VideoPlayerProps {
  src?: string;
  subtitleContent?: string;
  autoplay?: boolean;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
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

  const containerStyle = (): JSX.CSSProperties => ({
    position: 'relative',
    width: '100%',
    height: '100%',
    'background-color': 'black',
    overflow: 'hidden',
    ...props.style,
  });

  const videoStyle = (): JSX.CSSProperties => ({
    width: '100%',
    height: '100%',
    'object-fit': (settings.videoFit as JSX.CSSProperties['object-fit']) || 'contain',
  });

  return (
    <div
      ref={containerRef}
      style={containerStyle()}
      onContextMenu={(e) => {
        e.preventDefault();
        window.mLearnIPC?.showCtxMenu();
      }}
    >
      <video
        ref={videoRef}
        style={videoStyle()}
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
