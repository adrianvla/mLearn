// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { useToolbarOverflow } from './useToolbarOverflow';

describe('reader toolbar overflow', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;
  let available: number;
  let frames: FrameRequestCallback[];
  const flush = async () => {
    await Promise.resolve();
    const pending = frames.splice(0);
    pending.forEach(callback => callback(0));
    await Promise.resolve();
  };
  beforeEach(() => {
    available = 700; frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div'); document.body.append(container);
  });
  afterEach(() => { dispose?.(); container.remove(); vi.unstubAllGlobals(); });

  function mount(initial = true) {
    const [loaded, setLoaded] = createSignal(initial);
    const Content = () => {
      let root: HTMLElement | undefined;
      let menu: HTMLDetailsElement | undefined;
      const controls = useToolbarOverflow(() => menu, () => root);
      return <nav ref={element => {
        root = element;
        Object.defineProperty(element, 'clientWidth', { get: () => available });
      }}>
        <span ref={element => { element.getBoundingClientRect = () => ({ width: 100 } as DOMRect); }}>Book</span>
        <Show when={loaded()}><div data-overflow-inline /><details ref={menu} open={controls.open()} data-overflow={String(controls.overflow())}>
          <summary ref={element => { element.getBoundingClientRect = () => ({ width: 40 } as DOMRect); }} onClick={controls.toggle}>Options</summary>
          <div data-overflow-panel><div data-overflow-priority="0" ref={element => { element.getBoundingClientRect = () => ({ width: 400 } as DOMRect); }}>
            <input aria-label="existing control" value="retained" />
          </div></div>
        </details></Show>
      </nav>;
    };
    dispose = render(() => <Content />, container);
    return setLoaded;
  }

  it('shows controls inline until the available width cannot contain them', async () => {
    mount(); await flush();
    expect(container.querySelector('details')?.dataset.overflow).toBe('false');
    const input = container.querySelector('input');
    available = 450; window.dispatchEvent(new Event('resize')); await flush();
    expect(container.querySelector('details')?.dataset.overflow).toBe('true');
    available = 700; window.dispatchEvent(new Event('resize')); await flush();
    expect(container.querySelector('details')?.dataset.overflow).toBe('false');
    expect(container.querySelector('input')).toBe(input);
    expect(container.querySelectorAll('input')).toHaveLength(1);
  });

  it('measures controls that appear after opening a document', async () => {
    available = 450;
    const setLoaded = mount(false); await flush();
    setLoaded(true); await flush(); await flush();
    expect(container.querySelector('details')?.dataset.overflow).toBe('true');
  });
});
