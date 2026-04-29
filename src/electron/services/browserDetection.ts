import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { isMac, isWindows, isLinux } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.browserDetection');
const execAsync = promisify(exec);

export interface BrowserInfo {
  name: string;
  type: 'chrome' | 'firefox' | 'unknown';
  path: string;
  profilePath?: string;
  isInstalled: boolean;
}

interface BrowserDefinition {
  name: string;
  type: 'chrome' | 'firefox' | 'unknown';
  paths: string[];
  profilePath?: string;
}

function getHomeDir(): string {
  return os.homedir();
}

function getMacBrowserDefinitions(): BrowserDefinition[] {
  const home = getHomeDir();
  const appSupport = path.join(home, 'Library/Application Support');

  return [
    {
      name: 'Google Chrome',
      type: 'chrome',
      paths: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ],
      profilePath: path.join(appSupport, 'Google/Chrome/Default'),
    },
    {
      name: 'Firefox',
      type: 'firefox',
      paths: [
        '/Applications/Firefox.app/Contents/MacOS/firefox',
        path.join(home, 'Applications/Firefox.app/Contents/MacOS/firefox'),
      ],
      profilePath: path.join(appSupport, 'Firefox/Profiles'),
    },
    {
      name: 'Brave Browser',
      type: 'chrome',
      paths: [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(home, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
      ],
      profilePath: path.join(appSupport, 'BraveSoftware/Brave-Browser/Default'),
    },
    {
      name: 'Microsoft Edge',
      type: 'chrome',
      paths: [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      ],
      profilePath: path.join(appSupport, 'Microsoft Edge/Default'),
    },
    {
      name: 'Vivaldi',
      type: 'chrome',
      paths: [
        '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
        path.join(home, 'Applications/Vivaldi.app/Contents/MacOS/Vivaldi'),
      ],
      profilePath: path.join(appSupport, 'Vivaldi/Default'),
    },
    {
      name: 'Opera',
      type: 'chrome',
      paths: [
        '/Applications/Opera.app/Contents/MacOS/Opera',
        path.join(home, 'Applications/Opera.app/Contents/MacOS/Opera'),
      ],
      profilePath: path.join(appSupport, 'com.operasoftware.Opera'),
    },
    {
      name: 'Arc',
      type: 'chrome',
      paths: [
        '/Applications/Arc.app/Contents/MacOS/Arc',
        path.join(home, 'Applications/Arc.app/Contents/MacOS/Arc'),
      ],
      profilePath: path.join(appSupport, 'Arc/User Data/Default'),
    },
    {
      name: 'Zen Browser',
      type: 'firefox',
      paths: [
        '/Applications/Zen Browser.app/Contents/MacOS/zen',
        '/Applications/Zen.app/Contents/MacOS/zen',
        path.join(home, 'Applications/Zen Browser.app/Contents/MacOS/zen'),
        path.join(home, 'Applications/Zen.app/Contents/MacOS/zen'),
      ],
      profilePath: path.join(appSupport, 'Zen/Profiles'),
    },
    {
      name: 'LibreWolf',
      type: 'firefox',
      paths: [
        '/Applications/LibreWolf.app/Contents/MacOS/LibreWolf',
        path.join(home, 'Applications/LibreWolf.app/Contents/MacOS/LibreWolf'),
      ],
      profilePath: path.join(appSupport, 'LibreWolf/Profiles'),
    },
    {
      name: 'Waterfox',
      type: 'firefox',
      paths: [
        '/Applications/Waterfox.app/Contents/MacOS/waterfox',
        path.join(home, 'Applications/Waterfox.app/Contents/MacOS/waterfox'),
      ],
      profilePath: path.join(appSupport, 'Waterfox/Profiles'),
    },
  ];
}

function getWindowsBrowserDefinitions(): BrowserDefinition[] {
  const home = getHomeDir();
  const localAppData = process.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  return [
    {
      name: 'Google Chrome',
      type: 'chrome',
      paths: [
        path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      profilePath: path.win32.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default'),
    },
    {
      name: 'Firefox',
      type: 'firefox',
      paths: [
        path.win32.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
        path.win32.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
      ],
      profilePath: path.win32.join(process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles'),
    },
    {
      name: 'Brave Browser',
      type: 'chrome',
      paths: [
        path.win32.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.win32.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.win32.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ],
      profilePath: path.win32.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default'),
    },
    {
      name: 'Microsoft Edge',
      type: 'chrome',
      paths: [
        path.win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.win32.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      profilePath: path.win32.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default'),
    },
    {
      name: 'Vivaldi',
      type: 'chrome',
      paths: [
        path.win32.join(localAppData, 'Vivaldi', 'Application', 'vivaldi.exe'),
        path.win32.join(programFiles, 'Vivaldi', 'Application', 'vivaldi.exe'),
      ],
      profilePath: path.win32.join(localAppData, 'Vivaldi', 'User Data', 'Default'),
    },
    {
      name: 'Opera',
      type: 'chrome',
      paths: [
        path.win32.join(programFiles, 'Opera', 'opera.exe'),
        path.win32.join(programFilesX86, 'Opera', 'opera.exe'),
        path.win32.join(localAppData, 'Programs', 'Opera', 'opera.exe'),
      ],
      profilePath: path.win32.join(process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Opera Software', 'Opera Stable'),
    },
    {
      name: 'Zen Browser',
      type: 'firefox',
      paths: [
        path.win32.join(programFiles, 'Zen Browser', 'zen.exe'),
        path.win32.join(programFilesX86, 'Zen Browser', 'zen.exe'),
        path.win32.join(localAppData, 'Zen Browser', 'zen.exe'),
      ],
      profilePath: path.win32.join(process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Zen', 'Profiles'),
    },
    {
      name: 'LibreWolf',
      type: 'firefox',
      paths: [
        path.win32.join(programFiles, 'LibreWolf', 'librewolf.exe'),
        path.win32.join(programFilesX86, 'LibreWolf', 'librewolf.exe'),
      ],
      profilePath: path.win32.join(process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'LibreWolf', 'Profiles'),
    },
    {
      name: 'Waterfox',
      type: 'firefox',
      paths: [
        path.win32.join(programFiles, 'Waterfox', 'waterfox.exe'),
        path.win32.join(programFilesX86, 'Waterfox', 'waterfox.exe'),
      ],
      profilePath: path.win32.join(process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Waterfox', 'Profiles'),
    },
  ];
}

function getLinuxBrowserDefinitions(): BrowserDefinition[] {
  const home = getHomeDir();

  return [
    {
      name: 'Google Chrome',
      type: 'chrome',
      paths: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        path.join(home, '.local/bin/google-chrome'),
        path.join(home, '.local/bin/chromium'),
      ],
      profilePath: path.join(home, '.config/google-chrome/Default'),
    },
    {
      name: 'Firefox',
      type: 'firefox',
      paths: [
        '/usr/bin/firefox',
        '/usr/bin/firefox-esr',
        '/snap/bin/firefox',
        path.join(home, '.local/bin/firefox'),
      ],
      profilePath: path.join(home, '.mozilla/firefox'),
    },
    {
      name: 'Brave Browser',
      type: 'chrome',
      paths: [
        '/usr/bin/brave',
        '/usr/bin/brave-browser',
        '/snap/bin/brave',
        path.join(home, '.local/bin/brave'),
      ],
      profilePath: path.join(home, '.config/BraveSoftware/Brave-Browser/Default'),
    },
    {
      name: 'Microsoft Edge',
      type: 'chrome',
      paths: [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/snap/bin/microsoft-edge',
        path.join(home, '.local/bin/microsoft-edge'),
      ],
      profilePath: path.join(home, '.config/microsoft-edge/Default'),
    },
    {
      name: 'Vivaldi',
      type: 'chrome',
      paths: [
        '/usr/bin/vivaldi',
        '/usr/bin/vivaldi-stable',
        '/snap/bin/vivaldi',
        path.join(home, '.local/bin/vivaldi'),
      ],
      profilePath: path.join(home, '.config/vivaldi/Default'),
    },
    {
      name: 'Opera',
      type: 'chrome',
      paths: [
        '/usr/bin/opera',
        '/usr/bin/opera-stable',
        '/snap/bin/opera',
        path.join(home, '.local/bin/opera'),
      ],
      profilePath: path.join(home, '.config/opera'),
    },
    {
      name: 'Zen Browser',
      type: 'firefox',
      paths: [
        '/usr/bin/zen',
        '/usr/bin/zen-browser',
        '/snap/bin/zen',
        path.join(home, '.local/bin/zen'),
      ],
      profilePath: path.join(home, '.zen'),
    },
    {
      name: 'LibreWolf',
      type: 'firefox',
      paths: [
        '/usr/bin/librewolf',
        '/snap/bin/librewolf',
        '/var/lib/flatpak/exports/bin/io.gitlab.librewolf-community',
        path.join(home, '.local/bin/librewolf'),
      ],
      profilePath: path.join(home, '.librewolf'),
    },
    {
      name: 'Waterfox',
      type: 'firefox',
      paths: [
        '/usr/bin/waterfox',
        '/snap/bin/waterfox',
        path.join(home, '.local/bin/waterfox'),
      ],
      profilePath: path.join(home, '.waterfox'),
    },
  ];
}

function getBrowserDefinitions(): BrowserDefinition[] {
  if (isMac) return getMacBrowserDefinitions();
  if (isWindows) return getWindowsBrowserDefinitions();
  if (isLinux) return getLinuxBrowserDefinitions();
  return [];
}

interface MdfindEntry {
  bundleId: string;
  name: string;
  type: 'chrome' | 'firefox' | 'unknown';
  executableName: string;
}

const MAC_MDFIND_BROWSERS: MdfindEntry[] = [
  { bundleId: 'com.google.Chrome', name: 'Google Chrome', type: 'chrome', executableName: 'Google Chrome' },
  { bundleId: 'org.mozilla.firefox', name: 'Firefox', type: 'firefox', executableName: 'firefox' },
  { bundleId: 'com.brave.Browser', name: 'Brave Browser', type: 'chrome', executableName: 'Brave Browser' },
  { bundleId: 'com.microsoft.edgemac', name: 'Microsoft Edge', type: 'chrome', executableName: 'Microsoft Edge' },
  { bundleId: 'com.vivaldi.Vivaldi', name: 'Vivaldi', type: 'chrome', executableName: 'Vivaldi' },
  { bundleId: 'com.operasoftware.Opera', name: 'Opera', type: 'chrome', executableName: 'Opera' },
  { bundleId: 'company.thebrowser.Browser', name: 'Arc', type: 'chrome', executableName: 'Arc' },
];

async function detectMacBrowsersWithMdfind(): Promise<BrowserInfo[]> {
  const results: BrowserInfo[] = [];
  const foundPaths = new Set<string>();

  for (const entry of MAC_MDFIND_BROWSERS) {
    try {
      const { stdout } = await execAsync(
        `mdfind kMDItemCFBundleIdentifier == "${entry.bundleId}"`,
        { timeout: 5000 },
      );
      const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
      for (const appPath of lines) {
        if (!fs.existsSync(appPath)) continue;
        const executablePath = path.join(appPath, 'Contents/MacOS', entry.executableName);
        if (fs.existsSync(executablePath) && !foundPaths.has(executablePath)) {
          foundPaths.add(executablePath);
          results.push({
            name: entry.name,
            type: entry.type,
            path: executablePath,
            isInstalled: true,
          });
        }
      }
    } catch {
      // mdfind not available or timed out
    }
  }

  return results;
}

/**
 * Detect installed browsers on the current platform.
 * @param customPaths Optional additional paths to check for browser executables.
 * @returns Array of detected browsers. Empty array if none found.
 */
export async function detectBrowsers(customPaths?: string[]): Promise<BrowserInfo[]> {
  const results: BrowserInfo[] = [];
  const foundPaths = new Set<string>();

  if (customPaths && customPaths.length > 0) {
    for (const customPath of customPaths) {
      const resolved = path.resolve(customPath);
      if (foundPaths.has(resolved)) continue;
      foundPaths.add(resolved);

      try {
        if (fs.existsSync(resolved)) {
          results.push({
            name: path.basename(resolved),
            type: 'unknown',
            path: resolved,
            isInstalled: true,
          });
        }
      } catch {
        // Path not accessible, skip
      }
    }
  }

  const definitions = getBrowserDefinitions();
  for (const def of definitions) {
    for (const browserPath of def.paths) {
      if (foundPaths.has(browserPath)) continue;

      try {
        if (fs.existsSync(browserPath)) {
          foundPaths.add(browserPath);
          results.push({
            name: def.name,
            type: def.type,
            path: browserPath,
            profilePath: def.profilePath,
            isInstalled: true,
          });
          break;
        }
      } catch {
        // Path not accessible, skip
      }
    }
  }

  if (isMac) {
    try {
      const mdfindResults = await detectMacBrowsersWithMdfind();
      for (const result of mdfindResults) {
        if (!foundPaths.has(result.path)) {
          foundPaths.add(result.path);
          const def = definitions.find(d => d.name === result.name);
          results.push({
            ...result,
            profilePath: def?.profilePath,
          });
        }
      }
    } catch {
      // Ignore mdfind errors
    }
  }

  log.info(`Detected ${results.length} browser(s)`);
  return results;
}

/**
 * Set up IPC handler for browser detection and extension installation.
 */
export function setupBrowserDetectionIPC(): void {
  ipcMain.handle(IPC_CHANNELS.DETECT_BROWSERS, async (_event, customPaths?: string[]) => {
    return detectBrowsers(customPaths);
  });


}
