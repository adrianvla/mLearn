/**
 * Video Player Hook
 * Manages video playback, controls, and state
 */

import { createSignal, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.hooks.useVideo");

export interface VideoState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
  isLoaded: boolean;
  isPiP: boolean;
  isFullscreen: boolean;
}

export function useVideo() {
  let videoRef: HTMLVideoElement | null = null;

  const [state, setState] = createStore<VideoState>({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isMuted: false,
    volume: 1,
    playbackRate: 1,
    isLoaded: false,
    isPiP: false,
    isFullscreen: false,
  });

  const [videoSrc, setVideoSrc] = createSignal<string>('');

  // Attach to video element
  const attachVideo = (element: HTMLVideoElement) => {
    if (videoRef) {
      detachVideo();
    }

    videoRef = element;

    // Set up event listeners
    element.addEventListener('timeupdate', handleTimeUpdate);
    element.addEventListener('durationchange', handleDurationChange);
    element.addEventListener('play', handlePlay);
    element.addEventListener('pause', handlePause);
    element.addEventListener('volumechange', handleVolumeChange);
    element.addEventListener('loadeddata', handleLoaded);
    element.addEventListener('enterpictureinpicture', handlePiPEnter);
    element.addEventListener('leavepictureinpicture', handlePiPLeave);

    document.addEventListener('fullscreenchange', handleFullscreenChange);
  };

  // Detach from video element
  const detachVideo = () => {
    if (!videoRef) return;

    videoRef.removeEventListener('timeupdate', handleTimeUpdate);
    videoRef.removeEventListener('durationchange', handleDurationChange);
    videoRef.removeEventListener('play', handlePlay);
    videoRef.removeEventListener('pause', handlePause);
    videoRef.removeEventListener('volumechange', handleVolumeChange);
    videoRef.removeEventListener('loadeddata', handleLoaded);
    videoRef.removeEventListener('enterpictureinpicture', handlePiPEnter);
    videoRef.removeEventListener('leavepictureinpicture', handlePiPLeave);

    document.removeEventListener('fullscreenchange', handleFullscreenChange);

    videoRef = null;
  };

  const handleTimeUpdate = () => {
    if (!videoRef) return;
    setState('currentTime', videoRef!.currentTime);
  };

  const handleDurationChange = () => {
    if (!videoRef) return;
    setState('duration', videoRef!.duration);
  };

  const handlePlay = () => {
    setState('isPlaying', true);
  };

  const handlePause = () => {
    setState('isPlaying', false);
  };

  const handleVolumeChange = () => {
    if (!videoRef) return;
    setState('volume', videoRef!.volume);
    setState('isMuted', videoRef!.muted);
  };

  const handleLoaded = () => {
    if (!videoRef) return;
    setState('isLoaded', true);
    setState('duration', videoRef!.duration);
  };

  const handlePiPEnter = () => {
    setState('isPiP', true);
  };

  const handlePiPLeave = () => {
    setState('isPiP', false);
  };

  const handleFullscreenChange = () => {
    setState('isFullscreen', !!document.fullscreenElement);
  };

  // Control methods
  const play = async () => {
    if (!videoRef) return;
    try {
      await videoRef.play();
    } catch (e) {
      log.error('Play failed:', e);
    }
  };

  const pause = () => {
    if (!videoRef) return;
    videoRef.pause();
  };

  const togglePlay = async () => {
    if (state.isPlaying) {
      pause();
    } else {
      await play();
    }
  };

  const seek = (time: number) => {
    if (!videoRef) return;
    videoRef.currentTime = Math.max(0, Math.min(time, state.duration));
  };

  const seekRelative = (delta: number) => {
    if (!videoRef) return;
    seek(state.currentTime + delta);
  };

  const setVolume = (volume: number) => {
    if (!videoRef) return;
    videoRef.volume = Math.max(0, Math.min(1, volume));
  };

  const toggleMute = () => {
    if (!videoRef) return;
    videoRef.muted = !videoRef.muted;
  };

  const setPlaybackRate = (rate: number) => {
    if (!videoRef) return;
    videoRef.playbackRate = rate;
    setState('playbackRate', rate);
  };

  const togglePiP = async () => {
    if (!videoRef) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.requestPictureInPicture();
      }
    } catch (e) {
      log.error('PiP toggle failed:', e);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (videoRef?.parentElement) {
        await videoRef.parentElement.requestFullscreen();
      }
    } catch (e) {
      log.error('Fullscreen toggle failed:', e);
    }
  };

  const loadVideo = (src: string) => {
    setVideoSrc(src);
    setState({ isLoaded: false, currentTime: 0, duration: 0 });

    if (videoRef) {
      videoRef.src = src;
      videoRef.load();
    }
  };

  const loadVideoFile = (file: File) => {
    const url = URL.createObjectURL(file);
    loadVideo(url);
    
    // Clean up object URL when new video is loaded
    onCleanup(() => URL.revokeObjectURL(url));
  };

  // Formatted time helpers
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formattedCurrentTime = createMemo(() => formatTime(state.currentTime));
  const formattedDuration = createMemo(() => formatTime(state.duration));
  const progress = createMemo(() => {
    const { currentTime, duration } = state;
    if (duration === 0) return 0;
    return (currentTime / duration) * 100;
  });

  // Cleanup on unmount
  onCleanup(() => {
    detachVideo();
  });

  return {
    state,
    videoSrc,
    
    // Attach/detach
    attachVideo,
    detachVideo,
    
    // Playback controls
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
    
    // Volume
    setVolume,
    toggleMute,
    
    // Speed
    setPlaybackRate,
    
    // Display modes
    togglePiP,
    toggleFullscreen,
    
    // Loading
    loadVideo,
    loadVideoFile,
    
    // Formatted values
    formatTime,
    formattedCurrentTime,
    formattedDuration,
    progress,
  };
}

// Keyboard shortcuts hook
export function useVideoKeyboard(video: ReturnType<typeof useVideo>) {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Skip if focused on input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        video.togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        video.seekRelative(e.shiftKey ? -10 : -5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        video.seekRelative(e.shiftKey ? 10 : 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.setVolume(video.state.volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.setVolume(video.state.volume - 0.1);
        break;
      case 'KeyM':
        video.toggleMute();
        break;
      case 'KeyF':
        video.toggleFullscreen();
        break;
      case 'KeyP':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          video.togglePiP();
        }
        break;
      case 'Comma':
        if (e.shiftKey) {
          video.setPlaybackRate(Math.max(0.25, video.state.playbackRate - 0.25));
        }
        break;
      case 'Period':
        if (e.shiftKey) {
          video.setPlaybackRate(Math.min(2, video.state.playbackRate + 0.25));
        }
        break;
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });
}
