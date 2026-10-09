import path from 'path';
import fs from 'fs';

const revisions = new Map<string, number>();
const packageKey = (dataRoot: string, language: string) => JSON.stringify([path.resolve(dataRoot), language]);

/** In-process invalidation generation; package metadata remains the authority. */
export function languagePackageRevision(dataRoot: string, language: string): number {
  const pointer = path.join(dataRoot, '.active-generation.json');
  if (fs.existsSync(pointer)) {
    const parsed = JSON.parse(fs.readFileSync(pointer, 'utf8')) as { revision?: unknown };
    if (typeof parsed.revision !== 'number' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1) throw new Error('Invalid language generation revision');
    return parsed.revision;
  }
  return revisions.get(packageKey(dataRoot, language)) ?? 0;
}

export function advanceLanguagePackageRevision(dataRoot: string, language: string): void {
  if (fs.existsSync(path.join(dataRoot, '.active-generation.json'))) return;
  const key = packageKey(dataRoot, language);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}
