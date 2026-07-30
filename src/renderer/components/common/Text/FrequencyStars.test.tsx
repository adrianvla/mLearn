import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'solid-js/web';
import { FrequencyStars, type FrequencyStarsProps } from './FrequencyStars';

const rect = (left: number, right: number, top = 0, height = 10): DOMRect =>
  ({ left, right, top, bottom: top + height, width: right - left, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe('FrequencyStars', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const renderStars = (props: FrequencyStarsProps, parent?: HTMLElement): HTMLElement => {
    const host = parent ?? container;
    render(() => <FrequencyStars {...props} />, host);
    return host;
  };

  const withNeighbors = (word: HTMLSpanElement, gapLeft: number, gapRight: number, sameLine = true) => {
    const before = document.createElement('span');
    const after = document.createElement('span');
    container.append(before, word, after);
    word.getBoundingClientRect = () => rect(10, 20);
    before.getBoundingClientRect = () => rect(10 - gapLeft - 5, 10 - gapLeft);
    after.getBoundingClientRect = () => rect(20 + gapRight, 20 + gapRight + 10, sameLine ? 0 : 100);
    return { before, after };
  };

  it('renders one star per level with collapse=never', () => {
    const el = renderStars({ level: 4, collapse: 'never' });
    expect(el.querySelectorAll('.star')).toHaveLength(4);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('renders compact count with collapse=always', () => {
    const el = renderStars({ level: 4, collapse: 'always' });
    expect(el.querySelectorAll('.star')).toHaveLength(1);
    expect(el.querySelector('.star-count')?.textContent).toBe('4');
  });

  it('keeps full stars in auto mode when they fit', () => {
    const word = document.createElement('span');
    withNeighbors(word, 100, 100);
    const el = renderStars({ level: 4, collapse: 'auto', margin: 8 }, word);
    expect(el.querySelectorAll('.star')).toHaveLength(4);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('collapses in auto mode when stars do not fit between neighbors', () => {
    const word = document.createElement('span');
    withNeighbors(word, 5, 10);
    const el = renderStars({ level: 4, collapse: 'auto', margin: 8 }, word);
    expect(el.querySelectorAll('.star')).toHaveLength(1);
    expect(el.querySelector('.star-count')?.textContent).toBe('4');
  });

  it('margin decides the auto-collapse threshold', () => {
    const wideMarginWord = document.createElement('span');
    withNeighbors(wideMarginWord, 32, 32);
    const collapsed = renderStars({ level: 4, collapse: 'auto', margin: 8 }, wideMarginWord);
    expect(collapsed.querySelector('.star-count')?.textContent).toBe('4');

    const noMarginWord = document.createElement('span');
    withNeighbors(noMarginWord, 32, 32);
    const full = renderStars({ level: 4, collapse: 'auto', margin: 0 }, noMarginWord);
    expect(full.querySelectorAll('.star')).toHaveLength(4);
    expect(full.querySelector('.star-count')).toBeNull();
  });

  it('ignores siblings on a different line', () => {
    const word = document.createElement('span');
    withNeighbors(word, 0, 0, false);
    const el = renderStars({ level: 4, collapse: 'auto', margin: 8 }, word);
    expect(el.querySelectorAll('.star')).toHaveLength(4);
    expect(el.querySelector('.star-count')).toBeNull();
  });

  it('respects maxStars', () => {
    const el = renderStars({ level: 7, maxStars: 3, collapse: 'never' });
    expect(el.querySelectorAll('.star')).toHaveLength(3);
  });

  it('keeps the visual level color while compact', () => {
    const el = renderStars({ level: 3, visualLevel: 4, collapse: 'always' });
    expect(el.querySelector('.frequency')?.getAttribute('data-level')).toBe('4');
    expect(el.querySelector('.frequency')?.getAttribute('data-raw-level')).toBe('3');
  });
});
