import type { PopupMessage, VideoState, ConnectionStatus, HeadlessPopupState, WatchTogetherExtensionState } from '../types.js';

interface PopupState {
  connectionStatus: ConnectionStatus;
  videoState: VideoState | null;
  headlessState: HeadlessPopupState;
  watchTogetherState: WatchTogetherExtensionState;
  accessToken: string;
}

const DEFAULT_STATE: PopupState = {
  connectionStatus: 'disconnected',
  videoState: null,
  headlessState: {
    mode: 'disabled',
    subtitleOffset: 0,
    subtitlesLoaded: false,
    currentSubtitleText: null,
  },
  watchTogetherState: {
    isInRoom: false,
    roomCode: null,
    role: null,
    peerCount: 0,
    isConnecting: false,
    error: null,
  },
  accessToken: '',
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
  actionsSection: HTMLElement;
  headlessSection: HTMLElement;
  headlessToggleBtn: HTMLButtonElement;
  headlessControls: HTMLElement;
  loadSubtitlesBtn: HTMLButtonElement;
  offsetDecreaseBtn: HTMLButtonElement;
  offsetIncreaseBtn: HTMLButtonElement;
  offsetValue: HTMLSpanElement;
  watchTogetherSignedOut: HTMLElement;
  watchTogetherPanel: HTMLElement;
  watchTogetherTabs: HTMLElement;
  createRoomBtn: HTMLButtonElement;
  joinRoomCode: HTMLInputElement;
  joinRoomBtn: HTMLButtonElement;
  roomActive: HTMLElement;
  roomCodeValue: HTMLSpanElement;
  roomPeersValue: HTMLSpanElement;
  leaveRoomBtn: HTMLButtonElement;
  signInBtn: HTMLButtonElement;
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
  const actionsSection = document.getElementById('actionsSection');
  const headlessSection = document.getElementById('headlessSection');
  const headlessToggleBtn = document.getElementById('headlessToggleBtn');
  const headlessControls = document.getElementById('headlessControls');
  const loadSubtitlesBtn = document.getElementById('loadSubtitlesBtn');
  const offsetDecreaseBtn = document.getElementById('offsetDecreaseBtn');
  const offsetIncreaseBtn = document.getElementById('offsetIncreaseBtn');
  const offsetValue = document.getElementById('offsetValue');
  const watchTogetherSignedOut = document.getElementById('watchTogetherSignedOut');
  const watchTogetherPanel = document.getElementById('watchTogetherPanel');
  const watchTogetherTabs = document.getElementById('watchTogetherTabs');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const joinRoomCode = document.getElementById('joinRoomCode');
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  const roomActive = document.getElementById('roomActive');
  const roomCodeValue = document.getElementById('roomCodeValue');
  const roomPeersValue = document.getElementById('roomPeersValue');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');
  const signInBtn = document.getElementById('signInBtn');

  if (
    !statusDot || !statusText || !timeValue || !playValue || !volumeValue ||
    !requestSyncBtn || !openOverlayBtn || !playPauseBtn || !seekBackBtn || !seekForwardBtn ||
    !actionsSection || !headlessSection || !headlessToggleBtn || !headlessControls ||
    !loadSubtitlesBtn || !offsetDecreaseBtn || !offsetIncreaseBtn || !offsetValue ||
    !watchTogetherSignedOut || !watchTogetherPanel || !watchTogetherTabs ||
    !createRoomBtn || !joinRoomCode || !joinRoomBtn ||
    !roomActive || !roomCodeValue || !roomPeersValue || !leaveRoomBtn || !signInBtn
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
    actionsSection: actionsSection as HTMLElement,
    headlessSection: headlessSection as HTMLElement,
    headlessToggleBtn: headlessToggleBtn as HTMLButtonElement,
    headlessControls: headlessControls as HTMLElement,
    loadSubtitlesBtn: loadSubtitlesBtn as HTMLButtonElement,
    offsetDecreaseBtn: offsetDecreaseBtn as HTMLButtonElement,
    offsetIncreaseBtn: offsetIncreaseBtn as HTMLButtonElement,
    offsetValue: offsetValue as HTMLSpanElement,
    watchTogetherSignedOut: watchTogetherSignedOut as HTMLElement,
    watchTogetherPanel: watchTogetherPanel as HTMLElement,
    watchTogetherTabs: watchTogetherTabs as HTMLElement,
    createRoomBtn: createRoomBtn as HTMLButtonElement,
    joinRoomCode: joinRoomCode as HTMLInputElement,
    joinRoomBtn: joinRoomBtn as HTMLButtonElement,
    roomActive: roomActive as HTMLElement,
    roomCodeValue: roomCodeValue as HTMLSpanElement,
    roomPeersValue: roomPeersValue as HTMLSpanElement,
    leaveRoomBtn: leaveRoomBtn as HTMLButtonElement,
    signInBtn: signInBtn as HTMLButtonElement,
  };
}

function updateUI(state: PopupState): void {
  currentPopupState = state;
  const els = getElements();

  const isConnected = state.connectionStatus === 'connected';
  const isHeadless = state.headlessState.mode === 'enabled';
  const wt = state.watchTogetherState;

  if (isConnected) {
    els.statusDot.classList.add('connected');
    els.statusDot.classList.remove('disconnected');
    els.statusText.textContent = 'Connected to mLearn';
    els.actionsSection.classList.remove('hidden');
    els.headlessSection.classList.add('hidden');
    els.headlessControls.classList.add('hidden');
  } else {
    els.statusDot.classList.add('disconnected');
    els.statusDot.classList.remove('connected');
    els.statusText.textContent = 'mLearn not running';
    els.actionsSection.classList.add('hidden');
    els.headlessSection.classList.remove('hidden');

    if (isHeadless) {
      els.headlessControls.classList.remove('hidden');
      els.headlessToggleBtn.textContent = 'Disable';
      els.headlessToggleBtn.classList.add('active');
    } else {
      els.headlessControls.classList.add('hidden');
      els.headlessToggleBtn.textContent = 'Enable';
      els.headlessToggleBtn.classList.remove('active');
    }
  }

  if (state.videoState) {
    els.timeValue.textContent = formatTime(state.videoState.currentTime);

    let statusText = state.videoState.isPlaying ? 'Playing' : 'Paused';
    if (state.videoState.isWaiting) {
      statusText = 'Buffering...';
    }
    if (state.videoState.isFullscreen) {
      statusText += ' (Fullscreen)';
    }
    els.playValue.textContent = statusText;

    const vol = state.videoState.volume ?? 1;
    const muted = state.videoState.muted ?? false;
    els.volumeValue.textContent = muted ? 'Muted' : `${Math.round(vol * 100)}%`;

    els.playPauseBtn.textContent = state.videoState.isPlaying ? 'Pause' : 'Play';
    els.playPauseBtn.disabled = false;
  } else {
    els.timeValue.textContent = '--:--';
    els.playValue.textContent = 'No video';
    els.volumeValue.textContent = '--';
    els.playPauseBtn.textContent = 'Play';
    els.playPauseBtn.disabled = true;
  }

  els.offsetValue.textContent = `${state.headlessState.subtitleOffset}ms`;

  if (wt.isInRoom) {
    els.roomActive.classList.remove('hidden');
    els.watchTogetherTabs.classList.add('hidden');
    els.createRoomBtn.parentElement?.classList.add('hidden');
    const joinContent = els.watchTogetherPanel.querySelector('[data-tab-content="join"]');
    if (joinContent) joinContent.classList.add('hidden');
    els.roomCodeValue.textContent = wt.roomCode ?? '-';
    els.roomPeersValue.textContent = String(wt.peerCount);
  } else {
    els.roomActive.classList.add('hidden');
    els.watchTogetherTabs.classList.remove('hidden');
    const hostContent = els.watchTogetherPanel.querySelector('[data-tab-content="host"]');
    if (hostContent) hostContent.classList.remove('hidden');
  }

  if (state.accessToken) {
    els.watchTogetherSignedOut.classList.add('hidden');
    els.watchTogetherPanel.classList.remove('hidden');
  } else {
    els.watchTogetherSignedOut.classList.remove('hidden');
    els.watchTogetherPanel.classList.add('hidden');
  }
}

function sendMessage(type: PopupMessage['type'], data?: Partial<PopupMessage>, callback?: (response: PopupMessage) => void): void {
  const message: PopupMessage = {
    type,
    timestamp: Date.now(),
    ...data,
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
  if (message.type !== 'POPUP_STATE_UPDATE' && message.type !== 'HEADLESS_STATE_UPDATE') {
    return;
  }

  const next: PopupState = {
    ...currentPopupState,
    connectionStatus: message.connectionStatus ?? currentPopupState.connectionStatus,
    videoState: message.videoState ?? currentPopupState.videoState,
  };

  if (message.headlessState) {
    next.headlessState = message.headlessState;
  }
  if (message.watchTogetherState) {
    next.watchTogetherState = message.watchTogetherState;
  }
  if (message.accessToken !== undefined) {
    next.accessToken = message.accessToken;
  }

  updateUI(next);
}

function initPopup(): void {
  const els = getElements();

  sendMessage('GET_POPUP_STATE', {}, (response) => {
    handleStateUpdate(response as PopupMessage);
  });

  sendMessage('GET_HEADLESS_STATE', {}, (response) => {
    handleStateUpdate(response as PopupMessage);
  });

  sendMessage('WATCH_TOGETHER_GET_STATE', {}, (response) => {
    handleStateUpdate(response as PopupMessage);
  });

  chrome.runtime.onMessage.addListener((message: PopupMessage) => {
    handleStateUpdate(message);
  });

  els.requestSyncBtn.addEventListener('click', () => {
    sendMessage('REQUEST_SYNC');
  });

  els.openOverlayBtn.addEventListener('click', () => {
    sendMessage('OPEN_OVERLAY');
  });

  els.playPauseBtn.addEventListener('click', () => {
    if (currentPopupState.videoState?.isPlaying) {
      sendCommand('pause');
    } else {
      sendCommand('play');
    }
  });

  els.seekBackBtn.addEventListener('click', () => {
    const time = currentPopupState.videoState?.currentTime ?? 0;
    sendCommand('seek', { time: Math.max(0, time - 5) });
  });

  els.seekForwardBtn.addEventListener('click', () => {
    const time = currentPopupState.videoState?.currentTime ?? 0;
    const duration = currentPopupState.videoState?.duration ?? Infinity;
    sendCommand('seek', { time: Math.min(time + 5, duration) });
  });

  els.headlessToggleBtn.addEventListener('click', () => {
    sendMessage('TOGGLE_HEADLESS_MODE', {}, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.loadSubtitlesBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.ass,.ssa';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result);
        const ext = file.name.split('.').pop()?.toLowerCase();
        const format = ext === 'vtt' ? 'vtt' : ext === 'ass' || ext === 'ssa' ? 'ass' : 'srt';
        sendMessage('LOAD_SUBTITLES', { subtitleContent: content, subtitleFormat: format });
      };
      reader.readAsText(file);
    };
    input.click();
  });

  els.offsetDecreaseBtn.addEventListener('click', () => {
    const newOffset = currentPopupState.headlessState.subtitleOffset - 100;
    sendMessage('SET_SUBTITLE_OFFSET', { offset: newOffset }, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.offsetIncreaseBtn.addEventListener('click', () => {
    const newOffset = currentPopupState.headlessState.subtitleOffset + 100;
    sendMessage('SET_SUBTITLE_OFFSET', { offset: newOffset }, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.watchTogetherTabs.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('tab-btn')) return;

    const tab = target.dataset.tab;
    if (!tab) return;

    els.watchTogetherTabs.querySelectorAll('.tab-btn').forEach((btn) => { btn.classList.remove('active'); });
    target.classList.add('active');

    els.watchTogetherPanel.querySelectorAll('.tab-content').forEach((content) => {
      content.classList.toggle('active', (content as HTMLElement).dataset.tabContent === tab);
    });
  });

  els.createRoomBtn.addEventListener('click', () => {
    if (!currentPopupState.accessToken) return;
    sendMessage('WATCH_TOGETHER_CREATE_ROOM', { accessToken: currentPopupState.accessToken }, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.joinRoomBtn.addEventListener('click', () => {
    const code = els.joinRoomCode.value.trim();
    if (!code || !currentPopupState.accessToken) return;
    sendMessage('WATCH_TOGETHER_JOIN_ROOM', { roomCode: code, accessToken: currentPopupState.accessToken }, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.leaveRoomBtn.addEventListener('click', () => {
    sendMessage('WATCH_TOGETHER_LEAVE_ROOM', {}, (response) => {
      handleStateUpdate(response as PopupMessage);
    });
  });

  els.signInBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://mlearn.kikan.net' });
  });
}

document.addEventListener('DOMContentLoaded', initPopup);