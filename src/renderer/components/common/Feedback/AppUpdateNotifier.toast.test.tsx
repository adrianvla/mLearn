// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { AppUpdateState } from '../../../../shared/appUpdate';
import { AppUpdateNotifier } from './AppUpdateNotifier';
import { ToastContainer } from './Toast';

let updateListener: ((state: AppUpdateState) => void) | undefined;

const idleState: AppUpdateState = {
  status: 'idle',
  currentVersion: '2.6.7',
  canAutoUpdate: true,
  supportReason: null,
  updatedAt: 1,
};

vi.mock('../../../../shared/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../shared/platform')>()),
  isElectron: () => true,
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    updates: {
      getUpdateState: () => Promise.resolve(idleState),
      onUpdateStateChanged: (listener: (state: AppUpdateState) => void) => {
        updateListener = listener;
        return vi.fn();
      },
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
    },
    window: { openExternalUrl: vi.fn() },
  }),
}));

vi.mock('../../../context/LocalizationContext', () => ({
  useLocalization: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}${values?.version ? ` ${values.version}` : ''}`,
  }),
}));

describe('AppUpdateNotifier with real toasts', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateListener = undefined;
  });

  afterEach(() => {
    container.remove();
    document.body.querySelectorAll('.toast-container').forEach((el) => { el.remove(); });
  });

  it('keeps the toast body reactive across state transitions', async () => {
    const dispose = render(() => (
      <>
        <ToastContainer />
        <AppUpdateNotifier />
      </>
    ), container);
    await Promise.resolve();
    const update = { version: '2.7.0', source: 'native' as const };

    updateListener?.({
      status: 'available', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 2, update,
    });
    const actionButton = () => document.body.querySelector('.app-update-toast__body button');
    expect(actionButton()?.textContent).toBe('mlearn.About.Updates.Download');

    updateListener?.({
      status: 'downloading', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 3, update,
      progress: { percent: 40, bytesPerSecond: 1, transferred: 40, total: 100 },
    });
    expect(document.body.textContent).toContain('mlearn.About.Updates.Downloading 2.7.0');
    expect(actionButton()).toBeNull();

    updateListener?.({
      status: 'downloaded', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 4, update,
    });
    expect(document.body.textContent).toContain('mlearn.About.Updates.Ready 2.7.0');
    expect(actionButton()?.textContent).toBe('mlearn.About.Updates.Restart');
    dispose();
  });
});
