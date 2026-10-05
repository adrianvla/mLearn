import { describe, expect, it } from 'vitest';
import { consumeMediaWorkspaceReturn, prepareMediaWorkspaceReturn } from './mediaWorkspaceReturn';
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('contextual media return', () => {
  it('retains exact identity and unknown occurrence metadata across the navigation handoff', () => {
    const state = storage();
    const source = { workspace: 'reader', path: '/saved/book.epub', page: 4, location: { chunk: 'actual' }, packageOccurrence: { unfamiliar: ['x'] } };
    expect(prepareMediaWorkspaceReturn(state, source)).toBe('/reader');
    expect(state.getItem('mlearn_open_book')).toBe(source.path);
    expect(consumeMediaWorkspaceReturn(state, 'reader', source.path)).toEqual(source);
    expect(consumeMediaWorkspaceReturn(state, 'reader', source.path)).toBeUndefined();
  });
  it('preserves video position zero and refuses a different source or fabricated empty path', () => {
    const state = storage();
    const source = { workspace: 'video', path: '/video.mp4', time: 0 };
    expect(prepareMediaWorkspaceReturn(state, source)).toBe('/video');
    expect(consumeMediaWorkspaceReturn(state, 'video', '/different.mp4')).toBeUndefined();
    expect(prepareMediaWorkspaceReturn(state, { workspace: 'video', path: '' })).toBeUndefined();
  });
  it('restores the captured external subtitle and clears a stale track for a source without one', () => {
    const state = storage();
    const source = { workspace: 'video', path: '/video.mp4', time: 134, subtitlePath: '/selected.srt' };
    expect(prepareMediaWorkspaceReturn(state, source)).toBe('/video');
    expect(state.getItem('mlearn_open_video_subtitles')).toBe('/selected.srt');
    expect(consumeMediaWorkspaceReturn(state, 'video', source.path)).toEqual(source);
    prepareMediaWorkspaceReturn(state, { workspace: 'video', path: '/another.mp4', time: 0 });
    expect(state.getItem('mlearn_open_video_subtitles')).toBeNull();
  });
});
