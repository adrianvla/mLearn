// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const { updateSettingsMock } = vi.hoisted(() => ({ updateSettingsMock: vi.fn() }));

vi.mock('@renderer/context', () => ({
  useSettings: () => ({ updateSettings: updateSettingsMock }),
  useLocalization: () => ({ t: (key: string) => key }),
}));

vi.mock('../', () => ({
  Button: (props: { class?: string; disabled?: boolean; onClick?: () => void; children?: JSX.Element }) => (
    <button class={props.class} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  ToggleSwitch: (props: { checked: boolean; disabled?: boolean; class?: string; label?: string; onChange: (checked: boolean) => void }) => (
    <label class={props.class}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  ),
}));

import { EulaModal } from './EulaModal';

describe('EulaModal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    updateSettingsMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('records the version from the EULA document being accepted', () => {
    const onAccept = vi.fn();
    const dispose = render(() => (
      <EulaModal
        content={'# mLearn EULA\n\n**Version 1.4 — Effective Date: 2026-08-05**'}
        onAccept={onAccept}
      />
    ), container);

    try {
      const readToggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const acceptButton = container.querySelector<HTMLButtonElement>('.eula-accept-btn');
      expect(readToggle).not.toBeNull();
      expect(acceptButton).not.toBeNull();

      readToggle!.click();
      expect(acceptButton!.disabled).toBe(false);
      acceptButton!.click();

      expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
        eulaAccepted: true,
        eulaAcceptedVersion: '1.4',
      }));
      expect(onAccept).toHaveBeenCalledOnce();
    } finally {
      dispose();
      container.remove();
    }
  });
});
