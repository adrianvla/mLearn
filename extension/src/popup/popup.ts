import type { PopupMessage, VideoState, ConnectionStatus } from '../types';

interface PopupState {
  connectionStatus: ConnectionStatus;
  videoState: VideoState | null;
}

const DEFAULT_STATE: PopupState = {
  connectionStatus: 'disconnected',
  videoState: null,
};

let currentPopupState: PopupState = DEFAULT_STATE;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getElements(): {
  statusDot: HTMLSpanElement;
  statusText: HTMLSpanElement;
  timeValue: HTMLSpanElement;
  playValue: HTMLSpanElement;
  volumeValue: HTMLSpanElement;
  requestSyncBtn: HTMLButtonElement;
  openOverlayBtn: HTMLButtonElement;
  playPauseBtn: HTMLButtonElement;
  seekBackBtn: HTMLButtonElement;
  seekForwardBtn: HTMLButtonElement;
} {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const timeValue = document.getElementById('timeValue');
  const playValue = document.getElementById('playValue');
  const volumeValue = document.getElementById('volumeValue');
  const requestSyncBtn = document.getElementById('requestSyncBtn');
  const openOverlayBtn = document.getElementById('openOverlayBtn');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const seekBackBtn = document.getElementById('seekBackBtn');
  const seekForwardBtn = document.getElementById('seekForwardBtn');

  if (
    !statusDot ||
    !statusText ||
    !timeValue ||
    !playValue ||
    !volumeValue ||
    !requestSyncBtn ||
    !openOverlayBtn ||
    !playPauseBtn ||
    !seekBackBtn ||
    !seekForwardBtn
  ) {
    throw new Error('Popup: required DOM elements not found');
  }

  return {
    statusDot: statusDot as HTMLSpanElement,
    statusText: statusText as HTMLSpanElement,
    timeValue: timeValue as HTMLSpanElement,
    playValue: playValue as HTMLSpanElement,
    volumeValue: volumeValue as HTMLSpanElement,
    requestSyncBtn: requestSyncBtn as HTMLButtonElement,
    openOverlayBtn: openOverlayBtn as HTMLButtonElement,
    playPauseBtn: playPauseBtn as HTMLButtonElement,
    seekBackBtn: seekBackBtn as HTMLButtonElement,
    seekForwardBtn: seekForwardBtn as HTMLButtonElement,
  };
}

function updateUI(state: PopupState): void {
  currentPopupState = state;
  const { statusDot, statusText, timeValue, playValue, volumeValue, playPauseBtn } = getElements();

  if (state.connectionStatus === 'connected') {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = 'Connected to mLearn';
  } else {
    statusDot.classList.add('disconnected');
    statusDot.classList.remove('connected');
    statusText.textContent = 'mLearn not running';
  }

  if (state.videoState) {
    timeValue.textContent = formatTime(state.videoState.currentTime);

    let statusText = state.videoState.isPlaying ? 'Playing' : 'Paused';
    if (state.videoState.isWaiting) {
      statusText = 'Buffering...';
    }
    if (state.videoState.isFullscreen) {
      statusText += ' (Fullscreen)';
    }
    playValue.textContent = statusText;

    const vol = state.videoState.volume ?? 1;
    const muted = state.videoState.muted ?? false;
    volumeValue.textContent = muted ? 'Muted' : `${Math.round(vol * 100)}%`;

    playPauseBtn.textContent = state.videoState.isPlaying ? 'Pause' : 'Play';
    playPauseBtn.disabled = false;
  } else {
    timeValue.textContent = '--:--';
    playValue.textContent = 'No video';
    volumeValue.textContent = '--';
    playPauseBtn.textContent = 'Play';
    playPauseBtn.disabled = true;
  }
}

function sendMessage(type: PopupMessage['type'], callback?: (response: PopupMessage) => void): void {
  const message: PopupMessage = {
    type,
    timestamp: Date.now(),
  };
  if (callback) {
    chrome.runtime.sendMessage(message, callback);
  } else {
    chrome.runtime.sendMessage(message);
  }
}

function sendCommand(command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume', params?: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    type: 'EXTENSION_COMMAND',
    command,
    timestamp: Date.now(),
    ...params,
  }).catch(() => {});
}

function handleStateUpdate(message: PopupMessage): void {
  if (message.type !== 'POPUP_STATE_UPDATE') {
    return;
  }

  updateUI({
    connectionStatus: message.connectionStatus ?? 'disconnected',
    videoState: message.videoState ?? null,
  });
}

function initPopup(): void {
  const { requestSyncBtn, openOverlayBtn, playPauseBtn, seekBackBtn, seekForwardBtn } = getElements();

  sendMessage('GET_POPUP_STATE', (response) => {
    handleStateUpdate(response as PopupMessage);
  });

  chrome.runtime.onMessage.addListener((message: PopupMessage) => {
    handleStateUpdate(message);
  });

  requestSyncBtn.addEventListener('click', () => {
    sendMessage('REQUEST_SYNC');
  });

  openOverlayBtn.addEventListener('click', () => {
    sendMessage('OPEN_OVERLAY');
  });

  playPauseBtn.addEventListener('click', () => {
    if (currentPopupState.videoState?.isPlaying) {
      sendCommand('pause');
    } else {
      sendCommand('play');
    }
  });

  seekBackBtn.addEventListener('click', () => {
    const time = currentPopupState.videoState?.currentTime ?? 0;
    sendCommand('seek', { time: Math.max(0, time - 5) });
  });

  seekForwardBtn.addEventListener('click', () => {
    const time = currentPopupState.videoState?.currentTime ?? 0;
    const duration = currentPopupState.videoState?.duration ?? Infinity;
    sendCommand('seek', { time: Math.min(time + 5, duration) });
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
