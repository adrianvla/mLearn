export interface VideoGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoViewportGeometry {
  rectX: number;
  rectY: number;
  width: number;
  height: number;
  screenX: number;
  screenY: number;
  isFullscreen: boolean;
}

export interface VideoState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate?: number;
  volume?: number;
  muted?: boolean;
  src: string;
  isWaiting?: boolean;
  isFullscreen?: boolean;
}

export interface SyncMessage {
  type: 'SYNC_STATE' | 'GET_STATE' | 'STATE_RESPONSE' | 'ERROR' | 'VIDEO_STATE' | 'GEOMETRY_UPDATE' | 'CONNECTION_STATUS' | 'SUBTITLE_TRACKS' | 'EXTENSION_COMMAND';
  videoState?: VideoState;
  state?: VideoState;
  error?: string;
  tabId?: number;
  timestamp: number;
  status?: ConnectionStatus;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export interface ExtensionMessage {
  type: 'MLearnExtensionReady' | 'MLearnVideoState' | 'MLearnError';
  payload?: unknown;
  timestamp: number;
}

export interface GeometryUpdateMessage {
  type: 'GEOMETRY_UPDATE';
  geometry: VideoViewportGeometry;
  timestamp: number;
}

export interface VideoStateMessage {
  type: 'VIDEO_STATE';
  state: VideoState;
  meta: {
    url: string;
    title: string;
  };
  timestamp: number;
}

export interface SubtitleTracksMessage {
  type: 'SUBTITLE_TRACKS';
  tracks: Array<{ kind: string; src: string; srclang: string; label: string }>;
  textTracks: Array<{ language: string; text: string }>;
  url: string;
  timestamp: number;
}

export interface ExtensionCommandMessage {
  type: 'EXTENSION_COMMAND';
  command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume';
  time?: number;
  rate?: number;
  volume?: number;
  timestamp: number;
}

export interface ExtensionSettings {
  blurWords: boolean;
  blurAmount: number;
  showTranslation: boolean;
  language: string;
}

export type PopupMessageType =
  | 'REQUEST_SYNC'
  | 'OPEN_OVERLAY'
  | 'GET_POPUP_STATE'
  | 'POPUP_STATE_UPDATE'
  | 'TOGGLE_HEADLESS_MODE'
  | 'GET_HEADLESS_STATE'
  | 'HEADLESS_STATE_UPDATE'
  | 'LOAD_SUBTITLES'
  | 'SET_SUBTITLE_OFFSET'
  | 'WATCH_TOGETHER_CREATE_ROOM'
  | 'WATCH_TOGETHER_JOIN_ROOM'
  | 'WATCH_TOGETHER_LEAVE_ROOM'
  | 'WATCH_TOGETHER_GET_STATE';

export interface PopupMessage {
  type: PopupMessageType;
  connectionStatus?: ConnectionStatus;
  videoState?: VideoState;
  timestamp?: number;
  enabled?: boolean;
  subtitleContent?: string;
  subtitleFormat?: 'srt' | 'vtt' | 'ass';
  offset?: number;
  roomCode?: string;
  accessToken?: string;
  headlessState?: HeadlessPopupState;
  watchTogetherState?: WatchTogetherExtensionState;
  error?: string;
}

export type HeadlessMode = 'disabled' | 'enabled';

export interface HeadlessPopupState {
  mode: HeadlessMode;
  subtitleOffset: number;
  subtitlesLoaded: boolean;
  currentSubtitleText: string | null;
}

export interface HeadlessStateMessage {
  type: 'HEADLESS_STATE_CHANGED';
  enabled: boolean;
}

export interface HeadlessSubtitleMessage {
  type: 'HEADLESS_SUBTITLE_UPDATE';
  text: string | null;
  offset: number;
}

export interface HeadlessCommandMessage {
  type: 'HEADLESS_COMMAND';
  command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume';
  time?: number;
  rate?: number;
  volume?: number;
}

export interface TextModeWordLookupMessage {
  type: 'TEXT_MODE_WORD_LOOKUP';
  word: string;
  x: number;
  y: number;
}

export interface ParsedSubtitle {
  start: number;
  end: number;
  text: string;
}

export interface WatchTogetherExtensionState {
  isInRoom: boolean;
  roomCode: string | null;
  role: 'owner' | 'viewer' | null;
  peerCount: number;
  isConnecting: boolean;
  error: string | null;
}

export interface WatchTogetherRoomStateExt {
  roomId: string;
  roomCode: string;
  ownerUserId: string;
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  mediaUrl?: string;
  mediaTitle?: string;
  subtitleHtml?: string;
  subtitleSize?: number;
  subtitleWeight?: number;
  stateVersion: number;
  status: 'active' | 'closed';
  peerCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface WatchTogetherRoomSessionExt {
  role: 'owner' | 'viewer';
  canControl: boolean;
  room: WatchTogetherRoomStateExt;
  socket: {
    url: string;
    protocol: string;
  };
  actions: {
    refresh: { method: string; url: string };
    connect_socket: { method: string; url: string };
    update_state?: { method: string; url: string };
    close_room?: { method: string; url: string };
    leave_room?: { method: string; url: string };
  };
}

export interface WatchTogetherPlaybackPayloadExt {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  mediaUrl?: string;
  mediaTitle?: string;
  subtitleHtml?: string;
  subtitleSize?: number;
  subtitleWeight?: number;
}
