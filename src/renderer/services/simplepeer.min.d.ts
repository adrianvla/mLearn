/**
 * Type declaration for the bundled simple-peer library
 * The actual SimplePeer class is available on the window object
 */

export {};

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
    signal(data: any): void;
    send(data: string | ArrayBuffer): void;
    destroy(): void;
    on(event: 'signal', callback: (data: any) => void): void;
    on(event: 'connect', callback: () => void): void;
    on(event: 'data', callback: (data: any) => void): void;
    on(event: 'error', callback: (err: Error) => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: string, callback: (...args: any[]) => void): void;
    connected: boolean;
  }
}
