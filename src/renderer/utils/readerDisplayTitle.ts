import { parseWorkName } from './subtitleParsing';

/**
 * Return a readable title for the Reader header without changing a book's
 * path or its persisted identity. EPUB/PDF metadata wins when present; a
 * filename fallback is passed through the app's established work-name parser.
 */
export function readerBookDisplayTitle(
  metadataTitle: string | null | undefined,
  fileName: string,
  languageCodes: readonly string[] = [],
): string {
  const trustedTitle = metadataTitle?.replace(/\s+/gu, ' ').trim();
  if (trustedTitle) return trustedTitle;

  const parsed = parseWorkName(fileName, { languageCodes: [...languageCodes] });
  const withoutHash = parsed.replace(/(?:[\s._-]+)[\da-f]{12,}$/iu, '').trim();
  if (withoutHash) return withoutHash;
  if (parsed) return parsed;

  return fileName.replace(/^.*[/\\]/u, '').replace(/\.[^.]+$/u, '').trim();
}
