import { randomUUID } from 'node:crypto';
import { createRuntimeClient, RuntimeError } from '@mlearn/runtime-client';
import { nativeControlFailure } from '../apps/client/src/host/nativeControlFailure';

export function createRuntimeBrowserClient(backend: {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
}) {
  async function stringCommand(command: string, args: Record<string, unknown>) {
    const value = await backend.invoke(command, args).catch(nativeControlFailure);
    if (typeof value !== 'string') throw new RuntimeError('protocol', 'Malformed native string response.');
    return value;
  }
  async function control(command: string, args: Record<string, unknown>) {
    const value = await backend.invoke(command, args).catch(nativeControlFailure);
    if (value !== null && value !== undefined)
      throw new RuntimeError('protocol', 'Malformed native control acknowledgement.');
  }
  return createRuntimeClient({
    commandId: randomUUID,
    execute: request => stringCommand('runtime_execute', { request }),
    cancelSourceOpen: () => control('cancel_source_open', {}),
    boundedReads: {
      begin: () => stringCommand('begin_bounded_read', {}),
      execute: (id, request) => stringCommand('execute_bounded_read', { id, request }),
      cancel: id => control('cancel_bounded_read', { id }),
    },
  });
}
