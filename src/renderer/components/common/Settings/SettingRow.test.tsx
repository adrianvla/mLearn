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
    expect(document.querySelector('.setting-row')?.getAttribute('aria-disabled')).toBe('true');
    dispose();
  });

  it('locks only the mutation control while leaving recovery actions available', () => {
    const dispose = render(() => (
      <SettingRow
        label="Language"
        settingKey="language"
        managedControl={<select aria-label="Learning language"><option>German</option></select>}
      >
        <button type="button">Retry language pack</button>
      </SettingRow>
    ), document.body);

    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    dispose();
  });
});
