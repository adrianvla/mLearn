// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { useToolbarOverflow } from './useToolbarOverflow';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  private targets = new Set<Element>();

  constructor(private callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) { this.targets.add(target); }
  isObserving(target: Element) { return this.targets.has(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  trigger(target: Element) {
    if (this.targets.has(target)) this.callback([], this as unknown as ResizeObserver);
  }
}

describe('useToolbarOverflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestResizeObserver.instances = [];
  });

  it('fits priority groups individually, reserves More, and preserves control identity, value and focus', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let width = 400, root!: HTMLElement, control!: HTMLInputElement;
    const metric = (element: HTMLElement, measured: number) => Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: measured }) });
    const Probe = () => {
      let menu!: HTMLDetailsElement;
      const toolbar = useToolbarOverflow(() => menu, () => root);
      return <section ref={element => { root = element; root.style.columnGap = '8px'; Object.defineProperty(root, 'clientWidth', { get: () => width }); }}>
        <button ref={element => metric(element, 80)}>Fixed</button>
        <div data-toolbar-min-width="96" ref={element => { metric(element, 240); Object.defineProperty(element, 'scrollWidth', { get: () => 240 }); }}>Long title</div>
        <div data-overflow-inline />
        <details ref={menu} open={toolbar.open()} classList={{ 'is-overflowing': toolbar.overflow() }}>
          <summary ref={element => metric(element, 50)} onClick={toolbar.toggle}>More</summary>
          <div data-overflow-panel ref={element => metric(element, 320)}>
            <div data-overflow-priority="3" ref={element => metric(element, 80)}><button>Files</button></div>
            <div data-overflow-priority="0" ref={element => metric(element, 100)}><input ref={control} value="retained" /></div>
            <div data-overflow-priority="2" ref={element => metric(element, 140)}><button>Secondary</button></div>
          </div>
        </details>
      </section>;
    };
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <Probe />, host);
    const flush = () => frames.splice(0).forEach(callback => callback(0));
    flush();
    expect(control.closest('[data-overflow-inline]')).not.toBeNull();
    expect(host.querySelectorAll('[data-overflow-panel] [data-overflow-priority]')).toHaveLength(2);
    control.value = 'learner choice'; control.focus();
    width = 340; TestResizeObserver.instances[0].trigger(root); flush();
    expect(control.closest('[data-overflow-panel]')).not.toBeNull();
    expect(host.querySelector('details')!.open).toBe(true);
    width = 540; TestResizeObserver.instances[0].trigger(root); flush();
    expect(control.closest('[data-overflow-inline]')).not.toBeNull();
    expect(host.querySelectorAll('input')).toHaveLength(1); expect(control.value).toBe('learner choice');
    expect(document.activeElement).toBe(control);
    expect(host.querySelectorAll('[data-overflow-panel] [data-overflow-priority]')).toHaveLength(0);
    dispose(); host.remove();
  });

  it('rechecks both threshold directions after control metrics change at a fixed window width', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let width = 440;
    let root!: HTMLElement;
    let fixed!: HTMLElement;

    const Probe = () => {
      let menu: HTMLDetailsElement | undefined;
      const overflow = useToolbarOverflow(() => menu, () => root);
      return (
        <section ref={element => {
          root = element;
          root.style.cssText = 'display:flex;column-gap:8px;padding-left:10px;padding-right:10px';
          Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width });
        }}>
          <button ref={element => {
            fixed = element;
            fixed.dataset.width = '50';
            Object.defineProperty(fixed, 'getBoundingClientRect', { value: () => ({ width: Number(fixed.dataset.width) }) });
          }}>fixed</button>
          <div class="reader-nav-title" data-toolbar-min-width="96" ref={element => {
            Object.defineProperty(element, 'scrollWidth', { get: () => 240 });
            Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 240 }) });
          }}>Long title</div>
          <div data-overflow-inline />
          <details ref={element => { menu = element; }} classList={{ 'is-overflowing': overflow.overflow() }} data-overflow={String(overflow.overflow())} open={overflow.open()}>
            <summary onClick={overflow.toggle}>More</summary>
            <div data-overflow-panel ref={element => {
              Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 180 }) });
            }}>
              <button ref={element => Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 180 }) })}>View control</button>
            </div>
          </details>
          <button ref={element => Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 60 }) })}>right</button>
        </section>
      );
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <Probe />, host);
    const observer = TestResizeObserver.instances[0];
    const details = host.querySelector<HTMLDetailsElement>('details')!;
    const flushFrames = () => frames.splice(0).forEach(callback => callback(0));
    flushFrames();

    expect(details.dataset.overflow).toBe('false');
    fixed.dataset.width = '400';
    expect(observer.isObserving(fixed)).toBe(true);
    observer.trigger(fixed);
    flushFrames();
    expect(details.dataset.overflow).toBe('true');
    fixed.dataset.width = '50';
    observer.trigger(fixed);
    flushFrames();
    expect(details.dataset.overflow).toBe('false');

    width = 420;
    observer.trigger(root);
    flushFrames();
    expect(details.dataset.overflow).toBe('true');
    width = 500;
    observer.trigger(root);
    flushFrames();
    expect(details.dataset.overflow).toBe('false');

    dispose();
    host.remove();
  });
});
