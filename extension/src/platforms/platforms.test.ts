import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getSitePlatform } from './index';
import { genericPlatform } from './generic';
import { youtubePlatform } from './youtube';

const mockObservers: MockMutationObserver[] = [];

class MockMutationObserver {
  private callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
    mockObservers.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  trigger(records: MutationRecord[]): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

vi.stubGlobal('MutationObserver', MockMutationObserver);

function createMockElement(tagName: string): MockElement {
  const el: MockElement = {
    tagName,
    className: '',
    textContent: '',
    attributes: {} as Record<string, string>,
    children: [] as MockElement[],
    appendChild(child: MockElement): MockElement {
      this.children.push(child);
      return child;
    },
    removeChild(child: MockElement): void {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
    },
    remove(): void {
    },
    contains(child: MockElement): boolean {
      if (child === this) return true;
      for (const c of this.children) {
        if (c.contains(child)) return true;
      }
      return false;
    },
    querySelectorAll(selector: string): MockElement[] {
      const results: MockElement[] = [];
      const selectors = selector.split(',').map((s) => s.trim());
      const collect = (item: MockElement) => {
        for (const sel of selectors) {
          if (sel.startsWith('.') && item.className && item.className.includes(sel.slice(1))) {
            results.push(item);
            break;
          } else if (!sel.startsWith('.') && item.tagName.toLowerCase() === sel.toLowerCase()) {
            results.push(item);
            break;
          }
        }
        item.children.forEach(collect);
      };
      collect(this);
      return results;
    },
    querySelector(selector: string): MockElement | null {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    getAttribute(name: string): string | null {
      return this.attributes[name] ?? null;
    },
    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    },
  };

  return new Proxy(el, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target.attributes) {
        return target.attributes[prop];
      }
      return (target as unknown as Record<string, unknown>)[prop as string];
    },
    set(target, prop, value) {
      if (typeof prop === 'string') {
        (target as unknown as Record<string, unknown>)[prop] = value;
      }
      return true;
    },
  }) as MockElement;
}

interface MockElement {
  tagName: string;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  children: MockElement[];
  appendChild(child: MockElement): MockElement;
  removeChild(child: MockElement): void;
  remove(): void;
  contains(child: MockElement): boolean;
  querySelectorAll(selector: string): MockElement[];
  querySelector(selector: string): MockElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

describe('platforms', () => {
  describe('getSitePlatform', () => {
    it('returns youtube platform for youtube.com URLs', () => {
      expect(getSitePlatform('https://www.youtube.com/watch?v=123').name).toBe('youtube');
      expect(getSitePlatform('https://youtube.com/watch?v=123').name).toBe('youtube');
      expect(getSitePlatform('https://m.youtube.com/watch?v=123').name).toBe('youtube');
      expect(getSitePlatform('https://youtu.be/abc123').name).toBe('youtube');
    });

    it('returns generic platform for non-youtube URLs', () => {
      expect(getSitePlatform('https://example.com/video').name).toBe('generic');
      expect(getSitePlatform('https://netflix.com/watch').name).toBe('generic');
      expect(getSitePlatform('https://vimeo.com/123').name).toBe('generic');
    });
  });

  describe('genericPlatform', () => {
    it('matches any URL', () => {
      expect(genericPlatform.matchesUrl('https://example.com')).toBe(true);
      expect(genericPlatform.matchesUrl('https://anything.test/path')).toBe(true);
    });

    it('extracts tracks from video element', () => {
      const track1 = createMockElement('track');
      track1.attributes['kind'] = 'subtitles';
      track1.attributes['src'] = 'https://example.com/subtitles.vtt';
      track1.attributes['srclang'] = 'en';
      track1.attributes['label'] = 'English';

      const video = createMockElement('video');
      video.appendChild(track1);

      const result = genericPlatform.extractOnce?.(video as unknown as HTMLVideoElement);
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(1);
      expect(result!.tracks[0]).toEqual({
        kind: 'subtitles',
        src: 'https://example.com/subtitles.vtt',
        srclang: 'en',
        label: 'English',
      });
    });

    it('returns null when no tracks exist', () => {
      const video = createMockElement('video');
      const result = genericPlatform.extractOnce?.(video as unknown as HTMLVideoElement);
      expect(result).toBeNull();
    });

    it('startMonitoring calls extractOnce and invokes callback', () => {
      const track = createMockElement('track');
      track.attributes['kind'] = 'subtitles';
      track.attributes['src'] = 'https://example.com/subs.vtt';
      track.attributes['srclang'] = 'ja';
      track.attributes['label'] = 'Japanese';

      const video = createMockElement('video');
      video.appendChild(track);

      const callback = vi.fn();
      const cleanup = genericPlatform.startMonitoring(video as unknown as HTMLVideoElement, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].tracks[0].srclang).toBe('ja');
      expect(typeof cleanup).toBe('function');
    });
  });

  describe('youtubePlatform', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockObservers.length = 0;
    });

    it('matches YouTube URLs', () => {
      expect(youtubePlatform.matchesUrl('https://www.youtube.com/watch?v=123')).toBe(true);
      expect(youtubePlatform.matchesUrl('https://youtube.com/watch?v=123')).toBe(true);
      expect(youtubePlatform.matchesUrl('https://m.youtube.com/watch?v=123')).toBe(true);
      expect(youtubePlatform.matchesUrl('https://youtu.be/abc123')).toBe(true);
    });

    it('does not match non-YouTube URLs', () => {
      expect(youtubePlatform.matchesUrl('https://example.com')).toBe(false);
      expect(youtubePlatform.matchesUrl('https://netflix.com')).toBe(false);
      expect(youtubePlatform.matchesUrl('https://notyoutube.com')).toBe(false);
    });

    it('extracts caption text from DOM and generates SRT', () => {
      const segmentEl = createMockElement('span');
      segmentEl.className = 'ytp-caption-segment';
      segmentEl.textContent = 'Hello world';

      const lineEl = createMockElement('span');
      lineEl.className = 'caption-visual-line';
      lineEl.appendChild(segmentEl);

      const textEl = createMockElement('span');
      textEl.className = 'captions-text';
      textEl.appendChild(lineEl);

      const windowEl = createMockElement('div');
      windowEl.className = 'caption-window';
      windowEl.setAttribute('lang', 'ja');
      windowEl.appendChild(textEl);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(windowEl);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 5 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);

      expect(callback).toHaveBeenCalled();
      const result = callback.mock.calls[0][0];
      expect(result.textTracks).toHaveLength(1);
      expect(result.textTracks[0].language).toBe('ja');
      expect(result.textTracks[0].text).toContain('Hello world');

      cleanup();
    });

    it('uses only the last caption window during transitions', () => {
      const oldSegment = createMockElement('span');
      oldSegment.className = 'ytp-caption-segment';
      oldSegment.textContent = 'Old caption';

      const oldLine = createMockElement('span');
      oldLine.className = 'caption-visual-line';
      oldLine.appendChild(oldSegment);

      const oldText = createMockElement('span');
      oldText.className = 'captions-text';
      oldText.appendChild(oldLine);

      const oldWindow = createMockElement('div');
      oldWindow.className = 'caption-window';
      oldWindow.setAttribute('lang', 'ja');
      oldWindow.appendChild(oldText);

      const newSegment = createMockElement('span');
      newSegment.className = 'ytp-caption-segment';
      newSegment.textContent = 'New caption';

      const newLine = createMockElement('span');
      newLine.className = 'caption-visual-line';
      newLine.appendChild(newSegment);

      const newText = createMockElement('span');
      newText.className = 'captions-text';
      newText.appendChild(newLine);

      const newWindow = createMockElement('div');
      newWindow.className = 'caption-window';
      newWindow.setAttribute('lang', 'ja');
      newWindow.appendChild(newText);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(oldWindow);
      container.appendChild(newWindow);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 5 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);

      expect(callback).toHaveBeenCalled();
      const result = callback.mock.calls[0][0];
      expect(result.textTracks[0].text).toContain('New caption');
      expect(result.textTracks[0].text).not.toContain('Old caption');

      cleanup();
    });

    it('picks up reappearing captions after a pause', () => {
      const segmentEl = createMockElement('span');
      segmentEl.className = 'ytp-caption-segment';
      segmentEl.textContent = 'Hello world';

      const lineEl = createMockElement('span');
      lineEl.className = 'caption-visual-line';
      lineEl.appendChild(segmentEl);

      const textEl = createMockElement('span');
      textEl.className = 'captions-text';
      textEl.appendChild(lineEl);

      const windowEl = createMockElement('div');
      windowEl.className = 'caption-window';
      windowEl.setAttribute('lang', 'ja');
      windowEl.appendChild(textEl);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(windowEl);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 0 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalled();
      const firstResult = callback.mock.calls[0][0];
      expect(firstResult.textTracks[0].text).toContain('Hello world');

      // Simulate caption disappearing (pause)
      container.children = [];
      video.currentTime = 2;
      callback.mockClear();
      expect(mockObservers.length).toBeGreaterThanOrEqual(1);
      mockObservers[0].trigger([]);
      vi.advanceTimersByTime(200);

      // Caption reappears with same text
      const newWindow = createMockElement('div');
      newWindow.className = 'caption-window';
      newWindow.setAttribute('lang', 'ja');

      const newSegment = createMockElement('span');
      newSegment.className = 'ytp-caption-segment';
      newSegment.textContent = 'Hello world';

      const newLine = createMockElement('span');
      newLine.className = 'caption-visual-line';
      newLine.appendChild(newSegment);

      const newText = createMockElement('span');
      newText.className = 'captions-text';
      newText.appendChild(newLine);
      newWindow.appendChild(newText);
      container.appendChild(newWindow);

      video.currentTime = 3;
      mockObservers[0].trigger([]);
      vi.advanceTimersByTime(200);

      expect(callback).toHaveBeenCalled();
      const secondResult = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(secondResult.textTracks[0].text).toContain('Hello world');

      cleanup();
    });

    it('does not re-emit identical content within throttle window', () => {
      const segmentEl = createMockElement('span');
      segmentEl.className = 'ytp-caption-segment';
      segmentEl.textContent = 'Hello world';

      const lineEl = createMockElement('span');
      lineEl.className = 'caption-visual-line';
      lineEl.appendChild(segmentEl);

      const textEl = createMockElement('span');
      textEl.className = 'captions-text';
      textEl.appendChild(lineEl);

      const windowEl = createMockElement('div');
      windowEl.className = 'caption-window';
      windowEl.setAttribute('lang', 'ja');
      windowEl.appendChild(textEl);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(windowEl);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 0 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);
      const callCountAfterFirst = callback.mock.calls.length;

      // Advance time but keep same caption text - heartbeat should not re-emit
      video.currentTime = 5;
      vi.advanceTimersByTime(2500);

      // Should still have same call count because content hasn't changed
      expect(callback.mock.calls.length).toBe(callCountAfterFirst);

      cleanup();
    });

    it('deduplicates parent wrapper and child line elements', () => {
      const segmentEl = createMockElement('span');
      segmentEl.className = 'ytp-caption-segment';
      segmentEl.textContent = 'Hello world';

      const lineEl = createMockElement('span');
      lineEl.className = 'caption-visual-line';
      lineEl.appendChild(segmentEl);

      // .captions-text is a parent wrapper containing .caption-visual-line
      const textEl = createMockElement('span');
      textEl.className = 'captions-text';
      textEl.appendChild(lineEl);

      const windowEl = createMockElement('div');
      windowEl.className = 'caption-window';
      windowEl.setAttribute('lang', 'ja');
      windowEl.appendChild(textEl);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(windowEl);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 5 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);

      expect(callback).toHaveBeenCalled();
      const result = callback.mock.calls[0][0];
      expect(result.textTracks[0].text).toContain('Hello world');
      // Should contain exactly one instance of the text, not duplicated
      const matches = result.textTracks[0].text.match(/Hello world/g);
      expect(matches).toHaveLength(1);

      cleanup();
    });

    it('filters out UI-only text like caption settings labels', () => {
      const segment1 = createMockElement('span');
      segment1.className = 'ytp-caption-segment';
      segment1.textContent = 'Japanese (auto-generated)';

      const segment2 = createMockElement('span');
      segment2.className = 'ytp-caption-segment';
      segment2.textContent = 'Click for settings';

      const lineEl = createMockElement('span');
      lineEl.className = 'caption-visual-line';
      lineEl.appendChild(segment1);
      lineEl.appendChild(segment2);

      const windowEl = createMockElement('div');
      windowEl.className = 'caption-window';
      windowEl.setAttribute('lang', 'ja');
      windowEl.appendChild(lineEl);

      const container = createMockElement('div');
      container.className = 'ytp-caption-window-container';
      container.appendChild(windowEl);

      const docElement = createMockElement('html');
      docElement.appendChild(container);

      const mockDocument = {
        querySelector: (selector: string) => {
          if (selector === '.ytp-caption-window-container') return container;
          return null;
        },
        documentElement: docElement,
        contains: () => true,
      };
      vi.stubGlobal('document', mockDocument);

      vi.useFakeTimers();
      const video = { currentTime: 5 } as HTMLVideoElement;
      const callback = vi.fn();
      const cleanup = youtubePlatform.startMonitoring(video, callback);

      vi.advanceTimersByTime(200);

      // Should not emit because the only visible text is UI text
      expect(callback).not.toHaveBeenCalled();

      cleanup();
    });
  });
});
