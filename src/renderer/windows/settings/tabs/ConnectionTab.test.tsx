// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const requiresFirstPartyCloudLegalConsentMock = vi.hoisted(() => vi.fn(() => true));
const startCloudDesktopLoginMock = vi.hoisted(() => vi.fn());
const updateSettingMock = vi.fn();
const cleanupMock = vi.fn();

const testSettings = {
  backendMode: 'local',
  backendUrl: '',
  nodeServerUrl: '',
  languageCatalogUrl: 'https://mlearn.kikan.net/language-catalog.json',
  cloudAuthAccessToken: '',
  cloudAuthToken: '',
  cloudTosAccepted: false,
  cloudPrivacyAccepted: false,
  cloudLoginUrl: 'https://mlearn.kikan.net',
  cloudApiUrl: 'https://mlearn-cloud.kikan.net',
  overrideCloudEndpointUrl: false,
  cloudAuthStatus: 'signed-out',
  cloudAuthUserEmail: '',
};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: testSettings,
    updateSetting: updateSettingMock,
    updateSettings: vi.fn(),
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../../shared/platform', () => ({
  isMobile: () => false,
}));

vi.mock('../../../../shared/backends', () => ({
  DEFAULT_CLOUD_API_URL: 'https://mlearn-cloud.kikan.net',
  DEFAULT_CLOUD_LOGIN_URL: 'https://mlearn.kikan.net',
  getBackend: vi.fn(),
  requiresFirstPartyCloudLegalConsent: requiresFirstPartyCloudLegalConsentMock,
  resetBackend: vi.fn(),
  resolveCloudLoginUrl: vi.fn(() => 'https://mlearn.kikan.net'),
}));

vi.mock('../../../../shared/backends/nodeServerAdapter', () => ({
  getNodeServer: vi.fn(),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      onAuthDeepLink: vi.fn(() => cleanupMock),
      openExternalUrl: vi.fn(),
    },
  }),
}));

vi.mock('../../../services/cloudAuthService', () => ({
  exchangeCloudDesktopCode: vi.fn(),
  getCloudDashboardUrl: vi.fn(() => 'https://mlearn.kikan.net/account'),
  startCloudDesktopLogin: startCloudDesktopLoginMock,
}));

vi.mock('../../../services/cloudSessionManager', () => ({
  handleCloudSessionError: vi.fn(() => false),
}));

vi.mock('../../../components/common', () => ({
  Modal: (props: { children?: JSX.Element; isOpen?: boolean }) => props.isOpen ? <div>{props.children}</div> : null,
  SettingRow: (props: { children?: JSX.Element; label?: string; description?: string }) => (
    <label>
      <span>{props.label}</span>
      <span>{props.description}</span>
      {props.children}
    </label>
  ),
  SettingGroup: (props: { children?: JSX.Element; title?: string }) => <section><h2>{props.title}</h2>{props.children}</section>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button>,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { options?: Array<{ value: string; label: string }> }) => (
    <select {...props}>
      {props.options?.map((option) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  HintText: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
  LinkIcon: () => <div />,
  ToggleSwitch: () => <div />,
  CheckboxCard: () => <div />,
}));

describe('ConnectionTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingMock.mockReset();
    cleanupMock.mockReset();
    requiresFirstPartyCloudLegalConsentMock.mockReset();
    requiresFirstPartyCloudLegalConsentMock.mockReturnValue(true);
    startCloudDesktopLoginMock.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  it('lets users configure the provider-agnostic language catalog manifest URL', async () => {
    const { ConnectionTab } = await import('./ConnectionTab');
    const dispose = render(() => <ConnectionTab />, container);

    const input = Array.from(container.querySelectorAll('input'))
      .find((item) => item.value === 'https://mlearn.kikan.net/language-catalog.json') as HTMLInputElement | undefined;
    expect(input).toBeDefined();

    input!.value = 'https://pages.example.com/language-catalog.json';
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(updateSettingMock).toHaveBeenCalledWith('languageCatalogUrl', 'https://pages.example.com/language-catalog.json');
    dispose();
  });

  it('does not show mLearn legal consent for a custom cloud provider', async () => {
    requiresFirstPartyCloudLegalConsentMock.mockReturnValue(false);
    startCloudDesktopLoginMock.mockResolvedValue({
      state: 'state',
      codeVerifier: 'verifier',
      loginUrl: 'https://cloud.example.com/login',
    });
    const { ConnectionTab } = await import('./ConnectionTab');
    const dispose = render(() => <ConnectionTab />, container);

    const signInButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.Connection.SignIn');
    signInButton?.click();

    await vi.waitFor(() => {
      expect(startCloudDesktopLoginMock).toHaveBeenCalledWith(testSettings);
    });
    expect(container.textContent).not.toContain('Terms of Service');
    dispose();
  });
});
