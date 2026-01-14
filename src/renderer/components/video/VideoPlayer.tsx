/**
 * Video Player Component
 * Main video player with controls and subtitle overlay
 */

import { Component, JSX, Show, createEffect, onMount, onCleanup } from 'solid-js';
import { useVideo, useVideoKeyboard, useSubtitles } from '../../hooks';
import { useSettings } from '../../context';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { VideoControls } from './VideoControls';
import { GlassPanel } from '../common/GlassPanel';

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
  let videoRef: HTMLVideoElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  // Attach video element
  onMount(() => {
    if (videoRef) {
      video.attachVideo(videoRef);
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
    'object-fit': settings.videoFit || 'contain',
  });

  return (
    <div ref={containerRef} style={containerStyle()}>
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
      />

      {/* Video controls */}
      <VideoControls
        video={video}
        subtitles={subtitles}
        containerRef={containerRef}
      />
    </div>
  );
};
