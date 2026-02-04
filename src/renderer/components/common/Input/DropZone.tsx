/**
 * DropZone Component
 * Reusable drag-and-drop zone for file uploads
 */

import { Component, JSX, createSignal, Show } from 'solid-js';
import './DropZone.css';

export interface DropZoneProps {
  /** Called when files are dropped */
  onDrop: (files: File[]) => void;
  /** Accepted file types (e.g., ['image/*', 'video/*']) */
  accept?: string[];
  /** Whether to accept directories */
  acceptDirectory?: boolean;
  /** Whether the drop zone is currently active */
  disabled?: boolean;
  /** Custom content to show in the drop zone */
  children?: JSX.Element;
  /** Custom content to show when dragging */
  dragContent?: JSX.Element;
  /** CSS class to apply */
  class?: string;
}

/**
 * Get all files from a DataTransfer object, including directory contents
 * Preserves file.path for Electron compatibility on macOS/Windows/Linux
 */
async function getDroppedFiles(
  dataTransfer: DataTransfer | null,
  acceptDirectory: boolean = true
): Promise<File[]> {
  if (!dataTransfer) return [];

  // First, try to get files directly from dataTransfer.files
  // This preserves the Electron-specific `path` property on macOS/Windows/Linux
  const directFiles = Array.from(dataTransfer.files || []);

  // Check if any item is a directory (needs special handling)
  const items = Array.from(dataTransfer.items || []);
  const hasDirectory = items.some((item) => {
    const entry = (item as any).webkitGetAsEntry?.();
    return entry?.isDirectory;
  });

  // If no directories and we have files with paths, use them directly
  // This preserves file.path for Electron
  if (!hasDirectory && directFiles.length > 0) {
    return directFiles;
  }

  // For directories, we need to use webkitGetAsEntry to read contents
  // but this loses the path property
  const hasEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');

  if (!hasEntries) {
    return directFiles;
  }

  const readEntry = async (entry: any, basePath: string = ''): Promise<File[]> => {
    if (!entry) return [];

    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => {
          // Try to reconstruct the path for files read from entries
          // The fullPath property gives us the relative path from the dropped folder
          if (entry.fullPath && basePath) {
            // Create a new File with the path property for Electron compatibility
            const fileWithPath = file as File & { path?: string };
            // Note: We can't actually set file.path as it's read-only
            // But we can use the fullPath from the entry
            (fileWithPath as any)._entryPath = basePath + entry.fullPath;
          }
          resolve([file]);
        });
      });
    }

    if (entry.isDirectory && acceptDirectory) {
      const reader = entry.createReader();
      const entries: any[] = [];

      const readAll = (): Promise<void> => new Promise((resolve) => {
        reader.readEntries((batch: any[]) => {
          if (batch.length === 0) return resolve();
          entries.push(...batch);
          resolve(readAll());
        });
      });

      await readAll();
      const nested = await Promise.all(entries.map((child) => readEntry(child, basePath)));
      return nested.flat();
    }

    return [];
  };

  // Build a map of original file paths from directFiles (if available)
  const pathMap = new Map<string, string>();
  for (const file of directFiles) {
    const filePath = (file as File & { path?: string }).path;
    if (filePath) {
      pathMap.set(file.name, filePath);
    }
  }

  const entryFiles = await Promise.all(
    items
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean)
      .map((entry) => {
        // Try to get the base path from the original file
        const basePath = pathMap.get(entry.name)?.replace(/[/\\][^/\\]*$/, '') || '';
        return readEntry(entry, basePath);
      })
  );

  const allFiles = entryFiles.flat();

  // For non-directory drops, prefer the direct files as they have the path property
  if (!hasDirectory && directFiles.length === allFiles.length) {
    return directFiles;
  }

  return allFiles;
}

/**
 * Check if a file matches the accepted types
 */
function fileMatchesType(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;

  for (const type of accept) {
    if (type.endsWith('/*')) {
      // Wildcard type like 'image/*'
      const baseType = type.slice(0, -2);
      if (file.type.startsWith(baseType)) return true;
    } else if (type.startsWith('.')) {
      // Extension like '.pdf'
      if (file.name.toLowerCase().endsWith(type.toLowerCase())) return true;
    } else {
      // Exact type like 'text/plain'
      if (file.type === type) return true;
    }
  }

  return false;
}

export const DropZone: Component<DropZoneProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);
  let dropZoneRef: HTMLDivElement | undefined;

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set dragging to false if we're actually leaving the drop zone
    // relatedTarget is the element we're entering, if it's null or outside our container, we're leaving
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !dropZoneRef?.contains(relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ensure dragging state stays true while over the zone
    if (!isDragging()) {
      setIsDragging(true);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (props.disabled) return;

    const allFiles = await getDroppedFiles(e.dataTransfer, props.acceptDirectory ?? true);

    // Filter by accepted types
    const accept = props.accept || [];
    const filteredFiles = accept.length > 0
      ? allFiles.filter(f => fileMatchesType(f, accept))
      : allFiles;

    if (filteredFiles.length > 0) {
      props.onDrop(filteredFiles);
    }
  };

  return (
    <div
      ref={dropZoneRef}
      class={`drop-zone ${isDragging() ? 'dragging' : ''} ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Show when={isDragging() && props.dragContent} fallback={props.children}>
        {props.dragContent}
      </Show>
    </div>
  );
};

export default DropZone;
