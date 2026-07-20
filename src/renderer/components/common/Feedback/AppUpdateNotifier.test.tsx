// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { AppUpdateState } from '../../../../shared/appUpdate';
import { AppUpdateNotifier } from './AppUpdateNotifier';

const { showToastMock, updateToastMock, removeToastMock } = vi.hoisted(() => ({
  showToastMock: vi.fn((_options?: unknown) => 41),
  updateToastMock: vi.fn(),
  removeToastMock: vi.fn(),
}));
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

vi.mock('./Toast', () => ({
  showToast: showToastMock,
  updateToast: updateToastMock,
  removeToast: removeToastMock,
}));

describe('AppUpdateNotifier', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateListener = undefined;
    showToastMock.mockClear();
    updateToastMock.mockClear();
    removeToastMock.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  it('keeps one toast through progress updates and promotes it when the update is ready', async () => {
    const dispose = render(() => <AppUpdateNotifier />, container);
    await Promise.resolve();
    const update = { version: '2.7.0', source: 'native' as const };

    updateListener?.({
      status: 'available', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 2, update,
    });
    updateListener?.({
      status: 'downloading', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 3, update,
      progress: { percent: 20, bytesPerSecond: 1, transferred: 20, total: 100 },
    });
    updateListener?.({
      status: 'downloading', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 4, update,
      progress: { percent: 40, bytesPerSecond: 1, transferred: 40, total: 100 },
    });

    expect(showToastMock).toHaveBeenCalledOnce();
    expect(updateToastMock).not.toHaveBeenCalled();

    updateListener?.({
      status: 'downloaded', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 5, update,
    });
    expect(updateToastMock).toHaveBeenCalledOnce();
    expect(updateToastMock).toHaveBeenCalledWith(41, expect.objectContaining({ variant: 'success' }));
    dispose();
  });

  it('shows install failures as errors and closes the notification after recovery', async () => {
    const dispose = render(() => <AppUpdateNotifier />, container);
    await Promise.resolve();
    const update = { version: '2.7.0', source: 'native' as const };

    updateListener?.({
      status: 'error', operation: 'install', errorCode: 'install-failed', retryable: true,
      currentVersion: '2.6.7', availableVersion: '2.7.0', canAutoUpdate: true,
      supportReason: null, updatedAt: 2, update,
    });
    expect(showToastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));

    updateListener?.({
      status: 'up-to-date', currentVersion: '2.6.7', canAutoUpdate: true,
      supportReason: null, updatedAt: 3,
    });
    expect(removeToastMock).toHaveBeenCalledWith(41);
    dispose();
  });

  it('respects dismissal until the update reaches a new milestone', async () => {
    const dispose = render(() => <AppUpdateNotifier />, container);
    await Promise.resolve();
    const update = { version: '2.7.0', source: 'native' as const };

    updateListener?.({
      status: 'available', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 2, update,
    });
    const firstToast = showToastMock.mock.calls[0]?.[0] as { onDismiss?: () => void };
    firstToast.onDismiss?.();
    updateListener?.({
      status: 'downloading', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 3, update,
      progress: { percent: 20, bytesPerSecond: 1, transferred: 20, total: 100 },
    });
    expect(showToastMock).toHaveBeenCalledOnce();

    updateListener?.({
      status: 'downloaded', currentVersion: '2.6.7', availableVersion: '2.7.0',
      canAutoUpdate: true, supportReason: null, updatedAt: 4, update,
    });
    expect(showToastMock).toHaveBeenCalledTimes(2);
    expect(showToastMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ variant: 'success' }));
    dispose();
  });
});
