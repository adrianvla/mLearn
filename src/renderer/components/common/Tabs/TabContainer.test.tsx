// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { TabContainer, type TabItem } from './TabContainer';

const makeTabs = (): TabItem[] => [
  { id: 'a', label: 'Tab A' },
  { id: 'b', label: 'Tab B' },
  { id: 'c', label: 'Tab C' },
];

describe('TabContainer', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  let setActive: (v: string) => void;
  let onTabChange: ReturnType<typeof vi.fn<(id: string) => void>>;

  const mount = (tabs: TabItem[], orientation: 'horizontal' | 'vertical' = 'horizontal') => {
    const [active, setActiveFn] = createSignal('a');
    setActive = setActiveFn;
    onTabChange = vi.fn((id: string) => setActive(id));
    dispose = render(() => (
      <TabContainer
        tabs={tabs}
        activeTab={active()}
        onTabChange={onTabChange}
        orientation={orientation}
        idBase="test-tabs"
      />
    ), container);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
    vi.clearAllMocks();
  });

  const tabList = () => container.querySelector('[role="tablist"]') as HTMLElement;
  const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const press = (key: string) => {
    tabList().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  it('sets roving tabindex and tablist attributes', () => {
    mount(makeTabs());

    expect(tabList().getAttribute('aria-orientation')).toBe('horizontal');
    const btns = buttons();
    expect(btns).toHaveLength(3);
    expect(btns[0].getAttribute('aria-selected')).toBe('true');
    expect(btns[0].tabIndex).toBe(0);
    expect(btns[1].tabIndex).toBe(-1);
    expect(btns[2].tabIndex).toBe(-1);
  });

  it('links tabs to panels with ids and aria-controls', () => {
    mount(makeTabs());

    const btns = buttons();
    btns.forEach((btn, i) => {
      expect(btn.id).toBe(`test-tabs-tab-${['a', 'b', 'c'][i]}`);
      expect(btn.getAttribute('aria-controls')).toBe(`test-tabs-panel-${['a', 'b', 'c'][i]}`);
    });
  });

  it('advances and wraps with ArrowRight on a horizontal tablist', () => {
    mount(makeTabs());

    press('ArrowRight');
    expect(onTabChange).toHaveBeenLastCalledWith('b');
    expect(buttons()[1].getAttribute('aria-selected')).toBe('true');
    expect(buttons()[1].tabIndex).toBe(0);
    expect(buttons()[0].tabIndex).toBe(-1);

    press('ArrowRight');
    expect(onTabChange).toHaveBeenLastCalledWith('c');

    press('ArrowRight');
    expect(onTabChange).toHaveBeenLastCalledWith('a');
    expect(buttons()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('advances with ArrowDown on a vertical tablist', () => {
    mount(makeTabs(), 'vertical');

    press('ArrowDown');
    expect(onTabChange).toHaveBeenLastCalledWith('b');

    press('ArrowDown');
    expect(onTabChange).toHaveBeenLastCalledWith('c');

    press('ArrowDown');
    expect(onTabChange).toHaveBeenLastCalledWith('a');
  });

  it('retreats and wraps with ArrowLeft on a horizontal tablist', () => {
    mount(makeTabs());

    press('ArrowLeft');
    expect(onTabChange).toHaveBeenLastCalledWith('c');
    expect(buttons()[2].getAttribute('aria-selected')).toBe('true');

    press('ArrowLeft');
    expect(onTabChange).toHaveBeenLastCalledWith('b');

    press('ArrowLeft');
    expect(onTabChange).toHaveBeenLastCalledWith('a');
  });

  it('retreats with ArrowUp on a vertical tablist', () => {
    mount(makeTabs(), 'vertical');

    press('ArrowUp');
    expect(onTabChange).toHaveBeenLastCalledWith('c');

    press('ArrowUp');
    expect(onTabChange).toHaveBeenLastCalledWith('b');
  });

  it('jumps to the first and last tab with Home and End', () => {
    mount(makeTabs());

    press('End');
    expect(onTabChange).toHaveBeenLastCalledWith('c');

    press('Home');
    expect(onTabChange).toHaveBeenLastCalledWith('a');
  });

  it('focuses the newly active tab after keyboard navigation', () => {
    mount(makeTabs());

    press('ArrowRight');
    expect(document.activeElement?.id).toBe('test-tabs-tab-b');
  });

  it('calls onTabChange with the clicked tab id', () => {
    mount(makeTabs());

    buttons()[2].click();
    expect(onTabChange).toHaveBeenCalledWith('c');
    expect(buttons()[2].getAttribute('aria-selected')).toBe('true');
  });
});
