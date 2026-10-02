/**
 * The directories that back flashcard media must be named the same everywhere.
 *
 * Export, Guardian snapshots and Guardian restore each copy an explicit list of
 * user-data directories. If a list names a directory that does not exist, the
 * copy silently succeeds while copying nothing: media disappears from a backup
 * and from a recovery point without any error, and a restore drops the clips
 * that the restored `flashcards.json` still references.
 *
 * That is exactly what happened to video clips. `flashcardVideoStorage` writes
 * to `flashcard-videos`, while the export and Guardian lists said
 * `flashcard-video` - the protocol/scheme name, not a directory. Nothing
 * creates that path, so every clip was excluded from every backup and every
 * snapshot, permanently.
 *
 * These assertions read the real directory constants rather than a duplicated
 * list, so renaming the directory without updating its consumers fails here
 * instead of in a user's backup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = join(__dirname);
const read = (name: string) => readFileSync(join(SERVICES, name), 'utf8');

/** The directory each storage module actually writes to. */
function storageDirectory(file: string): string {
  // e.g. `path.join(getUserDataPath(), 'flashcard-images')`
  const match = read(file).match(/path\.join\(getUserDataPath\(\),\s*'([^']+)'\)/);
  expect(match, `${file} must resolve its media directory from getUserDataPath()`).not.toBeNull();
  return match![1];
}

/**
 * Every quoted directory name declared in a top-level `const NAME = [...]`.
 *
 * `guardian.ts` declares two lists, not one: `DATA_DIRS` feeds snapshots and
 * `IMPORT_DIRS` (built by spreading `DATA_DIRS`) feeds restores. Reading only
 * the first would let a directory be snapshotted but never restored, or the
 * reverse, without this test noticing.
 */
const DIRECTORY_LISTS = ['DATA_DIRS', 'DATA_DIRECTORIES', 'IMPORT_DIRS'] as const;

/**
 * Read a declared list, resolving `...OTHER` spreads so a derived list is
 * checked against the full set it actually contains at runtime.
 */
function listedDirectories(file: string): Record<string, string[]> {
  const source = read(file);
  const raw: Record<string, string[]> = {};
  for (const match of source.matchAll(/const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]/g)) {
    raw[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map(m => m[1]);
  }
  const resolved: Record<string, string[]> = {};
  for (const name of DIRECTORY_LISTS) {
    if (!(name in raw)) continue;
    const declaration = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source)!;
    const dirs: string[] = [];
    for (const part of declaration[1].split(',')) {
      const spread = /\.\.\.([A-Z_]+)/.exec(part);
      if (spread) {
        if (!(spread[1] in resolved)) continue;
        dirs.push(...resolved[spread[1]]);
        continue;
      }
      const literal = /'([^']+)'/.exec(part);
      if (literal) dirs.push(literal[1]);
    }
    resolved[name] = dirs;
  }
  return resolved;
}

describe('flashcard media directories are named consistently', () => {
  const imageDir = storageDirectory('flashcardImageStorage.ts');
  const videoDir = storageDirectory('flashcardVideoStorage.ts');
  const audioDir = storageDirectory('flashcardTtsStorage.ts');

  const exportLists = listedDirectories('dataExportImport.ts');
  const guardianLists = listedDirectories('guardian.ts');
  const snapshotDirs = guardianLists.DATA_DIRS ?? [];
  const restoreDirs = guardianLists.IMPORT_DIRS ?? [];

  it('names the media directories the way the storage modules write them', () => {
    expect(imageDir).toBe('flashcard-images');
    expect(videoDir).toBe('flashcard-videos');
    expect(audioDir).toBe('flashcard-audio');
  });

  it('exports every media directory', () => {
    // `flashcard-video` is the custom-protocol scheme, not a directory.
    for (const dir of [imageDir, videoDir, audioDir]) {
      expect(exportLists.DATA_DIRECTORIES ?? []).toContain(dir);
    }
    expect(exportLists.DATA_DIRECTORIES ?? []).not.toContain('flashcard-video');
  });

  it('snapshots the image and video directories', () => {
    for (const dir of [imageDir, videoDir]) {
      expect(snapshotDirs).toContain(dir);
    }
    expect(snapshotDirs).not.toContain('flashcard-video');
  });

  it('restores every directory a snapshot captured, plus audio', () => {
    // A snapshot without the matching restore item backs up media that a
    // recovery can never put back. Audio is deliberately absent from
    // snapshots (it is regenerable and large) but must stay restorable.
    for (const dir of snapshotDirs) {
      expect(restoreDirs).toContain(dir);
    }
    expect(restoreDirs).toContain(audioDir);
  });

  it('declares the directory lists this test reads', () => {
    // If either file stops declaring these, the assertions above would pass
    // vacuously against an empty list.
    expect(Object.keys(exportLists)).toContain('DATA_DIRECTORIES');
    expect(Object.keys(guardianLists)).toEqual(expect.arrayContaining(['DATA_DIRS', 'IMPORT_DIRS']));
  });

  it('names no directory in a list that no storage module writes', () => {
    // Every listed directory must correspond to a real location in the
    // profile, so a stale name cannot quietly become a no-op copy.
    const known = new Set([imageDir, videoDir, audioDir, 'journal', 'voice-samples', 'media-stats']);
    for (const [file, lists] of [['dataExportImport.ts', exportLists], ['guardian.ts', guardianLists]] as const) {
      for (const dirs of Object.values(lists)) {
        for (const dir of dirs) {
          expect(known.has(dir), `${file} lists unknown directory ${dir}`).toBe(true);
        }
      }
    }
  });
});
