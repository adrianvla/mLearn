// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { ResponsiveSidebar } from './ResponsiveSidebar';

describe('ResponsiveSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('opens from its mobile control and closes when its backdrop is activated', () => {
    const dispose = render(() => {
      const [isOpen, setIsOpen] = createSignal(false);
      return (
        <div class="test-sidebar-layout">
          <ResponsiveSidebar
            id="test-navigation"
            label="Navigation"
            title="Current section"
            open={isOpen()}
            onOpenChange={setIsOpen}
          >
            <p>Sidebar content</p>
          </ResponsiveSidebar>
          <main>Main content</main>
        </div>
      );
    }, container);

    const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="test-navigation"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.responsive-sidebar--open')).toBeNull();

    toggle?.click();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#test-navigation')?.classList.contains('responsive-sidebar--open')).toBe(true);

    container.querySelector<HTMLButtonElement>('.responsive-sidebar__backdrop')?.click();

    expect(container.querySelector('.responsive-sidebar--open')).toBeNull();
    dispose();
  });
});
