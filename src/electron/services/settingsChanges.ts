import type { Settings } from '../../shared/types';
const listeners = new Set<(settings: Settings, profile: string) => void>();
export function notifySettingsCommitted(settings: Settings, profile: string): void {
  for (const listener of listeners) { try { listener(settings, profile); } catch { /* An observer must not invalidate a committed settings save. */ } }
}
export function subscribeSettingsCommitted(listener: (settings: Settings, profile: string) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
