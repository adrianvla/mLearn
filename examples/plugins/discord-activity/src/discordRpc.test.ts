import { describe, expect, it } from 'vitest';

import {
  createDiscordRpcClient,
  decodeFrame,
  encodeFrame,
  getDiscordIpcCandidatePaths,
  type DiscordRpcFrame,
} from './discordRpc';

class FakeSocket {
  public writes: Buffer[] = [];

  private readonly frames: Buffer[];

  constructor(frames: DiscordRpcFrame[]) {
    this.frames = frames.map((frame) => encodeFrame(frame));
  }

  async write(buffer: Buffer): Promise<void> {
    this.writes.push(buffer);
  }

  async read(): Promise<Buffer> {
    const nextFrame = this.frames.shift();
    if (!nextFrame) {
      throw new Error('No more fake Discord RPC frames');
    }

    return nextFrame;
  }

  async close(): Promise<void> {}
}

describe('discord rpc client', () => {
  it('sends a Discord handshake and waits for READY during login', async () => {
    const socket = new FakeSocket([
      {
        op: 1,
        payload: {
          cmd: 'DISPATCH',
          evt: 'READY',
          data: { user: { id: '1' } },
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async () => socket,
      nonce: () => 'nonce-1',
      pid: 123,
    });

    await client.login({ clientId: 'client-123' });

    expect(decodeFrame(socket.writes[0])).toEqual({
      op: 0,
      payload: {
        v: 1,
        client_id: 'client-123',
      },
    });
  });

  it('sends SET_ACTIVITY frames with the current process id', async () => {
    const socket = new FakeSocket([
      {
        op: 1,
        payload: {
          cmd: 'DISPATCH',
          evt: 'READY',
          data: { user: { id: '1' } },
        },
      },
      {
        op: 1,
        payload: {
          cmd: 'SET_ACTIVITY',
          data: {},
          nonce: 'nonce-1',
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async () => socket,
      nonce: () => 'nonce-1',
      pid: 456,
    });

    await client.login({ clientId: 'client-123' });
    await client.setActivity({ details: 'Reviewing flashcards' });

    expect(decodeFrame(socket.writes[1])).toEqual({
      op: 1,
      payload: {
        cmd: 'SET_ACTIVITY',
        args: {
          activity: {
            details: 'Reviewing flashcards',
          },
          pid: 456,
        },
        nonce: 'nonce-1',
      },
    });
  });

  it('tries later Discord IPC candidates when earlier sockets fail', async () => {
    const attempts: string[] = [];
    const socket = new FakeSocket([
      {
        op: 1,
        payload: {
          cmd: 'DISPATCH',
          evt: 'READY',
          data: { user: { id: '1' } },
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async (candidatePath) => {
        attempts.push(candidatePath);
        if (candidatePath === '/tmp/discord-ipc-0') {
          throw new Error('ENOENT');
        }

        return socket;
      },
      nonce: () => 'nonce-1',
      pid: 123,
      getCandidatePaths: () => ['/tmp/discord-ipc-0', '/tmp/discord-ipc-1'],
    });

    await client.login({ clientId: 'client-123' });

    expect(attempts).toEqual(['/tmp/discord-ipc-0', '/tmp/discord-ipc-1']);
  });

  it('reports a friendly error when Discord IPC sockets are unavailable', async () => {
    const client = createDiscordRpcClient({
      connect: async (candidatePath) => {
        throw new Error(`connect ENOENT ${candidatePath}`);
      },
      getCandidatePaths: () => ['/tmp/discord-ipc-8', '/tmp/discord-ipc-9'],
    });

    await expect(client.login({ clientId: 'client-123' })).rejects.toThrow('Discord is not running');
  });

  it('preserves Discord handshake error messages from RPC error payloads', async () => {
    const socket = new FakeSocket([
      {
        op: 1,
        payload: {
          cmd: 'DISPATCH',
          evt: 'ERROR',
          data: {
            message: 'Invalid Client ID',
          },
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async () => socket,
      nonce: () => 'nonce-1',
      pid: 123,
    });

    await expect(client.login({ clientId: 'bad-client-id' })).rejects.toThrow('Invalid Client ID');
  });

  it('preserves Discord activity command error messages from RPC error payloads', async () => {
    const socket = new FakeSocket([
      {
        op: 1,
        payload: {
          cmd: 'DISPATCH',
          evt: 'READY',
          data: { user: { id: '1' } },
        },
      },
      {
        op: 1,
        payload: {
          cmd: 'SET_ACTIVITY',
          evt: 'ERROR',
          data: {
            message: 'Bad activity payload',
          },
          nonce: 'nonce-1',
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async () => socket,
      nonce: () => 'nonce-1',
      pid: 123,
    });

    await client.login({ clientId: 'client-123' });

    await expect(client.setActivity({ details: 'Reviewing flashcards' })).rejects.toThrow('Bad activity payload');
  });

  it('preserves Discord close-frame payload messages', async () => {
    const socket = new FakeSocket([
      {
        op: 2,
        payload: {
          code: 4000,
          message: 'Invalid Client ID',
        },
      },
    ]);
    const client = createDiscordRpcClient({
      connect: async () => socket,
      nonce: () => 'nonce-1',
      pid: 123,
    });

    await expect(client.login({ clientId: 'bad-client-id' })).rejects.toThrow('Invalid Client ID');
  });

  it('uses Windows Discord named pipe paths unchanged', () => {
    expect(getDiscordIpcCandidatePaths({ platform: 'win32' }).slice(0, 2)).toEqual([
      '\\\\?\\pipe\\discord-ipc-0',
      '\\\\?\\pipe\\discord-ipc-1',
    ]);
  });
});
