// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import {
  SkeletonLine,
  SkeletonText,
  SkeletonPill,
  SkeletonInline,
  SkeletonRows,
  SkeletonGrid,
  SkeletonCard,
  SkeletonStatGrid,
} from './Skeleton';

describe('Skeleton primitives', () => {
  it('renders the requested number of text lines with a shortened last line', () => {
    const container = document.createElement('div');
    const dispose = render(() => <SkeletonText lines={4} />, container);

    const lines = container.querySelectorAll('.skeleton-text .skeleton-line');
    expect(lines).toHaveLength(4);
    expect(lines[3]!.classList.contains('skeleton-text__line--last')).toBe(true);
    expect(lines[0]!.classList.contains('skeleton-text__line--last')).toBe(false);

    dispose();
  });

  it('renders the requested number of rows and grid cells', () => {
    const container = document.createElement('div');
    const dispose = render(
      () => (
        <>
          <SkeletonRows rows={7} />
          <SkeletonGrid cells={12} />
        </>
      ),
      container,
    );

    expect(container.querySelectorAll('.skeleton-rows .skeleton-row')).toHaveLength(7);
    expect(container.querySelectorAll('.skeleton-grid .skeleton-grid__cell')).toHaveLength(12);

    dispose();
  });

  it('renders stat placeholders and card titles', () => {
    const container = document.createElement('div');
    const dispose = render(() => <SkeletonStatGrid count={3} />, container);
    expect(container.querySelectorAll('.skeleton-stat')).toHaveLength(3);
    dispose();

    const cardContainer = document.createElement('div');
    const cardDispose = render(() => <SkeletonCard lines={2} />, cardContainer);
    expect(cardContainer.querySelectorAll('.skeleton-card .skeleton-card__title')).toHaveLength(1);
    expect(cardContainer.querySelectorAll('.skeleton-card .skeleton-card__line')).toHaveLength(2);
    cardDispose();
  });

  it('marks placeholders as decorative and supports static rendering', () => {
    const container = document.createElement('div');
    const dispose = render(
      () => (
        <>
          <SkeletonLine />
          <SkeletonPill />
          <SkeletonInline />
          <SkeletonText lines={2} animate={false} />
        </>
      ),
      container,
    );

    expect(container.querySelector('.skeleton-text')!.getAttribute('aria-hidden')).toBe('true');
    const staticLines = container.querySelectorAll('.skeleton-text .skeleton--static');
    expect(staticLines.length).toBeGreaterThan(0);
    // Animated primitives do not carry the static modifier.
    expect(container.querySelector('.skeleton-line')!.classList.contains('skeleton--static')).toBe(false);

    dispose();
  });

  it('applies explicit widths', () => {
    const container = document.createElement('div');
    const dispose = render(() => <SkeletonLine width="12rem" />, container);

    const line = container.querySelector('.skeleton-line') as HTMLElement;
    expect(line.style.width).toBe('12rem');

    dispose();
  });
});
