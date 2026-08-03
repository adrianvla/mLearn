// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WelcomeContinueRow } from './WelcomeContinueRow';
import type { RecentItem } from '../../../../services/thumbnailService';

const makeItem = (overrides: Partial<RecentItem> = {}): RecentItem => ({
  type: 'video',
  name: 'Clip',
  path: '/clip.mp4',
  progress: 40,
  lastWatched: 0,
  ...overrides,
});

describe('WelcomeContinueRow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders the item and continues through both the main area and the action button', () => {
    const onContinue = vi.fn();
    const item = makeItem();
    const dispose = render(
      () => (
        <WelcomeContinueRow
          item={item}
          continueLabel="Continue"
          lastWatchedLabel="yesterday"
          onContinue={onContinue}
        />
      ),
      container,
    );

    expect(container.querySelector('.welcome-continue-title')?.textContent).toBe('Clip');
    expect(container.querySelector('.welcome-continue-meta')?.textContent).toBe('yesterday');
    expect(container.querySelector('.welcome-continue-pct')?.textContent).toBe('40%');
    expect(container.querySelector<HTMLProgressElement>('progress.welcome-continue-progress')?.value).toBe(40);

    container.querySelector<HTMLButtonElement>('button.welcome-continue-main')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onContinue).toHaveBeenCalledWith(item);

    container.querySelector<HTMLButtonElement>('button.welcome-continue-action')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onContinue).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('renders the thumbnail image with a decorative empty alt when present', () => {
    const dispose = render(
      () => (
        <WelcomeContinueRow
          item={makeItem({ thumbnail: 'data:image/png;base64,AAAA' })}
          continueLabel="Continue"
          lastWatchedLabel="yesterday"
          onContinue={() => {}}
        />
      ),
      container,
    );

    const img = container.querySelector<HTMLImageElement>('img.welcome-continue-thumb');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img?.getAttribute('alt')).toBe('');

    dispose();
  });

  it('falls back to a media-type icon when no thumbnail exists', () => {
    const dispose = render(
      () => (
        <WelcomeContinueRow
          item={makeItem({ type: 'book', name: 'Book' })}
          continueLabel="Continue"
          lastWatchedLabel="yesterday"
          onContinue={() => {}}
        />
      ),
      container,
    );

    expect(container.querySelector('img.welcome-continue-thumb')).toBeNull();
    expect(container.querySelector('.welcome-continue-fallback')).not.toBeNull();

    dispose();
  });
});
