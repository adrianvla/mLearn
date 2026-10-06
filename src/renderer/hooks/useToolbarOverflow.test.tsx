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
          <details ref={element => { menu = element; }} classList={{ 'is-overflowing': overflow.overflow() }} data-overflow={String(overflow.overflow())} open={overflow.open()}>
            <summary onClick={overflow.toggle}>More</summary>
            <div data-overflow-panel ref={element => {
              Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 180 }) });
            }}>
              <button>View control</button>
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
