import type { PopupMessage, VideoState, ConnectionStatus } from '../types';

interface PopupState {
  connectionStatus: ConnectionStatus;
  videoState: VideoState | null;
}

const DEFAULT_STATE: PopupState = {
  connectionStatus: 'disconnected',
  videoState: null,
};

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
  requestSyncBtn: HTMLButtonElement;
  openOverlayBtn: HTMLButtonElement;
} {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const timeValue = document.getElementById('timeValue');
  const playValue = document.getElementById('playValue');
  const requestSyncBtn = document.getElementById('requestSyncBtn');
  const openOverlayBtn = document.getElementById('openOverlayBtn');

  if (
    !statusDot ||
    !statusText ||
    !timeValue ||
    !playValue ||
    !requestSyncBtn ||
    !openOverlayBtn
  ) {
    throw new Error('Popup: required DOM elements not found');
  }

  return {
    statusDot: statusDot as HTMLSpanElement,
    statusText: statusText as HTMLSpanElement,
    timeValue: timeValue as HTMLSpanElement,
    playValue: playValue as HTMLSpanElement,
    requestSyncBtn: requestSyncBtn as HTMLButtonElement,
    openOverlayBtn: openOverlayBtn as HTMLButtonElement,
  };
}

function updateUI(state: PopupState): void {
  const { statusDot, statusText, timeValue, playValue } = getElements();

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
    playValue.textContent = state.videoState.isPlaying ? 'Playing' : 'Paused';
  } else {
    timeValue.textContent = '--:--';
    playValue.textContent = 'No video';
  }
}

function sendMessage(type: PopupMessage['type']): void {
  const message: PopupMessage = {
    type,
    timestamp: Date.now(),
  };
  chrome.runtime.sendMessage(message);
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
  const { requestSyncBtn, openOverlayBtn } = getElements();

  sendMessage('GET_POPUP_STATE');

  chrome.runtime.onMessage.addListener((message: PopupMessage) => {
    handleStateUpdate(message);
  });

  requestSyncBtn.addEventListener('click', () => {
    sendMessage('REQUEST_SYNC');
  });

  openOverlayBtn.addEventListener('click', () => {
    sendMessage('OPEN_OVERLAY');
  });

  updateUI(DEFAULT_STATE);
}

document.addEventListener('DOMContentLoaded', initPopup);
