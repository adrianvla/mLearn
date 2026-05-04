/**
 * Watch Together Peer Service
 *
 * Manages WebRTC peer connections for cloud room watch-together sessions.
 * Uses SimplePeer for WebRTC and the BFF Worker Durable Object WebSocket
 * for signaling (SDP + ICE candidate relay).
 *
 * Topology: mesh — every peer connects to every other peer.
 * Sync messages flow owner→viewers; media chunks flow any→any.
 */

export interface PeerInfo {
  userId: string;
  role: string;
}

export interface SignalingSocket {
  url: string;
  protocol: string;
  accessToken: string;
}

/** JSON control messages sent over WebRTC data channels. */
export type PeerDataMessage =
  | { type: 'sync-state'; currentTime: number; paused: boolean; playbackRate: number; subtitlesHtml: string | null; subtitleSize: number | null; subtitleWeight: number | null; mediaUrl: string; mediaTitle: string }
  | { type: 'sync-play'; time: number }
  | { type: 'sync-pause'; time: number }
  | { type: 'sync-seek'; time: number }
  | { type: 'sync-subtitles'; html: string; size: number; weight: number }
  | { type: 'media-offer'; mediaId: string; fileName: string; fileSize: number; chunkCount: number; chunkSize: number; subtitleContent: string | null }
  | { type: 'media-accept'; mediaId: string }
  | { type: 'media-reject'; mediaId: string }
  | { type: 'media-complete'; mediaId: string }
  | { type: 'media-have'; mediaId: string; indices: number[] }
  | { type: 'media-need'; mediaId: string; indices: number[] };

/** Binary message header: 1 byte type + 4 bytes chunk index. */
const BINARY_HEADER_SIZE = 5;
const BINARY_TYPE_VIDEO_CHUNK = 0x01;

/** Maximum buffered bytes before pausing sends. */
const MAX_BUFFERED_AMOUNT = 64 * 1024;

/** Reconnection delays with exponential backoff. */
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

/** Heartbeat interval to keep the signaling connection alive. */
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 10000;

/** Connection establishment timeout. */
const CONNECTION_TIMEOUT_MS = 10000;

/** WebSocket close codes that indicate permanent failure — do not retry. */
const PERMANENT_CLOSE_CODES = new Set([
  1002, // Protocol error
  1008, // Policy violation (e.g., invalid token)
  1011, // Server error
]);

export interface PeerServiceCallbacks {
  onPeerConnected: (userId: string) => void;
  onPeerDisconnected: (userId: string) => void;
  onDataMessage: (fromUserId: string, message: PeerDataMessage) => void;
  onBinaryChunk: (fromUserId: string, chunkType: number, chunkIndex: number, data: Uint8Array) => void;
  onSignalingError: (error: string) => void;
  onSignalingReconnecting?: (attempt: number) => void;
  onSignalingReconnected?: () => void;
}

export interface PeerServiceOptions {
  iceServers?: { urls: string; username?: string; credential?: string }[];
}

interface PeerConnection {
  userId: string;
  peer: SimplePeerInstance;
  connected: boolean;
}

let SimplePeerConstructor: Window['SimplePeer'] | null = null;

async function ensureSimplePeer(): Promise<Window['SimplePeer']> {
  if (SimplePeerConstructor) return SimplePeerConstructor;

  // @ts-ignore — dynamic import of bundled JS
  await import('./simplepeer.min.js');
  SimplePeerConstructor = window.SimplePeer;
  if (!SimplePeerConstructor) {
    throw new Error('SimplePeer failed to load');
  }
  return SimplePeerConstructor;
}

export function encodeBinaryChunk(chunkType: number, chunkIndex: number, data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(BINARY_HEADER_SIZE + data.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, chunkType);
  view.setUint32(1, chunkIndex, false);
  new Uint8Array(buffer, BINARY_HEADER_SIZE).set(data);
  return buffer;
}

export function decodeBinaryChunk(buffer: ArrayBuffer): { chunkType: number; chunkIndex: number; data: Uint8Array } {
  const view = new DataView(buffer);
  const chunkType = view.getUint8(0);
  const chunkIndex = view.getUint32(1, false);
  const data = new Uint8Array(buffer, BINARY_HEADER_SIZE);
  return { chunkType, chunkIndex, data };
}

export { BINARY_TYPE_VIDEO_CHUNK };

export interface PeerServiceInstance {
  sendToAll: (message: PeerDataMessage) => void;
  sendBinaryToAll: (chunkType: number, chunkIndex: number, data: Uint8Array) => Promise<void>;
  sendTo: (userId: string, message: PeerDataMessage) => void;
  sendBinaryTo: (userId: string, chunkType: number, chunkIndex: number, data: Uint8Array) => Promise<void>;
  getConnectedPeerIds: () => string[];
  destroy: () => void;
}

export function createPeerService(
  signalingConfig: SignalingSocket,
  localUserId: string,
  callbacks: PeerServiceCallbacks,
  options?: PeerServiceOptions,
): PeerServiceInstance {
  const peers = new Map<string, PeerConnection>();
  let signalingWs: WebSocket | null = null;
  let destroyed = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingIntervalTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearHeartbeatTimers(): void {
    if (pingIntervalTimer) {
      clearInterval(pingIntervalTimer);
      pingIntervalTimer = null;
    }
    if (pongTimeoutTimer) {
      clearTimeout(pongTimeoutTimer);
      pongTimeoutTimer = null;
    }
  }

  function clearConnectionTimeout(): void {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
  }

  function clearAllTimers(): void {
    clearReconnectTimer();
    clearHeartbeatTimers();
    clearConnectionTimeout();
  }

  function scheduleReconnect(): void {
    if (destroyed) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      callbacks.onSignalingError('Signaling connection failed permanently');
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    callbacks.onSignalingReconnecting?.(reconnectAttempts);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSignalingSocket();
    }, delay);
  }

  function startHeartbeat(): void {
    clearHeartbeatTimers();
    pingIntervalTimer = setInterval(() => {
      if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) return;
      signalingWs.send('ping');
      pongTimeoutTimer = setTimeout(() => {
        signalingWs?.close();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function openSignalingSocket(): void {
    if (destroyed) return;

    if (signalingWs) {
      const oldWs = signalingWs;
      signalingWs = null;
      oldWs.close();
    }

    clearAllTimers();

    const url = signalingConfig.url.includes('?')
      ? `${signalingConfig.url}&token=${encodeURIComponent(signalingConfig.accessToken)}`
      : `${signalingConfig.url}?token=${encodeURIComponent(signalingConfig.accessToken)}`;
    const ws = new WebSocket(url, [signalingConfig.protocol]);

    connectionTimeoutTimer = setTimeout(() => {
      connectionTimeoutTimer = null;
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
      }
    }, CONNECTION_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      if (destroyed) return;
      clearConnectionTimeout();
      reconnectAttempts = 0;
      callbacks.onSignalingReconnected?.();
      startHeartbeat();
    });

    ws.addEventListener('message', (event) => {
      if (destroyed) return;

      if (String(event.data) === 'pong') {
        if (pongTimeoutTimer) {
          clearTimeout(pongTimeoutTimer);
          pongTimeoutTimer = null;
        }
        return;
      }

      handleSignalingMessage(String(event.data));
    });

    ws.addEventListener('error', () => {
      if (destroyed) return;
    });

    ws.addEventListener('close', (event) => {
      if (destroyed) return;
      clearConnectionTimeout();
      clearHeartbeatTimers();

      if (event.wasClean) {
        return;
      }

      const closeCode = event.code;
      const closeReason = event.reason || 'no reason';
      const logUrl = signalingConfig.url.replace(/\?.*$/, '').replace(/token=[^&]*/g, 'token=<redacted>');

      if (PERMANENT_CLOSE_CODES.has(closeCode)) {
        callbacks.onSignalingError(`Signaling connection closed permanently (code=${closeCode}, reason=${closeReason}, url=${logUrl})`);
        return;
      }

      callbacks.onSignalingError(`Signaling connection lost (code=${closeCode}, reason=${closeReason}, attempt=${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}, url=${logUrl})`);
      scheduleReconnect();
    });

    signalingWs = ws;
  }

  function handleSignalingMessage(raw: string): void {
    if (raw === 'pong') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'peers': {
        const peerList = msg.peers as PeerInfo[];
        for (const p of peerList) {
          if (p.userId !== localUserId && !peers.has(p.userId)) {
            createPeerConnection(p.userId, true);
          }
        }
        break;
      }

      case 'peer-joined': {
        const peer = msg.peer as PeerInfo;
        if (peer.userId !== localUserId && !peers.has(peer.userId)) {
          createPeerConnection(peer.userId, false);
        }
        break;
      }

      case 'peer-left': {
        const peer = msg.peer as PeerInfo;
        removePeerConnection(peer.userId);
        break;
      }

      case 'signal': {
        const from = msg.from as string;
        const signal = msg.signal;
        const pc = peers.get(from);
        if (pc) {
          pc.peer.signal(signal);
        }
        break;
      }

      case 'room-state': {
        const room = msg.room as Record<string, unknown>;
        if (room.status === 'closed') {
          callbacks.onSignalingError('room-closed');
        }
        break;
      }
    }
  }

  async function createPeerConnection(remoteUserId: string, initiator: boolean): Promise<void> {
    if (destroyed || peers.has(remoteUserId)) return;

    const Peer = await ensureSimplePeer();
    const peer = new Peer({
      initiator,
      trickle: true,
      config: {
        iceServers: options?.iceServers ?? [],
      },
    });

    const conn: PeerConnection = {
      userId: remoteUserId,
      peer,
      connected: false,
    };
    peers.set(remoteUserId, conn);

    peer.on('signal', (signalData) => {
      if (destroyed || !signalingWs || signalingWs.readyState !== WebSocket.OPEN) return;
      signalingWs.send(JSON.stringify({
        type: 'signal',
        to: remoteUserId,
        signal: signalData,
      }));
    });

    peer.on('connect', () => {
      conn.connected = true;
      callbacks.onPeerConnected(remoteUserId);
    });

    peer.on('data', (rawData) => {
      handlePeerData(remoteUserId, rawData);
    });

    peer.on('error', () => {
      removePeerConnection(remoteUserId);
    });

    peer.on('close', () => {
      removePeerConnection(remoteUserId);
    });
  }

  function handlePeerData(fromUserId: string, rawData: string | ArrayBuffer | Uint8Array): void {
    if (typeof rawData === 'string') {
      try {
        const msg = JSON.parse(rawData) as PeerDataMessage;
        callbacks.onDataMessage(fromUserId, msg);
      } catch {
        // Ignore malformed JSON
      }
      return;
    }

    const buffer = rawData instanceof ArrayBuffer ? rawData : (rawData.buffer as ArrayBuffer).slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength);
    if (buffer.byteLength < BINARY_HEADER_SIZE) return;

    const { chunkType, chunkIndex, data } = decodeBinaryChunk(buffer);
    callbacks.onBinaryChunk(fromUserId, chunkType, chunkIndex, data);
  }

  function removePeerConnection(userId: string): void {
    const conn = peers.get(userId);
    if (!conn) return;
    peers.delete(userId);

    try {
      conn.peer.destroy();
    } catch {
      // Ignore destroy errors
    }

    if (conn.connected) {
      callbacks.onPeerDisconnected(userId);
    }
  }

  async function waitForDrain(peer: SimplePeerInstance): Promise<void> {
    const channel = peer._channel;
    if (!channel || channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) return;

    return new Promise<void>((resolve) => {
      const check = () => {
        if (!channel || channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  }

  function sendToAll(message: PeerDataMessage): void {
    const serialized = JSON.stringify(message);
    for (const conn of peers.values()) {
      if (conn.connected) {
        try {
          conn.peer.send(serialized);
        } catch {
          // Peer may have disconnected
        }
      }
    }
  }

  async function sendBinaryToAll(chunkType: number, chunkIndex: number, data: Uint8Array): Promise<void> {
    const encoded = encodeBinaryChunk(chunkType, chunkIndex, data);
    for (const conn of peers.values()) {
      if (!conn.connected) continue;
      try {
        await waitForDrain(conn.peer);
        conn.peer.send(encoded);
      } catch {
        // Peer may have disconnected
      }
    }
  }

  function sendTo(userId: string, message: PeerDataMessage): void {
    const conn = peers.get(userId);
    if (!conn?.connected) return;
    try {
      conn.peer.send(JSON.stringify(message));
    } catch {
      // Peer may have disconnected
    }
  }

  async function sendBinaryTo(userId: string, chunkType: number, chunkIndex: number, data: Uint8Array): Promise<void> {
    const conn = peers.get(userId);
    if (!conn?.connected) return;
    try {
      await waitForDrain(conn.peer);
      conn.peer.send(encodeBinaryChunk(chunkType, chunkIndex, data));
    } catch {
      // Peer may have disconnected
    }
  }

  function getConnectedPeerIds(): string[] {
    const ids: string[] = [];
    for (const conn of peers.values()) {
      if (conn.connected) ids.push(conn.userId);
    }
    return ids;
  }

  function destroy(): void {
    destroyed = true;
    clearAllTimers();

    for (const conn of peers.values()) {
      try {
        conn.peer.destroy();
      } catch {
        // Ignore
      }
    }
    peers.clear();

    if (signalingWs && (signalingWs.readyState === WebSocket.OPEN || signalingWs.readyState === WebSocket.CONNECTING)) {
      signalingWs.close();
    }
    signalingWs = null;
  }

  openSignalingSocket();

  return {
    sendToAll,
    sendBinaryToAll,
    sendTo,
    sendBinaryTo,
    getConnectedPeerIds,
    destroy,
  };
}
