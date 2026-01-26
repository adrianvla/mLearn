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
 */
async function getDroppedFiles(
  dataTransfer: DataTransfer | null,
  acceptDirectory: boolean = true
): Promise<File[]> {
  if (!dataTransfer) return [];
  
  const items = Array.from(dataTransfer.items || []);
  const hasEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');
  
  if (!hasEntries) {
    return Array.from(dataTransfer.files || []);
  }

  const readEntry = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => resolve([file]));
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
      const nested = await Promise.all(entries.map((child) => readEntry(child)));
      return nested.flat();
    }
    
    return [];
  };

  const entryFiles = await Promise.all(
    items
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean)
      .map((entry) => readEntry(entry))
  );

  return entryFiles.flat();
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
  const [dragCounter, setDragCounter] = createSignal(0);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(c => c + 1);
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(c => c - 1);
    if (dragCounter() <= 1) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

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
