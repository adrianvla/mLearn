"""Anchored test-harness corrections, applied once on the repair work branch."""
from pathlib import Path

def edit(file, before, after):
    p = Path(file)
    text = p.read_text()
    assert text.count(before) == 1, (file, before[:120], text.count(before))
    p.write_text(text.replace(before, after, 1))

word_sync = 'src/renderer/windows/wordSync/App.test.tsx'
edit(word_sync,
    'beforeEach(() => {\n    const lockChains',
    '''  // Happy DOM's Storage proxy binds methods to each instance and hides their
  // descriptors. Restoring a spy through assignment/deletion cannot remove its
  // wrapper. Preserve real bound methods and reinstall them via defineProperty;
  // quota injections must both take effect and remain confined to one test.
  const originalStorageMethods = {
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const method of ['setItem', 'removeItem'] as const) {
      Object.defineProperty(localStorage, method, {
        configurable: true, writable: true, value: originalStorageMethods[method],
      });
    }
    const lockChains''')
edit(word_sync,
    '    while (disposals.length) disposals.pop()!();\n    container.remove();',
    '    while (disposals.length) disposals.pop()!();\n    vi.restoreAllMocks();\n    container.remove();')

installer = 'src/electron/services/pythonBackend.test.ts'
edit(installer,
    'const originalNodeEnv = process.env.NODE_ENV;',
    '''const originalNodeEnv = process.env.NODE_ENV;
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalArchDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;''')
edit(installer,
    "  beforeEach(async () => {\n    tempDir = createTempDir('mlearn-python-test-');",
    '''  beforeEach(async () => {
    // The default archive and platform-module fixtures describe Apple Silicon.
    // Keep the process platform consistent on Linux/Windows CI too; explicit
    // cross-platform tests still override this through setupInstaller.
    Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'darwin' });
    Object.defineProperty(process, 'arch', { ...originalArchDescriptor, value: 'arm64' });
    // A test that aborts before extraction must not donate a queued one-shot
    // extractor (or process) to the next installation.
    mockTarExtract.mockReset().mockResolvedValue(undefined);
    mockSpawn.mockReset();
    tempDir = createTempDir('mlearn-python-test-');''')
edit(installer,
    '    process.env.NODE_ENV = originalNodeEnv;\n    tempDir.cleanup();',
    '''    process.env.NODE_ENV = originalNodeEnv;
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    Object.defineProperty(process, 'arch', originalArchDescriptor);
    tempDir.cleanup();''')
print('Changed only:', word_sync, installer)
