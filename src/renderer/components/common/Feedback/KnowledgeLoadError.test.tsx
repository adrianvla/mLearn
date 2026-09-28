// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { KnowledgeLoadError } from './KnowledgeLoadError';

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe('KnowledgeLoadError', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('announces the failure and offers retry by default', () => {
    const onRetry = vi.fn();
    const dispose = render(() => <KnowledgeLoadError onRetry={onRetry} />, container);

    const root = container.querySelector('.knowledge-load-error')!;
    expect(root.getAttribute('role')).toBe('alert');
    expect(root.textContent).toContain('mlearn.Knowledge.LoadError');
    expect(root.textContent).toContain('mlearn.Knowledge.Retry');

    root.querySelector('button')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('renders no retry affordance when the surface cannot recover', () => {
    // KnowledgeProjection's history block passes onRetryHistory only when the
    // host supplied one; a Retry button that cannot act is worse than none.
    const dispose = render(() => <KnowledgeLoadError />, container);
    expect(container.querySelector('button')).toBeNull();
    dispose();
  });

  it('honours a message override, a non-alert role and host classes', () => {
    // The not-installed projection is a settled informational state, so it
    // uses role="status" and its own copy; characterGrid keeps its own layout.
    const dispose = render(() => (
      <KnowledgeLoadError
        message="mlearn.Knowledge.UnavailableHint"
        role="status"
        class="cg-error"
      />
    ), container);

    const root = container.querySelector('.knowledge-load-error')!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.className).toContain('cg-error');
    expect(root.textContent).toContain('mlearn.Knowledge.UnavailableHint');
    expect(root.textContent).not.toContain('mlearn.Knowledge.LoadError');
    dispose();
  });
});
