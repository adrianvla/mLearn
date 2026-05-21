import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getSitePlatform } from './index';
import { genericPlatform } from './generic';
import { youtubePlatform } from './youtube';

class MockMutationObserver {
  private callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
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
  });
});
