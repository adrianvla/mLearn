// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { Popover } from './Popover';

const fixedRect = (left: number, right: number, top: number, bottom: number) => ({
  left,
  right,
  top,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON: () => ({}),
});

describe('Popover', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  let open: () => boolean;
  let setOpen: (v: boolean) => void;
  let onCloseMock: ReturnType<typeof vi.fn<() => void>>;
  let anchorEl: HTMLButtonElement;

  const mount = () => {
    dispose = render(() => (
      <Popover
        open={open}
        anchor={() => anchorEl}
        onClose={onCloseMock}
        label="Test popover"
      >
        <button type="button" class="popover-child">panel content</button>
      </Popover>
    ), container);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    anchorEl = document.createElement('button');
    container.appendChild(anchorEl);
    [open, setOpen] = createSignal(false);
    onCloseMock = vi.fn<() => void>();
  });

  afterEach(() => {
    dispose?.();
    anchorEl.remove();
    container.remove();
  });

  it('renders nothing while closed', () => {
    mount();
    expect(document.body.querySelector('.popover-panel')).toBeNull();
    expect(document.body.textContent).not.toContain('panel content');
  });

  it('portals the panel into document.body when open', () => {
    mount();
    setOpen(true);
    expect(container.querySelector('.popover-panel')).toBeNull();
    const panel = document.body.querySelector('.popover-panel');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('panel content');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-label')).toBe('Test popover');
  });

  it('removes the panel from the document when closed again', () => {
    mount();
    setOpen(true);
    setOpen(false);
    expect(document.body.querySelector('.popover-panel')).toBeNull();
  });

  it('positions the panel below the anchor with right edges aligned and viewport clamped', () => {
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    try {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 240 });
      Object.defineProperty(anchorEl, 'getBoundingClientRect', {
        configurable: true,
        value: () => fixedRect(100, 340, 50, 78),
      });
      mount();
      setOpen(true);
      const panel = document.body.querySelector('.popover-panel') as HTMLElement;
      expect(panel.style.left).toBe('100px'); // 340 - 240 = 100 (right edges aligned)
      expect(panel.style.top).toBe('86px'); // 78 + 8
    } finally {
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      }
    }
  });

  it('clamps the panel inside the viewport with 8px margins', () => {
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    try {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 500 });
      Object.defineProperty(anchorEl, 'getBoundingClientRect', {
        configurable: true,
        value: () => fixedRect(900, 1100, 10, 30), // anchor wider than the viewport
      });
      mount();
      setOpen(true);
      const panel = document.body.querySelector('.popover-panel') as HTMLElement;
      expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
      expect(parseFloat(panel.style.left) + 500).toBeLessThanOrEqual(window.innerWidth - 8);
      expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
    } finally {
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      }
    }
  });

  it('calls onClose on Escape while open', () => {
    mount();
    setOpen(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape while closed', () => {
    mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('calls onClose on pointerdown outside the panel and anchor', () => {
    mount();
    setOpen(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on pointerdown inside the panel', () => {
    mount();
    setOpen(true);
    const panel = document.body.querySelector('.popover-panel') as HTMLElement;
    panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('does not call onClose on pointerdown on the anchor element', () => {
    mount();
    setOpen(true);
    anchorEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('cleans up listeners on unmount while open', () => {
    mount();
    setOpen(true);
    dispose();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(document.body.querySelector('.popover-panel')).toBeNull();
  });
});
