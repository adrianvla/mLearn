import { describe, expect, it, vi } from 'vitest';
import { installSolidDevtools, SOLID_DEVTOOLS_EXTENSION_ID } from './solidDevtools';

describe('installSolidDevtools', () => {
  it('loads the Solid Devtools extension for an unpackaged app', async () => {
    const installExtension = vi.fn().mockResolvedValue({ name: 'Solid Devtools' });

    await expect(installSolidDevtools({ isPackaged: false, installExtension })).resolves.toBe(true);
    expect(installExtension).toHaveBeenCalledWith(SOLID_DEVTOOLS_EXTENSION_ID);
  });

  it('does not load the extension for a packaged app', async () => {
    const installExtension = vi.fn();

    await expect(installSolidDevtools({ isPackaged: true, installExtension })).resolves.toBe(false);
    expect(installExtension).not.toHaveBeenCalled();
  });
});
