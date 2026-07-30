import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'solid-js/web';
import { FrequencyStars } from './FrequencyStars';

describe('FrequencyStars', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const renderStars = (props: Parameters<typeof FrequencyStars>[0]): HTMLElement => {
    container.innerHTML = '';
    render(() => <FrequencyStars {...props} />, container);
    return container;
  };

  it('renders one star per level without a word', () => {
    const el = renderStars({ level: 4 });
    expect(el.querySelectorAll('.star')).toHaveLength(4);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('caps a 1-glyph word at 2 stars', () => {
    const el = renderStars({ level: 2, word: '字' });
    expect(el.querySelectorAll('.star')).toHaveLength(2);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('renders compact count for a 1-glyph word above the cap', () => {
    const el = renderStars({ level: 4, word: '字' });
    expect(el.querySelectorAll('.star')).toHaveLength(1);
    expect(el.querySelector('.star-count')?.textContent).toBe('4');
  });

  it('caps a 2-glyph word at 5 stars', () => {
    const el = renderStars({ level: 5, word: '学习' });
    expect(el.querySelectorAll('.star')).toHaveLength(5);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('renders compact count for a 2-glyph word above the cap', () => {
    const el = renderStars({ level: 7, word: '学习' });
    expect(el.querySelectorAll('.star')).toHaveLength(1);
    expect(el.querySelector('.star-count')?.textContent).toBe('7');
  });

  it('shows all stars for a 3-glyph word', () => {
    const el = renderStars({ level: 6, word: '学习语' });
    expect(el.querySelectorAll('.star')).toHaveLength(6);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('keeps the visual level color while compact', () => {
    const el = renderStars({ level: 3, visualLevel: 4, word: '字' });
    expect(el.querySelector('.frequency')?.getAttribute('data-level')).toBe('4');
    expect(el.querySelector('.frequency')?.getAttribute('data-raw-level')).toBe('3');
  });
});
