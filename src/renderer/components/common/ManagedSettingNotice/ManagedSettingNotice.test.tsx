// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

vi.mock('../../../context/LocalizationContext', () => ({
  useLocalization: () => ({
    t: (_key: string, params?: Record<string, string>) => `Managed by ${params?.group}`,
  }),
}));

import { ManagedSettingNotice } from './ManagedSettingNotice';

describe('ManagedSettingNotice', () => {
  afterEach(() => document.body.replaceChildren());

  it('labels a locked control with its source group', () => {
    const dispose = render(() => <ManagedSettingNotice sourceGroupName="German" />, document.body);
    const notice = document.querySelector('[role="note"]');
    expect(notice?.textContent).toContain('Managed by German');
    expect(notice?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    dispose();
  });
});
