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
}

export interface VideoState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate?: number;
  element?: HTMLVideoElement;
  src: string;
}

export interface SyncMessage {
  type: 'SYNC_STATE' | 'GET_STATE' | 'STATE_RESPONSE' | 'ERROR' | 'VIDEO_STATE' | 'GEOMETRY_UPDATE' | 'CONNECTION_STATUS';
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
  | 'POPUP_STATE_UPDATE';

export interface PopupMessage {
  type: PopupMessageType;
  connectionStatus?: ConnectionStatus;
  videoState?: VideoState;
  timestamp?: number;
}