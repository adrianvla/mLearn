import { describe, expect, it, vi } from 'vitest';
import { initialWindowBackground, loadRecoveryHtml, registerWindowFirstPaint, showWindowAfterFirstPaint, showWindowAfterLoadFailure, type FirstPaintWindow } from './windowFirstPaint';

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
  it('reveals a requested window on the themed recovery surface when its initial URL fails', () => {
    const { window } = fakeWindow();
    registerWindowFirstPaint(window);
    showWindowAfterFirstPaint(window);
    showWindowAfterLoadFailure(window);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
  it('respects explicit light and dark palettes before settings hydrate', () => {
    expect(initialWindowBackground('dark-quartz')).toBe('#2b2c2a');
    expect(initialWindowBackground('quartz')).toBe('#f3f5f7');
    expect(initialWindowBackground('chalk')).toBe('#f5f5f5');
    expect(initialWindowBackground('oled')).toBe('#000000');
    expect(initialWindowBackground('custom', { 'bg-opaque': '#223344' })).toBe('#223344');
    expect(initialWindowBackground('custom', { bg: 'rgba(10, 20, 30, 0.8)' })).toBe('rgba(10, 20, 30, 0.8)');
    expect(initialWindowBackground('custom', { bg: 'url(https://example.test)' })).toBe('#2b2c2a');
  });
  it('renders a complete themed recovery document with an escaped retry target', () => {
    const page = loadRecoveryHtml('http://localhost:3000/src/html/main.html?a=1&b="x"', '#ffffff');
    expect(page).toContain('<html><head>');
    expect(page).toContain('<body style="margin:0;min-height:100vh;background:#ffffff;color:#202124');
    expect(page).toContain('href="http://localhost:3000/src/html/main.html?a=1&amp;b=&quot;x&quot;"');
    expect(page).toContain('Try again');
  });
});
