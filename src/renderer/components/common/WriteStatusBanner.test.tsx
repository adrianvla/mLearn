// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WriteStatusBanner } from './WriteStatusBanner';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe('WriteStatusBanner', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { container.remove(); });

  const renderBanner = (props: Partial<Parameters<typeof WriteStatusBanner>[0]> = {}) => render(
    () => (
      <WriteStatusBanner
        status={null}
        savingLabelKey="save.key"
        failedLabelKey="fail.key"
        canRetry={false}
        onRetry={() => {}}
        {...props}
      />
    ),
    container,
  );

  it('renders nothing when no write is in flight', () => {
    const dispose = renderBanner();
    expect(container.textContent).toBe('');
    dispose();
  });

  it('announces a pending write politely', () => {
    const dispose = renderBanner({ status: 'pending' });
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('save.key');
    dispose();
  });

  it('raises a failure banner with the failed label', () => {
    const dispose = renderBanner({ status: 'failed', canRetry: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('fail.key');
    dispose();
  });

  it('retries only when a retry is actually possible', () => {
    const onRetry = vi.fn();
    const blocked = renderBanner({ status: 'failed', canRetry: false, onRetry });
    expect(container.querySelector('button')).toBeNull();
    blocked();

    const allowed = renderBanner({ status: 'failed', canRetry: true, onRetry });
    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.textContent).toBe('mlearn.Global.TryAgain');
    allowed();
  });

  it('never shows the retry button for an in-flight write', () => {
    const dispose = renderBanner({ status: 'pending', canRetry: true });
    expect(container.querySelector('button')).toBeNull();
    dispose();
  });

  it('applies the surface class and the failure-only class', () => {
    const dispose = renderBanner({ status: 'failed', canRetry: true, class: 'write', failedClass: 'write--failed' });
    expect(container.querySelector('[role="alert"]')?.className).toBe('write write--failed');
    dispose();
  });

  it('keeps the base class off the saving banner', () => {
    const dispose = renderBanner({ status: 'pending', class: 'write', failedClass: 'write--failed' });
    expect(container.querySelector('[role="status"]')?.className).toBe('write');
    dispose();
  });
});
