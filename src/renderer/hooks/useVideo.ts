/**
 * Video Player Hook
 * Manages video playback, controls, and state
 */

import { createSignal, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.hooks.useVideo");

export interface VideoTrack {
  id: string;
  label: string;
  language: string;
  kind: string;
  enabled: boolean;
}

export interface TextTrack {
  id: string;
  label: string;
  language: string;
  kind: string;
  mode: string;
}

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
  audioTracks: VideoTrack[];
  textTracks: TextTrack[];
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
    audioTracks: [],
    textTracks: [],
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
    element.addEventListener('loadeddata', handleLoadedData);
    element.addEventListener('loadedmetadata', handleLoadedMetadata);
    element.addEventListener('enterpictureinpicture', handlePiPEnter);
    element.addEventListener('leavepictureinpicture', handlePiPLeave);
    element.addEventListener('ratechange', handleRateChange);
    element.addEventListener('waiting', handleWaiting);
    element.addEventListener('stalled', handleStalled);
    element.addEventListener('canplay', handleCanPlay);
    element.addEventListener('playing', handlePlaying);
    element.addEventListener('progress', handleProgress);
    element.addEventListener('error', handleError);

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const audioTracks = (element as unknown as { audioTracks?: EventTarget }).audioTracks;
    if (audioTracks) {
      audioTracks.addEventListener('change', handleAudioTrackChange);
      audioTracks.addEventListener('addtrack', handleAddTrack);
      audioTracks.addEventListener('removetrack', handleRemoveTrack);
    }
    if (element.textTracks) {
      element.textTracks.addEventListener('change', handleTextTrackChange);
      element.textTracks.addEventListener('addtrack', handleAddTrack);
      element.textTracks.addEventListener('removetrack', handleRemoveTrack);
    }
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
    videoRef.removeEventListener('loadeddata', handleLoadedData);
    videoRef.removeEventListener('enterpictureinpicture', handlePiPEnter);
    videoRef.removeEventListener('leavepictureinpicture', handlePiPLeave);
    videoRef.removeEventListener('ratechange', handleRateChange);
    videoRef.removeEventListener('waiting', handleWaiting);
    videoRef.removeEventListener('stalled', handleStalled);
    videoRef.removeEventListener('canplay', handleCanPlay);
    videoRef.removeEventListener('playing', handlePlaying);
    videoRef.removeEventListener('progress', handleProgress);
    videoRef.removeEventListener('error', handleError);

    document.removeEventListener('fullscreenchange', handleFullscreenChange);

    const audioTracks = (videoRef as unknown as { audioTracks?: EventTarget }).audioTracks;
    if (audioTracks) {
      audioTracks.removeEventListener('change', handleAudioTrackChange);
      audioTracks.removeEventListener('addtrack', handleAddTrack);
      audioTracks.removeEventListener('removetrack', handleRemoveTrack);
    }
    if (videoRef.textTracks) {
      videoRef.textTracks.removeEventListener('change', handleTextTrackChange);
      videoRef.textTracks.removeEventListener('addtrack', handleAddTrack);
      videoRef.textTracks.removeEventListener('removetrack', handleRemoveTrack);
    }

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

  const handleError = () => {
    if (!videoRef) return;
    const err = videoRef.error;
    log.error('Video element error:', err?.code, err?.message);
  };

  const readAudioTracks = (): VideoTrack[] => {
    if (!videoRef) return [];
    const tracks = (videoRef as unknown as { audioTracks?: { length: number; [index: number]: { label: string; language: string; kind: string; enabled: boolean } } }).audioTracks;
    if (!tracks) return [];
    const result: VideoTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      result.push({
        id: String(i),
        label: track.label || track.language || `Track ${i + 1}`,
        language: track.language || '',
        kind: track.kind || '',
        enabled: track.enabled,
      });
    }
    return result;
  };

  const readTextTracks = (): TextTrack[] => {
    if (!videoRef) return [];
    const tracks = videoRef.textTracks;
    if (!tracks) return [];
    return Array.from(tracks).map((track, index) => ({
      id: String(index),
      label: track.label || track.language || `Track ${index + 1}`,
      language: track.language || '',
      kind: track.kind || '',
      mode: track.mode,
    }));
  };

  const refreshTracks = () => {
    if (!videoRef) return;
    const audio = readAudioTracks();
    const text = readTextTracks();
    setState('audioTracks', audio);
    setState('textTracks', text);
    if (audio.length > 0 || text.length > 0) {
      log.info('Tracks detected — audio:', audio.length, 'text:', text.length);
    }
  };

  const handleLoadedMetadata = () => {
    refreshTracks();
  };

  const handleLoadedData = () => {
    refreshTracks();
  };

  const handleAudioTrackChange = () => {
    setState('audioTracks', readAudioTracks());
  };

  const handleTextTrackChange = () => {
    setState('textTracks', readTextTracks());
  };

  const handleAddTrack = () => {
    refreshTracks();
  };

  const handleRemoveTrack = () => {
    refreshTracks();
  };

  const setAudioTrack = (index: number) => {
    const tracks = (videoRef as unknown as { audioTracks?: { length: number; [index: number]: { enabled: boolean } } }).audioTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = i === index;
    }
    setState('audioTracks', readAudioTracks());
  };

  const setTextTrack = (index: number) => {
    if (!videoRef?.textTracks) return;
    for (let i = 0; i < videoRef.textTracks.length; i++) {
      videoRef.textTracks[i].mode = i === index ? 'showing' : 'hidden';
    }
    setState('textTracks', readTextTracks());
  };

  const disableTextTracks = () => {
    if (!videoRef?.textTracks) return;
    for (let i = 0; i < videoRef.textTracks.length; i++) {
      videoRef.textTracks[i].mode = 'hidden';
    }
    setState('textTracks', readTextTracks());
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
    setState({ isLoaded: false, currentTime: 0, duration: 0, isBuffering: false, audioTracks: [], textTracks: [] });

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

    setAudioTrack,
    setTextTrack,
    disableTextTracks,

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
export function useVideoKeyboard(video: ReturnType<typeof useVideo>, _options: { getScope?: () => HTMLElement | null } = {}) {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Skip if focused on an interactive text element
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
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

  document.addEventListener('keydown', handleKeyDown as EventListener);

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown as EventListener);
  });
}
