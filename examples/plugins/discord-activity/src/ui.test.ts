// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import DiscordActivityPanel from './ui';

type HostApi = {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  closeWindow: () => void;
};

function createHost(overrides: Partial<HostApi> = {}): HostApi {
  return {
    kvGet: vi.fn(async (_key: string) => null),
    kvSet: vi.fn(async (_key: string, _value: string) => {}),
    closeWindow: vi.fn(() => {}),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('discord activity ui', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows automatic live activity descriptions instead of manual details and state fields', async () => {
    const host = createHost({
      kvGet: vi.fn(async (key: string) => {
        switch (key) {
          case 'discord-activity:enabled':
            return 'true';
          case 'discord-activity:showTimestamp':
            return 'true';
          case 'discord-activity:runtime-status':
            return JSON.stringify({ connected: false, lastError: 'Discord is not running' });
          default:
            return null;
        }
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    expect((document.querySelector('input[name="enabled"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect((document.querySelector('input[name="showTimestamp"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect(document.body.textContent).toContain('automatic live activity');
    expect(document.body.textContent).toContain('Idle: Using mLearn / Idling');
    expect(document.body.textContent).toContain('Reader: Reading on mLearn / Reading page x/y of {work name}');
    expect(document.body.textContent).toContain('Video: Watching on mLearn / {current time}/{duration} - {work name}');
    expect(document.body.textContent).toContain('Flashcards: Using mLearn / Reviewing Flashcards');
    expect(document.querySelector('input[name="details"]')).toBeNull();
    expect(document.querySelector('input[name="state"]')).toBeNull();
    expect(document.body.textContent).toContain('Disconnected');
    expect(document.body.textContent).toContain('Discord is not running');
  });

  it('shows the last runtime error clearly', async () => {
    const host = createHost({
      kvGet: vi.fn(async (key: string) => {
        switch (key) {
          case 'discord-activity:runtime-status':
            return JSON.stringify({ connected: false, lastError: 'Invalid Client ID' });
          default:
            return null;
        }
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    expect(document.body.textContent).toContain('Runtime status: Disconnected');
    expect(document.body.textContent).toContain('Last error: Invalid Client ID');
  });

  it('shows a clear status message when loading settings fails', async () => {
    const host = createHost({
      kvGet: vi.fn(async () => {
        throw new Error('Storage unavailable');
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    expect(document.body.textContent).toContain('Failed to load Discord activity settings: Storage unavailable');
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('keeps saving disabled until settings finish loading', async () => {
    let resolveLoad!: (value: string | null) => void;
    const pendingLoad = new Promise<string | null>((resolve) => {
      resolveLoad = resolve;
    });
    const host = createHost({
      kvGet: vi.fn(async (key: string) => {
        switch (key) {
          case 'discord-activity:enabled':
            return pendingLoad;
          case 'discord-activity:showTimestamp':
          case 'discord-activity:runtime-status':
            return null;
          default:
            return null;
        }
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    const saveButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    saveButton.click();
    await flush();

    expect(host.kvSet).not.toHaveBeenCalled();

    resolveLoad('true');
    await flush();

    expect(saveButton.disabled).toBe(false);
  });

  it('writes updated config and closes the window when saving', async () => {
    const callOrder: string[] = [];
    const host = createHost({
      kvGet: vi.fn(async (key: string) => {
        switch (key) {
          case 'discord-activity:enabled':
            return 'false';
          case 'discord-activity:showTimestamp':
            return 'false';
          case 'discord-activity:runtime-status':
            return JSON.stringify({ connected: true, lastError: '' });
          default:
            return null;
        }
      }),
      kvSet: vi.fn(async (key: string, value: string) => {
        callOrder.push(`set:${key}:${value}`);
      }),
      closeWindow: vi.fn(() => {
        callOrder.push('closeWindow');
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    const enabled = document.querySelector('input[name="enabled"]') as HTMLInputElement;
    const showTimestamp = document.querySelector('input[name="showTimestamp"]') as HTMLInputElement;
    const saveButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;

    enabled.checked = true;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    showTimestamp.checked = true;
    showTimestamp.dispatchEvent(new Event('change', { bubbles: true }));

    saveButton.click();

    await flush();

    expect(host.kvSet).toHaveBeenCalledWith('discord-activity:enabled', 'true');
    expect(host.kvSet).toHaveBeenCalledWith('discord-activity:showTimestamp', 'true');
    expect(host.kvSet).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Saved. Disable and re-enable the plugin to apply Discord changes.');
    expect(callOrder.at(-1)).toBe('closeWindow');
  });

  it('shows a clear status message and keeps the window open when saving fails', async () => {
    const host = createHost({
      kvSet: vi.fn(async () => {
        throw new Error('Disk full');
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    const saveButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    saveButton.click();

    await flush();

    expect(document.body.textContent).toContain('Failed to save Discord activity settings: Disk full');
    expect(host.closeWindow).not.toHaveBeenCalled();
  });

  it('does not save when settings failed to load', async () => {
    const host = createHost({
      kvGet: vi.fn(async () => {
        throw new Error('Storage unavailable');
      }),
    });

    const panel = DiscordActivityPanel({ context: {}, host });
    document.body.append(panel);

    await flush();

    const saveButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    saveButton.click();
    await flush();

    expect(host.kvSet).not.toHaveBeenCalled();
    expect(host.closeWindow).not.toHaveBeenCalled();
  });
});
