import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { activateLanguageGeneration, resolveLanguageDataRoot } from './languageGeneration';

const roots: TempDir[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => root.cleanup()); });
function fixture() {
  const temp = createTempDir('mlearn-generation-'); roots.push(temp);
  const root = path.join(temp.tmpDir, 'language-data');
  fs.mkdirSync(path.join(root, 'languages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(root, 'languages/source.json'), 'old metadata');
  fs.writeFileSync(path.join(root, 'dictionaries/source.db'), 'old dictionary');
  fs.writeFileSync(path.join(root, 'languages/unrelated.json'), 'retained');
  return root;
}
describe('durable runtime generation activation', () => {
  it('resolves an explicit retained generation after publication and rejects missing or malformed identities', async () => {
    const root = fixture();
    const old = await activateLanguageGeneration(root, async () => undefined);
    await activateLanguageGeneration(root, async candidate => { fs.writeFileSync(path.join(candidate, 'languages/source.json'), 'new metadata'); });
    expect(resolveLanguageDataRoot(root, path.basename(old))).toBe(old);
    expect(resolveLanguageDataRoot(root)).not.toBe(old);
    expect(() => resolveLanguageDataRoot(root, '../escape')).toThrow('Invalid admitted');
    expect(() => resolveLanguageDataRoot(root, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toThrow();
  });
  it('publishes complete generations once and keeps admitted old readers usable', async () => {
    const root = fixture(); const admitted = resolveLanguageDataRoot(root);
    await activateLanguageGeneration(root, async candidate => {
      fs.writeFileSync(path.join(candidate, 'languages/source.json'), 'new metadata');
      expect(resolveLanguageDataRoot(root)).toBe(admitted);
      fs.writeFileSync(path.join(candidate, 'dictionaries/source.db'), 'new dictionary');
    });
    const active = resolveLanguageDataRoot(root);
    expect(active).not.toBe(admitted);
    expect(fs.readFileSync(path.join(active, 'languages/source.json'), 'utf8')).toBe('new metadata');
    expect(fs.readFileSync(path.join(active, 'dictionaries/source.db'), 'utf8')).toBe('new dictionary');
    expect(fs.readFileSync(path.join(active, 'languages/unrelated.json'), 'utf8')).toBe('retained');
    expect(fs.readFileSync(path.join(admitted, 'dictionaries/source.db'), 'utf8')).toBe('old dictionary');
  });
  it.each(['prepare', 'copy', 'activation'])('retains old authority after %s failure and restart', async phase => {
    const root = fixture(); const old = resolveLanguageDataRoot(root);
    if (phase === 'copy') vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw new Error('copy failed'); });
    if (phase === 'activation') vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('activation failed'); });
    await expect(activateLanguageGeneration(root, async candidate => {
      fs.writeFileSync(path.join(candidate, 'languages/source.json'), 'new metadata');
      if (phase === 'prepare') throw new Error('second checksum failed');
    })).rejects.toThrow(/failed/);
    vi.restoreAllMocks(); vi.resetModules();
    const fresh = await import('./languageGeneration');
    expect(fresh.resolveLanguageDataRoot(root)).toBe(old);
    expect(fs.readFileSync(path.join(old, 'languages/source.json'), 'utf8')).toBe('old metadata');
    expect(fs.readFileSync(path.join(old, 'dictionaries/source.db'), 'utf8')).toBe('old dictionary');
  });
  it('restores selected authority when the final directory durability acknowledgement fails', async () => {
    const root = fixture(); const old = resolveLanguageDataRoot(root);
    const open = fs.openSync; const sync = fs.fsyncSync;
    const directories = new Set<number>(); let failed = false;
    vi.spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      const fd = open(...args); if (args[0] === root) directories.add(fd); return fd;
    });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (directories.has(fd) && !failed) { failed = true; throw new Error('directory sync failed'); }
      sync(fd);
    });
    await expect(activateLanguageGeneration(root, async candidate => {
      fs.writeFileSync(path.join(candidate, 'languages/source.json'), 'new metadata');
    })).rejects.toThrow('directory sync failed');
    expect(resolveLanguageDataRoot(root)).toBe(old);
    expect(fs.readFileSync(path.join(old, 'languages/source.json'), 'utf8')).toBe('old metadata');
  });

  it('serializes overlapping target updates without discarding the first activation', async () => {
    const root = fixture(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first = activateLanguageGeneration(root, async candidate => {
      await pending; fs.writeFileSync(path.join(candidate, 'dictionaries/first.db'), 'first');
    });
    const second = activateLanguageGeneration(root, async candidate => {
      fs.writeFileSync(path.join(candidate, 'dictionaries/second.db'), 'second');
    });
    release(); await Promise.all([first, second]);
    const active = resolveLanguageDataRoot(root);
    expect(fs.readFileSync(path.join(active, 'dictionaries/first.db'), 'utf8')).toBe('first');
    expect(fs.readFileSync(path.join(active, 'dictionaries/second.db'), 'utf8')).toBe('second');
  });
});
