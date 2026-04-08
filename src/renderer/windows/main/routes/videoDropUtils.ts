const VIDEO_FILE_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov']);
const SUBTITLE_FILE_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa']);

export interface DroppedVideoFile {
  file: File;
  fileName: string;
  filePath: string;
}

export interface DroppedSubtitleFile {
  content: string;
  filePath: string;
}

export interface DroppedMediaFiles {
  video: DroppedVideoFile | null;
  subtitle: DroppedSubtitleFile | null;
}

function getFileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex === -1) {
    return '';
  }

  return fileName.slice(extensionIndex + 1).toLowerCase();
}

export async function collectDroppedMediaFiles(
  files: readonly File[],
  resolveFilePath: (file: File) => string,
): Promise<DroppedMediaFiles> {
  let video: DroppedVideoFile | null = null;
  let subtitle: DroppedSubtitleFile | null = null;

  for (const file of files) {
    const extension = getFileExtension(file.name);

    if (VIDEO_FILE_EXTENSIONS.has(extension)) {
      video = {
        file,
        fileName: file.name,
        filePath: resolveFilePath(file),
      };
      continue;
    }

    if (SUBTITLE_FILE_EXTENSIONS.has(extension)) {
      subtitle = {
        content: await file.text(),
        filePath: resolveFilePath(file),
      };
    }
  }

  return { video, subtitle };
}