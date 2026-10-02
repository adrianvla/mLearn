import path from 'path';

const revisions = new Map<string, number>();
const packageKey = (dataRoot: string, language: string) => JSON.stringify([path.resolve(dataRoot), language]);

/** In-process invalidation generation; package metadata remains the authority. */
export function languagePackageRevision(dataRoot: string, language: string): number {
  return revisions.get(packageKey(dataRoot, language)) ?? 0;
}

export function advanceLanguagePackageRevision(dataRoot: string, language: string): void {
  const key = packageKey(dataRoot, language);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}
