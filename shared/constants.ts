export const CHANNELS = {
  GET_VERSION: 'GET_VERSION',
  SEND_MESSAGE: 'SEND_MESSAGE',
} as const;

export type IPCMessage = {
  text: string;
  timestamp: number;
};
