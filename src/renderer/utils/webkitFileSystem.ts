export type WebkitFileSystemAnyEntry = FileSystemFileEntry | FileSystemDirectoryEntry;

export type FileWithOptionalPath = File & {
  path?: string;
  _entryPath?: string;
};

export function getWebkitEntry(item: DataTransferItem): WebkitFileSystemAnyEntry | null {
  const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null;

  if (isWebkitFileEntry(entry) || isWebkitDirectoryEntry(entry)) {
    return entry;
  }

  return null;
}

export function isWebkitFileEntry(entry: FileSystemEntry | null | undefined): entry is FileSystemFileEntry {
  return entry?.isFile === true;
}

export function isWebkitDirectoryEntry(entry: FileSystemEntry | null | undefined): entry is FileSystemDirectoryEntry {
  return entry?.isDirectory === true;
}