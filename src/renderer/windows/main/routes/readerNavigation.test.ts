import { describe, expect, it, vi } from 'vitest';
import { scrollReaderToPageStart } from './readerNavigation';

describe('scrollReaderToPageStart', () => {
  it('resets the reader content scroll position without scrolling the window', () => {
    const scrollTo = vi.fn();

    scrollReaderToPageStart({ scrollTo } as unknown as HTMLElement);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
