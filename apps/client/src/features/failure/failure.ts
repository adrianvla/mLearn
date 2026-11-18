import { RuntimeError } from '@mlearn/runtime-client';

export interface Failure {
  readonly message: string;
  readonly detail: string | null;
}

const busy = 'mLearn is finishing another task. Try again in a moment.';

/**
 * Maps a runtime/host rejection to the caller's plain sentence. Platform and runtime wording is
 * implementation detail: it is kept for the Details disclosure and never becomes the message.
 */
export function failure(error: unknown, message: string): Failure {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  const code = error instanceof RuntimeError ? error.code : null;
  return {
    message: code === 'busy' ? busy : message,
    detail: raw ? (code ? `${code}: ${raw}` : raw) : null,
  };
}

export function cancelled(error: unknown): boolean {
  return error instanceof RuntimeError && error.code === 'cancelled'
    || typeof error === 'object' && error !== null && 'code' in error && error.code === 'cancelled';
}
