// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlashcardImage } from './FlashcardImage';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe('FlashcardImage', () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  const mount = (src: () => string) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(() => <FlashcardImage src={src()} alt="alt text" class="flashcard-screenshot" />, container);
    return container;
  };

  it('renders the image', () => {
    const el = mount(() => 'flashcard-image://a.png');
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('flashcard-image://a.png');
    expect(el.querySelector('.flashcard-image-unavailable')).toBeNull();
  });

  it('shows the unavailable fallback when the image fails to load', () => {
    const el = mount(() => 'flashcard-image://missing.png');
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(el.querySelector('img')).toBeNull();
    const fallback = el.querySelector('.flashcard-image-unavailable');
    expect(fallback?.textContent).toContain('mlearn.Flashcards.Card.ImageUnavailable');
    expect(fallback?.classList.contains('flashcard-screenshot')).toBe(true);
  });

  it('resets the fallback when the src changes', async () => {
    const [src, setSrc] = createSignal('flashcard-image://a.png');
    const el = mount(src);
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(el.querySelector('.flashcard-image-unavailable')).toBeTruthy();
    setSrc('flashcard-image://b.png');
    await Promise.resolve();
    expect(el.querySelector('img')?.getAttribute('src')).toBe('flashcard-image://b.png');
    expect(el.querySelector('.flashcard-image-unavailable')).toBeNull();
  });
});
