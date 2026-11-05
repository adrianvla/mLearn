import type { AuthoredMediaId, CapturedMediaFile, MaterialMediaImport, MaterialMediaKind, MediaCaptureRequest, MediaSegment } from '@mlearn/contracts';

/** The authored-media capability a Material editor needs. Declared here because
 * features must not import host implementations; the available Host variant
 * satisfies this shape structurally at the call site. */
export type MaterialMediaHost = {
  readonly capture: (request: MediaCaptureRequest, signal?: AbortSignal) => Promise<{
    readonly file: CapturedMediaFile;
    readonly release: () => Promise<void>;
  }>;
  readonly pick: (kind: MaterialMediaKind) => Promise<{
    readonly path: string;
    readonly name: string;
    readonly kind: MaterialMediaKind;
    readonly release: () => Promise<void>;
  } | null>;
  readonly uri: (id: AuthoredMediaId) => Promise<string>;
  readonly export: (id: AuthoredMediaId) => Promise<boolean>;
};

export type StagedMedia = {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly kind: MaterialMediaKind;
  readonly segment: MediaSegment | null;
  readonly release: () => Promise<void>;
  released: boolean;
};

export function stageFile(path: string, name: string, kind: MaterialMediaKind, segment: MediaSegment | null, release: () => Promise<void>): StagedMedia {
  return { key: path, path, name, kind, segment, release, released: false };
}

export function mediaImportOf(item: StagedMedia): MaterialMediaImport {
  return { path: item.path, kind: item.kind, name: item.name, segment: item.segment };
}

/** Durable bytes do not depend on temporary cleanup; the native owner also
 * releases abandoned files on shutdown. Keep cleanup failures observable. */
export function releaseStaged(item: StagedMedia): void {
  if (item.released) return;
  item.released = true;
  void item.release().catch((error: unknown) => {
    console.error('Temporary Material media cleanup failed', error);
  });
}

/** Matches the attachments bound admitted by the Material content contract. */
export const MAX_ATTACHMENTS = 8;

export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1048576) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${(byteLength / 1048576).toFixed(1)} MB`;
}

export function formatRangeMs(startMs: number, endMs: number): string {
  return `${(startMs / 1000).toFixed(1)}s–${(endMs / 1000).toFixed(1)}s`;
}
