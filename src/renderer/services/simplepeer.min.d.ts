/**
 * Type declaration for the bundled simple-peer library
 * The actual SimplePeer class is available on the window object
 */

export {};

type SimplePeerSignalData = unknown;
type SimplePeerData = string | ArrayBuffer | Uint8Array;

declare global {
  interface Window {
    SimplePeer: {
      new(options?: {
        initiator?: boolean;
        trickle?: boolean;
        config?: RTCConfiguration;
        stream?: MediaStream;
        channelConfig?: RTCDataChannelInit;
      }): SimplePeerInstance;
      WEBRTC_SUPPORT: boolean;
    };
  }

  interface SimplePeerInstance {
    signal(data: SimplePeerSignalData): void;
    send(data: string | ArrayBuffer): void;
    destroy(): void;
    on(event: 'signal', callback: (data: SimplePeerSignalData) => void): void;
    on(event: 'connect', callback: () => void): void;
    on(event: 'data', callback: (data: SimplePeerData) => void): void;
    on(event: 'error', callback: (err: Error) => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    connected: boolean;
    _channel?: RTCDataChannel;
  }
}
