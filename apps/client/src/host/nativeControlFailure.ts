import { RuntimeError } from '@mlearn/runtime-client';

/** Expo coded exceptions and Tauri error responses retain native classification. */
export function nativeControlFailure(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (typeof error === 'object' && error !== null
    && 'code' in error && typeof error.code === 'string' && error.code.length > 0 && error.code.length <= 128
    && 'message' in error && typeof error.message === 'string' && error.message.length <= 2048) {
    throw new RuntimeError(error.code, error.message);
  }
  throw error;
}
