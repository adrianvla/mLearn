import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeClient, RuntimeError } from '../src/client.ts';

test('native failure never becomes a success-shaped UI value', async () => {
  const client = createRuntimeClient({ commandId: () => 'test', execute: async () => JSON.stringify({ type: 'error', code: 'conflict', message: 'Reload settings' }) });
  await assert.rejects(client.snapshot(), (error: unknown) => error instanceof RuntimeError && error.code === 'conflict');
});
test('protocol mismatch is explicit', async () => {
  const client = createRuntimeClient({ commandId: () => 'test', execute: async () => JSON.stringify({ type: 'snapshot', snapshot: { protocolVersion: 99 } }) });
  await assert.rejects(client.snapshot(), /Unsupported native protocol/);
});
