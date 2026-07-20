// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ToastContainer, showToast, updateToast } from './Toast';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Toast', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('auto-hides a task toast after its duration is updated from persistent to timed', async () => {
    const dispose = render(() => <ToastContainer />, container);
    const toastId = showToast({
      variant: 'info',
      message: 'Working',
      duration: 0,
    });

    await flushPromises();
    expect(document.body.textContent).toContain('Working');

    updateToast(toastId, {
      message: 'Done',
      duration: 1000,
    });

    await flushPromises();
    expect(document.body.textContent).toContain('Done');

    await vi.advanceTimersByTimeAsync(999);
    expect(document.body.textContent).toContain('Done');

    await vi.advanceTimersByTimeAsync(301);
    await flushPromises();
    expect(document.body.textContent).not.toContain('Done');

    dispose();
  });

  it('notifies the caller when the user dismisses a toast', async () => {
    const onDismiss = vi.fn();
    const dispose = render(() => <ToastContainer />, container);
    showToast({ variant: 'info', message: 'Update available', duration: 0, onDismiss });
    await flushPromises();

    (document.body.querySelector('.toast__close') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(301);

    expect(onDismiss).toHaveBeenCalledOnce();
    dispose();
  });
});
