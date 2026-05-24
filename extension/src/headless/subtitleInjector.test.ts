import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getBestVideo } from './subtitleInjector';

function mockVideo(rect: { width: number; height: number }) {
  return {
    getBoundingClientRect: () => ({
      ...rect,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLVideoElement;
}

function mockElement(children: unknown[] = [], shadowChildren?: unknown[]): Element {
  const el: {
    shadowRoot: ShadowRoot | null;
    querySelectorAll: (sel: string) => unknown[];
  } = {
    shadowRoot: shadowChildren
      ? (mockElement(shadowChildren) as unknown as ShadowRoot)
      : null,
    querySelectorAll: (sel: string) => {
      if (sel === 'video')
        return children.filter(
          (c) => c && 'getBoundingClientRect' in (c as object),
        );
      if (sel === '*') return children;
      return [];
    },
  };
  return el as unknown as Element;
}

describe('getBestVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds video in light DOM', () => {
    const v = mockVideo({ width: 100, height: 100 });
    vi.stubGlobal('document', mockElement([v]));
    expect(getBestVideo()).toBe(v);
  });

  it('finds video inside shadow DOM', () => {
    const shadowVideo = mockVideo({ width: 200, height: 200 });
    const host = mockElement([], [shadowVideo]);
    vi.stubGlobal('document', mockElement([host]));
    expect(getBestVideo()).toBe(shadowVideo);
  });

  it('selects largest visible video', () => {
    const small = mockVideo({ width: 10, height: 10 });
    const large = mockVideo({ width: 100, height: 100 });
    vi.stubGlobal('document', mockElement([small, large]));
    expect(getBestVideo()).toBe(large);
  });

  it('returns null when no videos exist', () => {
    vi.stubGlobal('document', mockElement([]));
    expect(getBestVideo()).toBeNull();
  });

  it('ignores videos with zero area', () => {
    const zero = mockVideo({ width: 0, height: 100 });
    vi.stubGlobal('document', mockElement([zero]));
    expect(getBestVideo()).toBeNull();
  });
});
