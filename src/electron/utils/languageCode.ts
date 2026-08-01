import path from 'path';

// BCP-47 shape: subtags hyphen-separated, dots never valid — rejects zh.freq/zh.t2s-style data files without a per-extension blacklist.
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

export function isLanguageMetadataFileName(fileName: string): boolean {
  if (!fileName.endsWith('.json')) return false;
  return LANGUAGE_CODE_PATTERN.test(path.basename(fileName, '.json'));
}
