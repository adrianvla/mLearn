import { requireOptionalNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';

export function createHost(): Host {
  const module = requireOptionalNativeModule<{ execute(request: string): Promise<string> }>('MlearnNative');
  if (!module) return { available: false, label: 'Native module unavailable', reason: 'Build the local Rust module with npm run prepare:ios or prepare:android, then run the native app. Expo Go does not contain this module.' };
  return { available: true, label: 'Expo native', client: createRuntimeClient({ execute: (request) => module.execute(request), commandId: randomUUID }) };
}
