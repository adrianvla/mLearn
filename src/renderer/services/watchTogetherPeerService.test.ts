import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeerService, type PeerServiceCallbacks } from './watchTogetherPeerService';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  public readonly url: string;
  public readonly protocols: string[];
  public readyState = MockWebSocket.CONNECTING;
  public sentMessages: unknown[] = [];

  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  emit(type: string, event?: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event ?? {});
    }
  }

  send(data: unknown): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { wasClean: false, code: code ?? 1006, reason: reason ?? '' });
  }
}

const mockCallbacks: PeerServiceCallbacks = {
  onPeerConnected: vi.fn(),
  onPeerDisconnected: vi.fn(),
  onDataMessage: vi.fn(),
  onBinaryChunk: vi.fn(),
  onSignalingError: vi.fn(),
  onSignalingReconnecting: vi.fn(),
  onSignalingReconnected: vi.fn(),
};

describe('watchTogetherPeerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function getLatestSocket(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  function openSocket(socket: MockWebSocket): void {
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('open');
  }

  describe('initial connection', () => {
    it('opens a WebSocket with the correct URL and protocols', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      expect(MockWebSocket.instances.length).toBe(1);
      const socket = MockWebSocket.instances[0];
      expect(socket.url).toBe('wss://cloud.example.com/socket?token=token-123');
      expect(socket.protocols).toEqual(['mlearn-v1']);
    });

    it('calls onSignalingReconnected when socket opens', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      expect(mockCallbacks.onSignalingReconnected).toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('sends ping after heartbeat interval', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      vi.advanceTimersByTime(15000);
      expect(socket.sentMessages).toContain('ping');
    });

    it('does not close socket when pong is received in time', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      vi.advanceTimersByTime(15000);
      expect(socket.sentMessages).toContain('ping');

      socket.emit('message', { data: 'pong' });

      vi.advanceTimersByTime(10001);
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });

    it('closes socket when pong is not received within timeout', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      vi.advanceTimersByTime(15000);
      expect(socket.sentMessages).toContain('ping');

      vi.advanceTimersByTime(10001);

      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith(
        expect.stringContaining('Signaling connection lost'),
      );
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect after unclean close', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket1 = getLatestSocket();
      openSocket(socket1);

      socket1.emit('close', { wasClean: false, code: 1006, reason: '' });

      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith(
        expect.stringContaining('Signaling connection lost'),
      );
      expect(mockCallbacks.onSignalingReconnecting).toHaveBeenCalledWith(1);
      expect(MockWebSocket.instances.length).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(2);
    });

    it('reconnects successfully after transient failure', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket1 = getLatestSocket();
      openSocket(socket1);

      socket1.emit('close', { wasClean: false, code: 1006, reason: '' });
      vi.advanceTimersByTime(1000);

      const socket2 = getLatestSocket();
      openSocket(socket2);

      expect(mockCallbacks.onSignalingReconnected).toHaveBeenCalledTimes(2);
      expect(socket2.url).toBe('wss://cloud.example.com/socket?token=token-123');
    });

    it('resets reconnect attempts after successful connection', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket1 = getLatestSocket();
      openSocket(socket1);

      socket1.emit('close', { wasClean: false, code: 1006, reason: '' });
      expect(mockCallbacks.onSignalingReconnecting).toHaveBeenCalledWith(1);

      vi.advanceTimersByTime(1000);

      const socket2 = getLatestSocket();
      openSocket(socket2);

      socket2.emit('close', { wasClean: false, code: 1006, reason: '' });
      expect(mockCallbacks.onSignalingReconnecting).toHaveBeenLastCalledWith(1);
    });

    it('does not reconnect after clean close', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('close', { wasClean: true });

      expect(mockCallbacks.onSignalingError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it('stops reconnecting after max attempts and reports permanent failure', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket1 = getLatestSocket();
      openSocket(socket1);

      socket1.emit('close', { wasClean: false, code: 1006, reason: '' });

      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000);
        const socket = getLatestSocket();
        socket.readyState = MockWebSocket.CONNECTING;
        socket.emit('close', { wasClean: false, code: 1006, reason: '' });
      }

      vi.advanceTimersByTime(60000);

      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith('Signaling connection failed permanently');
    });

    it('does not reconnect on permanent close codes', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('close', { wasClean: false, code: 1008, reason: 'Invalid token' });

      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith(
        expect.stringContaining('Signaling connection closed permanently'),
      );

      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it('times out connection if not opened within threshold', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      expect(socket.readyState).toBe(MockWebSocket.CONNECTING);

      vi.advanceTimersByTime(10000);

      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith(
        expect.stringContaining('Signaling connection lost'),
      );
    });

    it('resets reconnect attempts after successful connection', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket1 = getLatestSocket();
      openSocket(socket1);
      socket1.emit('close', { wasClean: false });
      vi.advanceTimersByTime(1000);

      const socket2 = getLatestSocket();
      openSocket(socket2);

      socket2.emit('close', { wasClean: false, code: 1006, reason: '' });
      expect(mockCallbacks.onSignalingReconnecting).toHaveBeenLastCalledWith(1);
    });
  });

  describe('destroy', () => {
    it('stops reconnection attempts', () => {
      const service = createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('close', { wasClean: false, code: 1006, reason: '' });
      service.destroy();

      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it('closes the WebSocket', () => {
      const service = createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      service.destroy();
      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('signaling messages', () => {
    it('reports room-closed error', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('message', {
        data: JSON.stringify({
          type: 'room-state',
          room: { status: 'closed' },
        }),
      });

      expect(mockCallbacks.onSignalingError).toHaveBeenCalledWith('room-closed');
    });

    it('ignores pong in handleSignalingMessage', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('message', { data: 'pong' });

      expect(mockCallbacks.onSignalingError).not.toHaveBeenCalledWith('room-closed');
    });

    it('ignores malformed JSON', () => {
      createPeerService(
        { url: 'wss://cloud.example.com/socket', protocol: 'mlearn-v1', accessToken: 'token-123' },
        'user-local',
        mockCallbacks,
      );

      const socket = getLatestSocket();
      openSocket(socket);

      socket.emit('message', { data: 'not valid json' });

      expect(mockCallbacks.onSignalingError).not.toHaveBeenCalled();
    });
  });
});
