// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useOptionalSettings: () => ({
    getManagedSettingSource: (key: string) => key === 'llmEnabled' || key === 'language'
      ? { sourceGroupName: 'German', sourceGroupId: 'german', locked: true, value: false }
      : null,
  }),
  useSettingsSearch: () => undefined,
  useSettingsTab: () => undefined,
}));

vi.mock('../../../context/LocalizationContext', () => ({
  useLocalization: () => ({
    t: (_key: string, params?: Record<string, string>) => `Managed by ${params?.group}`,
  }),
}));

import { SettingRow } from './SettingRow';

describe('SettingRow managed policy affordance', () => {
  afterEach(() => document.body.replaceChildren());

  it('keeps a managed setting visible while disabling its controls and naming its source', () => {
    const dispose = render(() => (
      <SettingRow label="LLM" settingKey="llmEnabled">
        <input aria-label="LLM enabled" />
      </SettingRow>
    ), document.body);

    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('LLM');
    expect(document.body.textContent).toContain('Managed by German');
    expect(document.querySelector('.setting-row')?.hasAttribute('aria-disabled')).toBe(false);
    expect(document.querySelector('.managed-setting-control')?.hasAttribute('disabled')).toBe(true);
    dispose();
  });

  it('locks only the mutation control while leaving recovery actions available', () => {
    const recover = vi.fn();
    const dispose = render(() => (
      <SettingRow
        label="Language"
        settingKey="language"
        managedControl={<select aria-label="Learning language"><option>German</option></select>}
      >
        <button type="button" onClick={recover}>Retry language pack</button>
      </SettingRow>
    ), document.body);

    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    const row = document.querySelector('.setting-row')!;
    const recovery = document.querySelector('button') as HTMLButtonElement;
    expect(row.classList.contains('disabled')).toBe(false);
    recovery.focus();
    recovery.click();
    expect(document.activeElement).toBe(recovery);
    expect(recover).toHaveBeenCalledOnce();
    dispose();
  });
});
