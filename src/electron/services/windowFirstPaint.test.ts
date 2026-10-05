import { describe, expect, it, vi } from 'vitest';
import { initialWindowBackground, registerWindowFirstPaint, showWindowAfterFirstPaint, type FirstPaintWindow } from './windowFirstPaint';

function fakeWindow() {
  const events = new Map<string, () => void>();
  const window: FirstPaintWindow = {
    once: (event, listener) => events.set(event, listener),
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
  };
  return { window, emit: (event: string) => events.get(event)?.() };
}

describe('first frame, not a white native window', () => {
  it('coalesces repeated requests until first paint', () => {
    const { window, emit } = fakeWindow();
    registerWindowFirstPaint(window);
    showWindowAfterFirstPaint(window); showWindowAfterFirstPaint(window);
    expect(window.show).not.toHaveBeenCalled();
    emit('ready-to-show');
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
  it('does not show a deliberately hidden startup window merely because it paints', () => {
    const { window, emit } = fakeWindow();
    registerWindowFirstPaint(window); emit('ready-to-show');
    expect(window.show).not.toHaveBeenCalled();
    showWindowAfterFirstPaint(window);
    expect(window.show).toHaveBeenCalledOnce();
  });
  it('never reopens a destroyed window', () => {
    const { window, emit } = fakeWindow();
    registerWindowFirstPaint(window); showWindowAfterFirstPaint(window);
    vi.mocked(window.isDestroyed).mockReturnValue(true); emit('closed'); emit('ready-to-show');
    expect(window.show).not.toHaveBeenCalled();
  });
  it('restores an already painted minimized window normally', () => {
    const { window, emit } = fakeWindow();
    registerWindowFirstPaint(window); emit('ready-to-show');
    vi.mocked(window.isMinimized).mockReturnValue(true);
    showWindowAfterFirstPaint(window);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
  });
  it('respects explicit light and dark palettes before settings hydrate', () => {
    expect(initialWindowBackground('dark-quartz')).toBe('#2b2c2a');
    expect(initialWindowBackground('chalk')).toBe('#f5f5f5');
    expect(initialWindowBackground('oled')).toBe('#000000');
  });
});
