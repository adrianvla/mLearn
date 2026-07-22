// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { AppUpdateState } from '../../../../shared/appUpdate';

const checkForUpdatesMock = vi.fn();
const getUpdateStateMock = vi.fn();
const downloadUpdateMock = vi.fn();
const installUpdateMock = vi.fn();
const openExternalUrlMock = vi.fn();
const updateSettingMock = vi.fn();
let updateListener: ((state: AppUpdateState) => void) | undefined;
let initialState: AppUpdateState;
let electronPlatform = true;

const settings = {
  automaticallyDownloadUpdates: true,
  devMode: false,
};

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings, updateSetting: updateSettingMock }),
  useLocalization: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}${values?.version ? ` ${values.version}` : ''}`,
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    server: {
      getVersion: vi.fn(),
      onVersionReceive: (callback: (version: string) => void) => {
        callback('2.6.7');
        return vi.fn();
      },
    },
    updates: {
      getUpdateState: getUpdateStateMock,
      checkForUpdates: checkForUpdatesMock,
      downloadUpdate: downloadUpdateMock,
      installUpdate: installUpdateMock,
      onUpdateStateChanged: (callback: (state: AppUpdateState) => void) => {
        updateListener = callback;
        return vi.fn();
      },
    },
    window: {
      showContact: vi.fn(),
      openWindow: vi.fn(),
      openExternalUrl: openExternalUrlMock,
    },
  }),
}));

vi.mock('../../../../shared/platform', () => ({
  isElectron: () => electronPlatform,
}));

vi.mock('../../../components/common', () => ({
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  ToggleSwitch: (props: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <button data-toggle="automatic-updates" data-checked={String(props.checked)} onClick={() => props.onChange?.(!props.checked)} />
  ),
  ProgressBar: (props: { value: number; 'aria-label'?: string }) => (
    <div role="progressbar" aria-valuenow={props.value} aria-label={props['aria-label']} />
  ),
}));

vi.mock('@renderer/components/common/Misc/AppLogo', () => ({ default: () => <span /> }));

describe('AboutTab updates', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    initialState = {
      status: 'idle',
      currentVersion: '2.6.7',
      canAutoUpdate: true,
      supportReason: null,
      updatedAt: 1,
    };
    updateListener = undefined;
    electronPlatform = true;
    getUpdateStateMock.mockReset().mockImplementation(() => Promise.resolve(initialState));
    checkForUpdatesMock.mockReset().mockResolvedValue(initialState);
    downloadUpdateMock.mockReset();
    installUpdateMock.mockReset();
    openExternalUrlMock.mockReset().mockResolvedValue(true);
    settings.automaticallyDownloadUpdates = true;
    updateSettingMock.mockReset().mockImplementation((key: string, value: boolean) => {
      if (key === 'automaticallyDownloadUpdates') settings.automaticallyDownloadUpdates = value;
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('offers manual checks and persists the automatic-download preference', async () => {
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();

    (container.querySelector('[data-toggle="automatic-updates"]') as HTMLButtonElement).click();
    expect(updateSettingMock).toHaveBeenCalledWith('automaticallyDownloadUpdates', false);

    const checkButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('mlearn.About.Updates.Check'));
    checkButton?.click();
    expect(checkForUpdatesMock).toHaveBeenCalledWith(false);
    dispose();
  });

  it('shows download progress and restarts only after the update is ready', async () => {
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();

    updateListener?.({
      status: 'downloading',
      currentVersion: '2.6.7',
      availableVersion: '2.7.0',
      canAutoUpdate: true,
      supportReason: null,
      updatedAt: 2,
      update: { version: '2.7.0', source: 'native' },
      progress: { percent: 42, bytesPerSecond: 100, transferred: 42, total: 100 },
    });
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');

    const downloadedState: AppUpdateState = {
      status: 'downloaded',
      currentVersion: '2.6.7',
      availableVersion: '2.7.0',
      canAutoUpdate: true,
      supportReason: null,
      updatedAt: 3,
      update: { version: '2.7.0', source: 'native' },
    };
    installUpdateMock.mockResolvedValue(downloadedState);
    updateListener?.(downloadedState);

    const restartButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('mlearn.About.Updates.Restart'));
    restartButton?.click();
    expect(installUpdateMock).toHaveBeenCalledOnce();
    dispose();
  });

  it('does not let a stale initial snapshot overwrite a newer update event', async () => {
    let resolveInitialState!: (state: AppUpdateState) => void;
    getUpdateStateMock.mockReturnValue(new Promise<AppUpdateState>((resolve) => {
      resolveInitialState = resolve;
    }));
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();

    updateListener?.({
      status: 'available',
      currentVersion: '2.6.7',
      availableVersion: '2.7.0',
      canAutoUpdate: true,
      supportReason: null,
      updatedAt: 3,
      update: { version: '2.7.0', source: 'native' },
    });
    resolveInitialState(initialState);
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.About.Updates.Available 2.7.0');
    dispose();
  });

  it('sends unsupported installations to the secure download page', async () => {
    initialState = {
      status: 'available',
      currentVersion: '2.6.7',
      availableVersion: '2.7.0',
      canAutoUpdate: false,
      supportReason: 'linux-non-appimage',
      updatedAt: 1,
      update: {
        version: '2.7.0',
        source: 'metadata',
        manualDownloadUrl: 'https://mlearn.kikan.net/download/auto/',
      },
    };

    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();

    const downloadPageButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('mlearn.About.Updates.DownloadPage'));
    downloadPageButton?.click();
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://mlearn.kikan.net/download/auto/');
    dispose();
  });

  it('keeps desktop updater controls out of the mobile About view', async () => {
    electronPlatform = false;
    const { AboutTab } = await import('./AboutTab');
    const dispose = render(() => <AboutTab />, container);
    await Promise.resolve();

    expect(container.textContent).not.toContain('mlearn.About.Updates.Title');
    expect(getUpdateStateMock).not.toHaveBeenCalled();
    expect(updateListener).toBeUndefined();
    dispose();
  });
});
