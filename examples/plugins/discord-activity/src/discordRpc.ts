import net from 'net';
import os from 'os';
import path from 'path';

export type DiscordRpcFrame = {
  op: number;
  payload: Record<string, unknown>;
};

type RpcSocket = {
  write: (buffer: Buffer) => Promise<void>;
  read: () => Promise<Buffer>;
  close: () => Promise<void>;
};

type ConnectSocket = (candidatePath: string) => Promise<RpcSocket>;

type Dependencies = {
  connect?: ConnectSocket;
  getCandidatePaths?: () => string[];
  nonce?: () => string;
  pid?: number;
};

type CandidatePathOptions = {
  platform?: NodeJS.Platform;
  tempRoots?: string[];
};

const OPCODE_HANDSHAKE = 0;
const OPCODE_FRAME = 1;
const OPCODE_CLOSE = 2;

function isMissingDiscordSocketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /ENOENT/i.test(message) && /discord-ipc-\d+/i.test(message);
}

export function encodeFrame(frame: DiscordRpcFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(frame.payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(frame.op, 0);
  header.writeInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

export function decodeFrame(buffer: Buffer): DiscordRpcFrame {
  const op = buffer.readInt32LE(0);
  const length = buffer.readInt32LE(4);
  const payload = JSON.parse(buffer.subarray(8, 8 + length).toString('utf8')) as Record<string, unknown>;
  return { op, payload };
}

function createNonce(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDiscordIpcCandidatePaths({
  platform = process.platform,
  tempRoots,
}: CandidatePathOptions = {}): string[] {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }

  const candidateRoots = (tempRoots ?? [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    os.tmpdir(),
  ]).filter((value): value is string => typeof value === 'string' && value.length > 0);

  const uniqueRoots = [...new Set(candidateRoots)];
  const candidates: string[] = [];

  for (const root of uniqueRoots) {
    for (let index = 0; index < 10; index += 1) {
      candidates.push(path.join(root, `discord-ipc-${index}`));
    }
  }

  return candidates;
}

function createNetSocket(socket: net.Socket): RpcSocket {
  const chunks: Buffer[] = [];
  let bufferedBytes = 0;
  let ended = false;
  let pendingRead: ((value: Buffer) => void) | null = null;
  let pendingReject: ((reason?: unknown) => void) | null = null;

  function tryConsumeFrame(): Buffer | null {
    if (bufferedBytes < 8) {
      return null;
    }

    const combined = Buffer.concat(chunks, bufferedBytes);
    const length = combined.readInt32LE(4);
    const frameLength = 8 + length;
    if (combined.length < frameLength) {
      return null;
    }

    const frame = combined.subarray(0, frameLength);
    const remainder = combined.subarray(frameLength);
    chunks.length = 0;
    bufferedBytes = remainder.length;
    if (remainder.length > 0) {
      chunks.push(remainder);
    }

    return frame;
  }

  function flushRead(): void {
    if (!pendingRead) {
      return;
    }

    const frame = tryConsumeFrame();
    if (frame) {
      const resolve = pendingRead;
      pendingRead = null;
      pendingReject = null;
      resolve(frame);
      return;
    }

    if (ended) {
      const reject = pendingReject;
      pendingRead = null;
      pendingReject = null;
      reject?.(new Error('Discord RPC socket closed before a full frame was received'));
    }
  }

  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    bufferedBytes += chunk.length;
    flushRead();
  });

  socket.on('end', () => {
    ended = true;
    flushRead();
  });

  socket.on('close', () => {
    ended = true;
    flushRead();
  });

  socket.on('error', (error) => {
    const reject = pendingReject;
    pendingRead = null;
    pendingReject = null;
    reject?.(error);
  });

  return {
    write(buffer: Buffer) {
      return new Promise((resolve, reject) => {
        socket.write(buffer, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    read() {
      return new Promise((resolve, reject) => {
        pendingRead = resolve;
        pendingReject = reject;
        flushRead();
      });
    },
    close() {
      return new Promise((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }

        socket.once('close', () => resolve());
        socket.destroy();
      });
    },
  };
}

async function connectNetSocket(candidatePath: string): Promise<RpcSocket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(candidatePath, () => {
      socket.removeListener('error', reject);
      resolve(createNetSocket(socket));
    });

    socket.once('error', reject);
  });
}

function getDiscordRpcErrorMessage(payload: Record<string, unknown>): string | null {
  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message;
  }

  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }

  return null;
}

async function readExpectedFrame(socket: RpcSocket, expectedOp: number): Promise<Record<string, unknown>> {
  while (true) {
    const frame = decodeFrame(await socket.read());
    if (frame.op === expectedOp) {
      if (frame.payload.evt === 'ERROR') {
        throw new Error(getDiscordRpcErrorMessage(frame.payload) ?? 'Discord RPC returned an error');
      }

      return frame.payload;
    }

    if (frame.op === OPCODE_CLOSE) {
      const message = typeof frame.payload.message === 'string' && frame.payload.message.trim().length > 0
        ? frame.payload.message
        : 'Discord RPC closed the IPC connection';
      throw new Error(message);
    }
  }
}

export function createDiscordRpcClient({
  connect = connectNetSocket,
  getCandidatePaths = getDiscordIpcCandidatePaths,
  nonce = createNonce,
  pid = process.pid,
}: Dependencies = {}) {
  let socket: RpcSocket | undefined;

  async function sendFrame(frame: DiscordRpcFrame): Promise<void> {
    if (!socket) {
      throw new Error('Discord RPC client is not connected');
    }

    await socket.write(encodeFrame(frame));
  }

  return {
    async login({ clientId }: { clientId: string }): Promise<void> {
      let lastError: unknown;

      for (const candidatePath of getCandidatePaths()) {
        try {
          socket = await connect(candidatePath);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!socket) {
        if (isMissingDiscordSocketError(lastError)) {
          throw new Error('Discord is not running');
        }

        throw new Error(lastError instanceof Error ? lastError.message : 'Discord IPC socket not found');
      }

      await sendFrame({
        op: OPCODE_HANDSHAKE,
        payload: {
          v: 1,
          client_id: clientId,
        },
      });

      const payload = await readExpectedFrame(socket, OPCODE_FRAME);
      if (payload.evt !== 'READY') {
        throw new Error('Discord RPC handshake did not return READY');
      }
    },
    async setActivity(activity: Record<string, unknown>): Promise<void> {
      await sendFrame({
        op: OPCODE_FRAME,
        payload: {
          cmd: 'SET_ACTIVITY',
          args: {
            pid,
            activity,
          },
          nonce: nonce(),
        },
      });

      await readExpectedFrame(socket!, OPCODE_FRAME);
    },
    async clearActivity(): Promise<void> {
      if (!socket) {
        return;
      }

      await sendFrame({
        op: OPCODE_FRAME,
        payload: {
          cmd: 'SET_ACTIVITY',
          args: {
            pid,
            activity: null,
          },
          nonce: nonce(),
        },
      });

      await readExpectedFrame(socket, OPCODE_FRAME);
    },
    async disconnect(): Promise<void> {
      await socket?.close();
      socket = undefined;
    },
  };
}
