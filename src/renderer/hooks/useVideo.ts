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
  isBuffering: boolean;
}

export interface UseVideoOptions {
  /** Container element to use for fullscreen (defaults to video parent) */
  getFullscreenContainer?: () => HTMLElement | null;
}

export function useVideo(options: UseVideoOptions = {}) {
  let videoRef: HTMLVideoElement | null = null;
  let objectUrlRef: string | null = null;

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
    isBuffering: false,
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
    element.addEventListener('ratechange', handleRateChange);
    element.addEventListener('waiting', handleWaiting);
    element.addEventListener('stalled', handleStalled);
    element.addEventListener('canplay', handleCanPlay);
    element.addEventListener('playing', handlePlaying);
    element.addEventListener('progress', handleProgress);

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
    videoRef.removeEventListener('ratechange', handleRateChange);
    videoRef.removeEventListener('waiting', handleWaiting);
    videoRef.removeEventListener('stalled', handleStalled);
    videoRef.removeEventListener('canplay', handleCanPlay);
    videoRef.removeEventListener('playing', handlePlaying);
    videoRef.removeEventListener('progress', handleProgress);

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

  const handleRateChange = () => {
    if (!videoRef) return;
    setState('playbackRate', videoRef!.playbackRate);
  };

  const handleWaiting = () => {
    setState('isBuffering', true);
  };

  const handleStalled = () => {
    setState('isBuffering', true);
  };

  const handleCanPlay = () => {
    setState('isBuffering', false);
  };

  const handlePlaying = () => {
    setState('isBuffering', false);
  };

  const handleProgress = () => {
    // Progress event fires as data is downloaded; if we're playing, we're not buffering
    if (videoRef && !videoRef.paused) {
      setState('isBuffering', false);
    }
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
      } else {
        const container = options.getFullscreenContainer?.() ?? videoRef?.parentElement;
        if (container) {
          await container.requestFullscreen();
        }
      }
    } catch (e) {
      log.error('Fullscreen toggle failed:', e);
    }
  };

  const loadVideo = (src: string) => {
    // Revoke previous object URL if any
    if (objectUrlRef) {
      URL.revokeObjectURL(objectUrlRef);
      objectUrlRef = null;
    }

    log.info('useVideo.loadVideo: src=', src);
    setVideoSrc(src);
    setState({ isLoaded: false, currentTime: 0, duration: 0, isBuffering: false });

    if (videoRef) {
      videoRef.src = src;
      videoRef.load();
    } else {
      log.warn('useVideo.loadVideo: videoRef is null, cannot set src');
    }
  };

  const loadVideoFile = (file: File) => {
    const url = URL.createObjectURL(file);
    objectUrlRef = url;
    loadVideo(url);
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
    if (objectUrlRef) {
      URL.revokeObjectURL(objectUrlRef);
      objectUrlRef = null;
    }
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
export function useVideoKeyboard(video: ReturnType<typeof useVideo>, options: { getScope?: () => HTMLElement | null } = {}) {
  const handleKeyDown = (e: KeyboardEvent) => {
    const scope = options.getScope?.();
    // If scope is provided, only handle when focus is inside or on the scope
    if (scope) {
      const target = e.target as Node;
      if (target !== scope && !scope.contains(target as Node)) {
        return;
      }
    }

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

  const scope = options.getScope?.();
  const target = scope ?? document;
  target.addEventListener('keydown', handleKeyDown as EventListener);
  
  onCleanup(() => {
    target.removeEventListener('keydown', handleKeyDown as EventListener);
  });
}
