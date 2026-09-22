import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.solidDevtools');

export const SOLID_DEVTOOLS_EXTENSION_ID = 'kmcfjchnmmaeeagadbhoofajiopoceel';

type ExtensionInstaller = (extensionId: string) => Promise<{ name: string }>;

interface InstallSolidDevtoolsOptions {
  isPackaged: boolean;
  installExtension?: ExtensionInstaller;
}

/**
 * Registers the Solid Devtools Chrome extension with Electron's default session.
 * This must complete before creating a BrowserWindow so Chromium exposes its panel.
 */
export async function installSolidDevtools({
  isPackaged,
  installExtension,
}: InstallSolidDevtoolsOptions): Promise<boolean> {
  if (isPackaged) {
    return false;
  }

  try {
    const installer = installExtension
      ?? (await import('electron-devtools-installer')).default;
    const extension = await installer(SOLID_DEVTOOLS_EXTENSION_ID);
    log.info(`Loaded ${extension.name} into Electron DevTools`);
    return true;
  } catch (error) {
    log.warn('Unable to load Solid Devtools extension', error);
    return false;
  }
}
