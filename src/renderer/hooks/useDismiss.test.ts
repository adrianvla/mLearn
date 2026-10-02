import { describe, it, expect, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useDismiss } from './useDismiss';

const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
const pointerDown = (target: Node) =>
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

/** Mount the hook in a reactive root and return a disposer. */
function mount(active: () => boolean, onDismiss: () => void, options: Partial<Parameters<typeof useDismiss>[0]> = {}) {
  let dispose!: () => void;
  createRoot((d) => {
    useDismiss(Object.defineProperties({ active, onDismiss }, Object.getOwnPropertyDescriptors(options)));
    dispose = d;
  });
  return dispose;
}

describe('useDismiss', () => {
  it('dismisses only the most recently opened surface per Escape, including synchronous close', () => {
    const outerDismiss = vi.fn();
    const innerDismiss = vi.fn();
    const [outer, setOuter] = createSignal(true);
    const [inner, setInner] = createSignal(true);
    const disposeOuter = mount(outer, () => { outerDismiss(); setOuter(false); });
    const disposeInner = mount(inner, () => { innerDismiss(); setInner(false); });
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(innerDismiss).toHaveBeenCalledOnce();
      expect(outerDismiss).not.toHaveBeenCalled();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(outerDismiss).toHaveBeenCalledOnce();
      setInner(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(innerDismiss).toHaveBeenCalledTimes(2);
    } finally { disposeInner(); disposeOuter(); }
  });

  it('lets a busy top surface reserve Escape without closing its parent or changing activation order', () => {
    const outerDismiss = vi.fn();
    const innerDismiss = vi.fn();
    const [enabled, setEnabled] = createSignal(false);
    const disposeOuter = mount(() => true, outerDismiss);
    const disposeInner = mount(() => true, innerDismiss, { get closeOnEscape() { return enabled(); } });
    try {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(innerDismiss).not.toHaveBeenCalled();
      expect(outerDismiss).not.toHaveBeenCalled();
      setEnabled(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(innerDismiss).toHaveBeenCalledOnce();
      expect(outerDismiss).not.toHaveBeenCalled();
    } finally { disposeInner(); disposeOuter(); }
  });

  it('does not dismiss for an Escape already consumed by another control', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss);
    try {
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      event.preventDefault();
      document.dispatchEvent(event);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('calls onDismiss when Escape is pressed while active', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss);
    escape();
    expect(onDismiss).toHaveBeenCalledOnce();
    dispose();
  });

  it('does not listen while inactive', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => false, onDismiss);
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
    dispose();
  });

  it('stops listening once the surface closes, and resumes when it reopens', () => {
    const onDismiss = vi.fn();
    let setActive!: (v: boolean) => void;
    let dispose!: () => void;
    createRoot((d) => {
      const [active, set] = createSignal(true);
      setActive = set;
      useDismiss({ active, onDismiss });
      dispose = d;
    });
    escape();
    expect(onDismiss).toHaveBeenCalledOnce();

    setActive(false);
    escape();
    expect(onDismiss).toHaveBeenCalledOnce(); // closed: no new dismissal

    setActive(true);
    escape();
    expect(onDismiss).toHaveBeenCalledTimes(2); // reopened: dismisses again
    dispose();
  });

  it('honors a changed Escape policy while the surface stays open', () => {
    const onDismiss = vi.fn();
    let setEscape!: (value: boolean) => void;
    const dispose = createRoot(dispose => {
      const [enabled, set] = createSignal(false);
      setEscape = set;
      useDismiss({ active: () => true, onDismiss, get closeOnEscape() { return enabled(); } });
      return dispose;
    });
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
    setEscape(true);
    escape();
    expect(onDismiss).toHaveBeenCalledOnce();
    dispose();
  });

  it('closeOnEscape:false ignores Escape', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss, { closeOnEscape: false, closeOnOutsidePointer: true });
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
    dispose();
  });

  it('dismisses on an outside pointer press only when closeOnOutsidePointer is set', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss);
    pointerDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled(); // off by default
    dispose();

    const onDismiss2 = vi.fn();
    const dispose2 = mount(() => true, onDismiss2, { closeOnOutsidePointer: true });
    pointerDown(document.body);
    expect(onDismiss2).toHaveBeenCalledOnce();
    dispose2();
  });

  it('a pointer press inside any listed node does not dismiss', () => {
    const inside = document.createElement('div');
    document.body.appendChild(inside);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss, { inside: () => [inside], closeOnOutsidePointer: true });
    pointerDown(inside);
    expect(onDismiss).not.toHaveBeenCalled();
    pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledOnce();
    inside.remove();
    outside.remove();
    dispose();
  });

  it('removes its listeners on unmount', () => {
    const onDismiss = vi.fn();
    const dispose = mount(() => true, onDismiss, { closeOnOutsidePointer: true });
    dispose();
    escape();
    pointerDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
