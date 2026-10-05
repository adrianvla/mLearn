/** Ephemeral navigation handoff. Source-owned fields remain opaque and never become learner evidence. */
const RETURN_KEY = 'mlearn_media_return';
export function prepareMediaWorkspaceReturn(storage: Pick<Storage, 'setItem' | 'removeItem'>, source: Record<string, unknown>): '/reader' | '/video' | undefined {
  if (typeof source.path !== 'string' || !source.path.trim()) return undefined;
  const route = source.workspace === 'reader' ? '/reader' : source.workspace === 'video' ? '/video' : undefined;
  if (!route) return undefined;
  storage.setItem(route === '/reader' ? 'mlearn_open_book' : 'mlearn_open_video', source.path);
  if (route === '/video') {
    if (typeof source.subtitlePath === 'string' && source.subtitlePath.trim()) {
      storage.setItem('mlearn_open_video_subtitles', source.subtitlePath);
    } else {
      storage.removeItem('mlearn_open_video_subtitles');
    }
  }
  storage.setItem(RETURN_KEY, JSON.stringify(source));
  return route;
}
export function consumeMediaWorkspaceReturn(storage: Pick<Storage, 'getItem' | 'removeItem'>, workspace: 'reader' | 'video', path: string): Record<string, unknown> | undefined {
  const raw = storage.getItem(RETURN_KEY);
  if (!raw) return undefined;
  storage.removeItem(RETURN_KEY);
  try {
    const source: unknown = JSON.parse(raw);
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const value = source as Record<string, unknown>;
      if (value.workspace === workspace && value.path === path) return value;
    }
  } catch { /* A malformed navigation handoff cannot change the source being opened. */ }
  return undefined;
}
