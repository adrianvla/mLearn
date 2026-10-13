import { invoke, isTauri } from '@tauri-apps/api/core';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';

export function createHost(): Host {
  if (!isTauri()) return { available: false, label: 'Browser preview', reason: 'The browser preview has no native runtime. Open Tauri or an Expo development build to save settings and execute plugins.' };
  return {
    available: true,
    label: 'Tauri desktop',
    client: createRuntimeClient({ execute: (request) => invoke<string>('runtime_execute', { request }), commandId: () => crypto.randomUUID() }),
  };
}
