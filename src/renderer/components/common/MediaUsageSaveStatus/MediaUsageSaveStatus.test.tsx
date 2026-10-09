import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { MediaUsageSaveStatus } from './MediaUsageSaveStatus';
vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
it('shows an unacknowledged failure and invokes its visible retry action', async () => {
  const [error, setError] = createSignal<unknown>(new Error('disk failed'));
  const retry = vi.fn(async () => { setError(null); });
  const container = document.createElement('div'); document.body.append(container);
  const dispose = render(() => <MediaUsageSaveStatus error={error()} retry={retry} />, container);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  container.querySelector('button')!.click(); await Promise.resolve();
  expect(retry).toHaveBeenCalledOnce(); expect(container.querySelector('[role="alert"]')).toBeNull();
  dispose(); container.remove();
});
