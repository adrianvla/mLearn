import { useIPC, useIsElectron, useIsTethered, useDraggableRegion } from './useIPC';
import type { Settings, Flashcard } from '../../shared/types';

interface MockMLearnAPI {
  getSettings: ReturnType<typeof vi.fn>;
  saveSettings: ReturnType<typeof vi.fn>;
  getFlashcards: ReturnType<typeof vi.fn>;
  saveFlashcard: ReturnType<typeof vi.fn>;
  deleteFlashcard: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  togglePiP: ReturnType<typeof vi.fn>;
  getBackendStatus: ReturnType<typeof vi.fn>;
  startBackend: ReturnType<typeof vi.fn>;
  stopBackend: ReturnType<typeof vi.fn>;
  selectFile: ReturnType<typeof vi.fn>;
  selectFolder: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  getAppPath: ReturnType<typeof vi.fn>;
  getPlatform: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  isTethered: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function createMockAPI(overrides: Partial<MockMLearnAPI> = {}): MockMLearnAPI {
  return {
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    getFlashcards: vi.fn().mockResolvedValue([]),
    saveFlashcard: vi.fn().mockResolvedValue(undefined),
    deleteFlashcard: vi.fn().mockResolvedValue(undefined),
    openWindow: vi.fn(),
    closeWindow: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    togglePiP: vi.fn(),
    getBackendStatus: vi.fn().mockResolvedValue(true),
    startBackend: vi.fn().mockResolvedValue(undefined),
    stopBackend: vi.fn().mockResolvedValue(undefined),
    selectFile: vi.fn().mockResolvedValue('/path/to/file'),
    selectFolder: vi.fn().mockResolvedValue('/path/to/folder'),
    readFile: vi.fn().mockResolvedValue('file content'),
    getAppPath: vi.fn().mockResolvedValue('/app/path'),
    getPlatform: vi.fn().mockReturnValue('darwin'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    openExternal: vi.fn().mockResolvedValue(undefined),
    isTethered: false,
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  };
}

function setWindowMlearn(api: MockMLearnAPI | undefined) {
  const win = window as unknown as { mlearn?: MockMLearnAPI };
  if (api === undefined) {
    delete win.mlearn;
  } else {
    win.mlearn = api;
  }
}

describe('useIsElectron', () => {
  afterEach(() => {
    setWindowMlearn(undefined);
  });

  it('returns true when window.mlearn is present', () => {
    setWindowMlearn(createMockAPI());
    expect(useIsElectron()).toBe(true);
  });

  it('returns false when window.mlearn is absent', () => {
    setWindowMlearn(undefined);
    expect(useIsElectron()).toBe(false);
  });
});

describe('useIsTethered', () => {
  afterEach(() => {
    setWindowMlearn(undefined);
  });

  it('returns isTethered from API when present', () => {
    setWindowMlearn(createMockAPI({ isTethered: false }));
    expect(useIsTethered()).toBe(false);
  });

  it('returns true when isTethered is true', () => {
    setWindowMlearn(createMockAPI({ isTethered: true }));
    expect(useIsTethered()).toBe(true);
  });

  it('defaults to true when no API', () => {
    setWindowMlearn(undefined);
    expect(useIsTethered()).toBe(true);
  });
});

describe('useDraggableRegion', () => {
  it('returns drag and no-drag style objects', () => {
    const { style, noDrag } = useDraggableRegion();
    expect(style['-webkit-app-region']).toBe('drag');
    expect(style['app-region']).toBe('drag');
    expect(noDrag['-webkit-app-region']).toBe('no-drag');
    expect(noDrag['app-region']).toBe('no-drag');
  });
});

describe('useIPC', () => {
  let mockAPI: MockMLearnAPI;

  beforeEach(() => {
    mockAPI = createMockAPI();
    setWindowMlearn(mockAPI);
  });

  afterEach(() => {
    setWindowMlearn(undefined);
  });

  it('isElectron is true when API present', () => {
    const { isElectron } = useIPC();
    expect(isElectron).toBe(true);
  });

  it('isElectron is false when API absent', () => {
    setWindowMlearn(undefined);
    const { isElectron } = useIPC();
    expect(isElectron).toBe(false);
  });

  it('isTethered reflects API value', () => {
    mockAPI.isTethered = true;
    setWindowMlearn(mockAPI);
    const { isTethered } = useIPC();
    expect(isTethered).toBe(true);
  });

  describe('getSettings', () => {
    it('delegates to api.getSettings', async () => {
      const settings = { known_ease_threshold: 5 } as Settings;
      mockAPI.getSettings.mockResolvedValue(settings);

      const { getSettings } = useIPC();
      const result = await getSettings();
      expect(result).toBe(settings);
      expect(mockAPI.getSettings).toHaveBeenCalled();
    });

    it('returns null when no API', async () => {
      setWindowMlearn(undefined);
      const { getSettings } = useIPC();
      const result = await getSettings();
      expect(result).toBeNull();
    });
  });

  describe('saveSettings', () => {
    it('delegates to api.saveSettings', async () => {
      const settings = { known_ease_threshold: 5 } as Settings;
      const { saveSettings } = useIPC();
      await saveSettings(settings);
      expect(mockAPI.saveSettings).toHaveBeenCalledWith(settings);
    });

    it('is a no-op when no API', async () => {
      setWindowMlearn(undefined);
      const { saveSettings } = useIPC();
      await saveSettings({} as Settings);
    });
  });

  describe('getFlashcards', () => {
    it('delegates to api.getFlashcards', async () => {
      const cards = [{ id: '1' }] as Flashcard[];
      mockAPI.getFlashcards.mockResolvedValue(cards);

      const { getFlashcards } = useIPC();
      const result = await getFlashcards();
      expect(result).toBe(cards);
    });

    it('returns empty array when no API', async () => {
      setWindowMlearn(undefined);
      const { getFlashcards } = useIPC();
      const result = await getFlashcards();
      expect(result).toEqual([]);
    });
  });

  describe('saveFlashcard', () => {
    it('delegates to api.saveFlashcard', async () => {
      const card = { id: '1' } as Flashcard;
      const { saveFlashcard } = useIPC();
      await saveFlashcard(card);
      expect(mockAPI.saveFlashcard).toHaveBeenCalledWith(card);
    });

    it('is a no-op when no API', async () => {
      setWindowMlearn(undefined);
      const { saveFlashcard } = useIPC();
      await saveFlashcard({} as Flashcard);
    });
  });

  describe('deleteFlashcard', () => {
    it('delegates to api.deleteFlashcard', async () => {
      const { deleteFlashcard } = useIPC();
      await deleteFlashcard('abc');
      expect(mockAPI.deleteFlashcard).toHaveBeenCalledWith('abc');
    });

    it('is a no-op when no API', async () => {
      setWindowMlearn(undefined);
      const { deleteFlashcard } = useIPC();
      await deleteFlashcard('abc');
    });
  });

  describe('openWindow', () => {
    it('delegates to api.openWindow', () => {
      const { openWindow } = useIPC();
      openWindow('settings', { tab: 'general' });
      expect(mockAPI.openWindow).toHaveBeenCalledWith('settings', { tab: 'general' });
    });

    it('opens new tab in tethered mode (no API)', () => {
      setWindowMlearn(undefined);
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { openWindow } = useIPC();
      openWindow('settings');

      expect(openSpy).toHaveBeenCalledWith('/settings.html', '_blank');
      openSpy.mockRestore();
    });
  });

  describe('closeWindow', () => {
    it('delegates to api.closeWindow', () => {
      const { closeWindow } = useIPC();
      closeWindow();
      expect(mockAPI.closeWindow).toHaveBeenCalled();
    });

    it('calls window.close in tethered mode', () => {
      setWindowMlearn(undefined);
      const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

      const { closeWindow } = useIPC();
      closeWindow();

      expect(closeSpy).toHaveBeenCalled();
      closeSpy.mockRestore();
    });
  });

  describe('minimize', () => {
    it('delegates to api.minimize', () => {
      const { minimize } = useIPC();
      minimize();
      expect(mockAPI.minimize).toHaveBeenCalled();
    });

    it('is a no-op when no API', () => {
      setWindowMlearn(undefined);
      const { minimize } = useIPC();
      minimize();
    });
  });

  describe('maximize', () => {
    it('delegates to api.maximize', () => {
      const { maximize } = useIPC();
      maximize();
      expect(mockAPI.maximize).toHaveBeenCalled();
    });
  });

  describe('setAlwaysOnTop', () => {
    it('delegates to api.setAlwaysOnTop', () => {
      const { setAlwaysOnTop } = useIPC();
      setAlwaysOnTop(true);
      expect(mockAPI.setAlwaysOnTop).toHaveBeenCalledWith(true);
    });
  });

  describe('togglePiP', () => {
    it('delegates to api.togglePiP with dimensions', () => {
      const { togglePiP } = useIPC();
      togglePiP(400, 300);
      expect(mockAPI.togglePiP).toHaveBeenCalledWith(400, 300);
    });

    it('delegates to api.togglePiP without dimensions', () => {
      const { togglePiP } = useIPC();
      togglePiP();
      expect(mockAPI.togglePiP).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getBackendStatus', () => {
    it('delegates to api.getBackendStatus', async () => {
      mockAPI.getBackendStatus.mockResolvedValue(true);
      const { getBackendStatus } = useIPC();
      const result = await getBackendStatus();
      expect(result).toBe(true);
    });

    it('checks via HTTP in tethered mode', async () => {
      setWindowMlearn(undefined);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
      } as Response);

      const { getBackendStatus } = useIPC();
      const result = await getBackendStatus();

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith('/api/status');
      fetchSpy.mockRestore();
    });

    it('returns false on HTTP error in tethered mode', async () => {
      setWindowMlearn(undefined);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

      const { getBackendStatus } = useIPC();
      const result = await getBackendStatus();

      expect(result).toBe(false);
      fetchSpy.mockRestore();
    });
  });

  describe('startBackend', () => {
    it('delegates to api.startBackend', async () => {
      const { startBackend } = useIPC();
      await startBackend();
      expect(mockAPI.startBackend).toHaveBeenCalled();
    });

    it('is a no-op when no API', async () => {
      setWindowMlearn(undefined);
      const { startBackend } = useIPC();
      await startBackend();
    });
  });

  describe('stopBackend', () => {
    it('delegates to api.stopBackend', async () => {
      const { stopBackend } = useIPC();
      await stopBackend();
      expect(mockAPI.stopBackend).toHaveBeenCalled();
    });

    it('is a no-op when no API', async () => {
      setWindowMlearn(undefined);
      const { stopBackend } = useIPC();
      await stopBackend();
    });
  });

  describe('selectFile', () => {
    it('delegates to api.selectFile with options', async () => {
      const filters = [{ name: 'Video', extensions: ['mp4', 'mkv'] }];
      const { selectFile } = useIPC();
      await selectFile({ filters });
      expect(mockAPI.selectFile).toHaveBeenCalledWith({ filters });
    });

    it('returns selected path', async () => {
      mockAPI.selectFile.mockResolvedValue('/chosen/file.mp4');
      const { selectFile } = useIPC();
      const result = await selectFile();
      expect(result).toBe('/chosen/file.mp4');
    });
  });

  describe('selectFolder', () => {
    it('delegates to api.selectFolder', async () => {
      const { selectFolder } = useIPC();
      await selectFolder();
      expect(mockAPI.selectFolder).toHaveBeenCalled();
    });

    it('returns null when no API', async () => {
      setWindowMlearn(undefined);
      const { selectFolder } = useIPC();
      const result = await selectFolder();
      expect(result).toBeNull();
    });
  });

  describe('readFile', () => {
    it('delegates to api.readFile', async () => {
      const { readFile } = useIPC();
      const result = await readFile('/path/to/file');
      expect(result).toBe('file content');
      expect(mockAPI.readFile).toHaveBeenCalledWith('/path/to/file');
    });

    it('throws when no API', async () => {
      setWindowMlearn(undefined);
      const { readFile } = useIPC();
      await expect(readFile('/path')).rejects.toThrow('readFile not available in tethered mode');
    });
  });

  describe('getAppPath', () => {
    it('delegates to api.getAppPath', async () => {
      const { getAppPath } = useIPC();
      const result = await getAppPath();
      expect(result).toBe('/app/path');
    });

    it('returns empty string when no API', async () => {
      setWindowMlearn(undefined);
      const { getAppPath } = useIPC();
      const result = await getAppPath();
      expect(result).toBe('');
    });
  });

  describe('getPlatform', () => {
    it('delegates to api.getPlatform', () => {
      const { getPlatform } = useIPC();
      const result = getPlatform();
      expect(result).toBe('darwin');
    });

    it('detects platform from user agent when no API', () => {
      setWindowMlearn(undefined);
      const { getPlatform } = useIPC();
      const result = getPlatform();
      expect(['darwin', 'win32', 'linux', 'unknown']).toContain(result);
    });
  });

  describe('getVersion', () => {
    it('delegates to api.getVersion', () => {
      const { getVersion } = useIPC();
      expect(getVersion()).toBe('1.0.0');
    });

    it('returns 0.0.0 when no API', () => {
      setWindowMlearn(undefined);
      const { getVersion } = useIPC();
      expect(getVersion()).toBe('0.0.0');
    });
  });

  describe('openExternal', () => {
    it('delegates to api.openExternal', async () => {
      const { openExternal } = useIPC();
      await openExternal('https://example.com');
      expect(mockAPI.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('opens new tab when no API', async () => {
      setWindowMlearn(undefined);
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { openExternal } = useIPC();
      await openExternal('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
      openSpy.mockRestore();
    });
  });

  describe('return shape', () => {
    it('returns all expected methods', () => {
      const ipc = useIPC();
      expect(ipc).toHaveProperty('isElectron');
      expect(ipc).toHaveProperty('isTethered');
      expect(ipc).toHaveProperty('getSettings');
      expect(ipc).toHaveProperty('saveSettings');
      expect(ipc).toHaveProperty('getFlashcards');
      expect(ipc).toHaveProperty('saveFlashcard');
      expect(ipc).toHaveProperty('deleteFlashcard');
      expect(ipc).toHaveProperty('openWindow');
      expect(ipc).toHaveProperty('closeWindow');
      expect(ipc).toHaveProperty('minimize');
      expect(ipc).toHaveProperty('maximize');
      expect(ipc).toHaveProperty('setAlwaysOnTop');
      expect(ipc).toHaveProperty('togglePiP');
      expect(ipc).toHaveProperty('getBackendStatus');
      expect(ipc).toHaveProperty('startBackend');
      expect(ipc).toHaveProperty('stopBackend');
      expect(ipc).toHaveProperty('selectFile');
      expect(ipc).toHaveProperty('selectFolder');
      expect(ipc).toHaveProperty('readFile');
      expect(ipc).toHaveProperty('getAppPath');
      expect(ipc).toHaveProperty('getPlatform');
      expect(ipc).toHaveProperty('getVersion');
      expect(ipc).toHaveProperty('openExternal');
    });
  });
});

describe('useIPC without API', () => {
  beforeEach(() => {
    setWindowMlearn(undefined);
  });

  it('isTethered defaults to true', () => {
    const { isTethered } = useIPC();
    expect(isTethered).toBe(true);
  });

  it('minimize is a no-op', () => {
    const { minimize } = useIPC();
    expect(() => minimize()).not.toThrow();
  });

  it('maximize is a no-op', () => {
    const { maximize } = useIPC();
    expect(() => maximize()).not.toThrow();
  });

  it('setAlwaysOnTop is a no-op', () => {
    const { setAlwaysOnTop } = useIPC();
    expect(() => setAlwaysOnTop(true)).not.toThrow();
  });

  it('togglePiP is a no-op', () => {
    const { togglePiP } = useIPC();
    expect(() => togglePiP(400, 300)).not.toThrow();
  });
});
