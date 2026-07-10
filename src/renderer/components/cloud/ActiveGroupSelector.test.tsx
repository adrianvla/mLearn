// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';

vi.mock('../../context/LocalizationContext', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'mlearn.Management.ManagedBy') return `Managed by ${params?.group}`;
      const values: Record<string, string> = {
        'mlearn.Management.ChooseGroup': 'Choose a class or group',
        'mlearn.Management.ChooseGroupDescription': 'Choose where your activity and school policies apply.',
        'mlearn.Management.ActiveGroup': 'Active class or group',
        'mlearn.Management.SwitchGroup': 'Switch group',
        'mlearn.Management.ActivatingGroup': 'Switching group',
        'mlearn.Management.GroupActivationError': 'Could not switch group.',
      };
      return values[key] ?? key;
    },
  }),
}));

import { ActiveGroupSelector } from './ActiveGroupSelector';

const groups = [
  { id: 'german-a', name: 'German A' },
  { id: 'german-b', name: 'German B' },
];

describe('ActiveGroupSelector', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it('requires an explicit selection when multiple groups are eligible', () => {
    dispose = render(() => (
      <ActiveGroupSelector groups={groups} activeGroupId="" onActivate={vi.fn()} />
    ), document.body);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Choose a class or group');
    expect(dialog?.textContent).toContain('German A');
    expect(dialog?.textContent).toContain('German B');
  });

  it('does not interrupt users with zero or one eligible group', () => {
    dispose = render(() => (
      <ActiveGroupSelector groups={[groups[0]!]} activeGroupId="" onActivate={vi.fn()} />
    ), document.body);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the dialog open and exposes an error when activation fails', async () => {
    const activate = vi.fn().mockRejectedValue(new Error('revoked'));
    dispose = render(() => (
      <ActiveGroupSelector groups={groups} activeGroupId="" onActivate={activate} />
    ), document.body);

    (document.querySelector('button[data-group-id="german-a"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not switch group.'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('activates the explicitly chosen group and closes after success', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    dispose = render(() => (
      <ActiveGroupSelector groups={groups} activeGroupId="" onActivate={activate} />
    ), document.body);

    (document.querySelector('button[data-group-id="german-b"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(activate).toHaveBeenCalledWith(groups[1]));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it('closes when another window supplies the active group and restores focus', async () => {
    let setActiveGroupId!: (value: string) => string;
    const Harness = () => {
      const [activeGroupId, setActive] = createSignal('');
      setActiveGroupId = setActive;
      return <ActiveGroupSelector groups={groups} activeGroupId={activeGroupId()} onActivate={vi.fn()} />;
    };
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    dispose = render(() => <Harness />, document.body);
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-group-id')).toBe('german-a'));

    setActiveGroupId('german-b');

    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('contains tab focus inside the required dialog', async () => {
    dispose = render(() => (
      <ActiveGroupSelector groups={groups} activeGroupId="" onActivate={vi.fn()} />
    ), document.body);
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-group-id')).toBe('german-a'));
    const first = document.querySelector('[data-group-id="german-a"]') as HTMLButtonElement;
    const last = document.querySelector('[data-group-id="german-b"]') as HTMLButtonElement;

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });
});
