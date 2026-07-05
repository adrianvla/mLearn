// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OverlayControls } from './OverlayControls';

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

describe('OverlayControls subtitle offset controls', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  function renderControls(props: Partial<Parameters<typeof OverlayControls>[0]> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const onOffsetChange = vi.fn();
    const dispose = render(() => (
      <OverlayControls
        isConnected={true}
        hasSubtitles={true}
        showSubtitles={true}
        subtitleOffset={0}
        currentVideoTime={() => 0.5}
        subtitles={[
          { start: 1, end: 2, text: 'first' },
          { start: 120, end: 122, text: 'far away' },
        ]}
        onOffsetChange={onOffsetChange}
        onLoadSubtitles={vi.fn()}
        onToggleSubtitles={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    ), container);

    return { container, dispose, onOffsetChange };
  }

  it('snaps offset forward to the next subtitle by default', () => {
    const { container, dispose, onOffsetChange } = renderControls();
    const increase = container.querySelector('button[aria-label="mlearn.Overlay.IncreaseOffset"]') as HTMLButtonElement | null;

    increase?.click();

    expect(onOffsetChange).toHaveBeenCalledWith(0.5);
    dispose();
  });

  it('snaps offset backward to the previous subtitle by default', () => {
    const { container, dispose, onOffsetChange } = renderControls({
      subtitleOffset: 119.5,
      currentVideoTime: () => 0.5,
    });
    const decrease = container.querySelector('button[aria-label="mlearn.Overlay.DecreaseOffset"]') as HTMLButtonElement | null;

    decrease?.click();

    expect(onOffsetChange).toHaveBeenCalledWith(0.5);
    dispose();
  });

  it('nudges offset forward by a small amount in nudge mode', () => {
    const { container, dispose, onOffsetChange } = renderControls({ offsetControlMode: 'nudge' });
    const increase = container.querySelector('button[aria-label="mlearn.Overlay.IncreaseOffset"]') as HTMLButtonElement | null;

    increase?.click();

    expect(onOffsetChange).toHaveBeenCalledWith(0.1);
    dispose();
  });

  it('nudges offset backward by a small amount in nudge mode', () => {
    const { container, dispose, onOffsetChange } = renderControls({ subtitleOffset: 0.2, offsetControlMode: 'nudge' });
    const decrease = container.querySelector('button[aria-label="mlearn.Overlay.DecreaseOffset"]') as HTMLButtonElement | null;

    decrease?.click();

    expect(onOffsetChange).toHaveBeenCalledWith(0.1);
    dispose();
  });

  it('rounds direct offset input to two decimals', () => {
    const { container, dispose, onOffsetChange } = renderControls();
    const input = container.querySelector('.overlay-offset-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input!.value = '1.234';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new Event('blur', { bubbles: true }));

    expect(onOffsetChange).toHaveBeenCalledWith(1.23);
    dispose();
  });
});
