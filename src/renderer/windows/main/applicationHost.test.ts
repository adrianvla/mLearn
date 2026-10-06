// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ navigate: vi.fn(), openWindow: vi.fn(), desktop: true }));
vi.mock('@solidjs/router', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ window: { openWindow: fixture.openWindow } }) }));
vi.mock('../../../shared/platform', () => ({ isElectron: () => fixture.desktop }));
import { currentApplicationHost, hasActiveMediaSource, setActiveMediaSource, useApplicationNavigate, useApplicationReturn } from './applicationHost';
beforeEach(() => { vi.clearAllMocks(); fixture.desktop = true; sessionStorage.clear(); window.history.replaceState(null, '', '?host=study#/practise'); });
afterEach(() => { setActiveMediaSource(undefined); window.history.replaceState(null, '', '/'); });
describe('host-aware navigation', () => {
  it('switches study purpose locally and keeps saved material inside the Flashcards host', () => {
    const navigate = useApplicationNavigate();
    navigate('/evaluate'); expect(fixture.navigate).toHaveBeenCalledWith('/evaluate');
    navigate('/knowledge/material'); expect(fixture.navigate).toHaveBeenCalledWith('/knowledge/material');
    expect(fixture.navigate).toHaveBeenCalledTimes(2);
    expect(fixture.openWindow).not.toHaveBeenCalled();
  });
  it('transfers opaque media Return to its receiving renderer instead of writing Study storage', () => {
    const source = { workspace: 'reader', path: '/book.epub', page: 17, 'third-party:location': { segments: [1, 4] } };
    useApplicationReturn()('/reader', { sourceContext: source });
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'main', context: { applicationPath: '/reader', applicationReturn: true, sourceContext: source } });
    expect(sessionStorage.length).toBe(0); expect(fixture.navigate).not.toHaveBeenCalled();
  });
  it('preserves mobile local restoration including subtitle identity and unknown metadata', () => {
    fixture.desktop = false;
    const source = { workspace: 'video', path: '/film.mp4', time: 12, subtitlePath: '/film.vtt', 'third-party:locator': { v: 9 } };
    useApplicationReturn()('/video', { sourceContext: source });
    expect(fixture.navigate).toHaveBeenCalledWith('/video'); expect(fixture.openWindow).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('mlearn_media_return')!)).toEqual(source);
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBe('/film.vtt');
  });
  it('compares actual loaded media identity and releases it when the route unmounts', () => {
    setActiveMediaSource({ workspace: 'reader', path: '/book.epub' });
    expect(hasActiveMediaSource({ workspace: 'reader', path: '/book.epub', page: 99 })).toBe(true);
    expect(hasActiveMediaSource({ workspace: 'reader', path: '/different.epub' })).toBe(false);
    setActiveMediaSource(undefined); expect(hasActiveMediaSource({ workspace: 'reader', path: '/book.epub' })).toBe(false);
    expect(currentApplicationHost()).toBe('study');
  });
});
