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
  if (trustedTitle) {
    // Some catalogs repeat the title inside angle brackets after the volume.
    // Compare normalized text only; keep distinct subtitles and edition text.
    const repeated = trustedTitle.match(/^(.+?)\s*<([^<>]+)>(.*)$/u);
    if (repeated) {
      const comparable = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
      const first = comparable(repeated[1]);
      const second = comparable(repeated[2]);
      if (second.length >= 6 && (first === second || (first.startsWith(second) && /^\p{N}+$/u.test(first.slice(second.length))))) {
        return `${repeated[1].trim()} ${repeated[3].trim()}`.trim();
      }
    }
    return trustedTitle;
  }

  const parsed = parseWorkName(fileName, { languageCodes: [...languageCodes] });
  const withoutHash = parsed.replace(/(?:[\s._-]+)[\da-f]{12,}$/iu, '').trim();
  if (withoutHash) return withoutHash;
  if (parsed) return parsed;

  return fileName.replace(/^.*[/\\]/u, '').replace(/\.[^.]+$/u, '').trim();
}
