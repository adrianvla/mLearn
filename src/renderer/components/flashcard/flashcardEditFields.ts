import type { Flashcard, FlashcardContent, FlashcardState } from '../../../shared/types';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardEditFields");

// Content fields that the advanced editor shows, in display order.
export const CONTENT_FIELDS: (keyof FlashcardContent)[] = [
  'type', 'front', 'back', 'reading', 'prosody', 'pos', 'level',
  'example', 'exampleMeaning', 'imageUrl', 'audioUrl', 'context', 'source',
  'sourceMediaHash', 'videoUrl', 'skipExampleTts', 'unpopulated', 'userEditedFields',
];

// Metadata fields on the Flashcard itself (not content).
export const METADATA_FIELDS: (keyof Flashcard)[] = [
  'id', 'state', 'ease', 'interval', 'dueDate', 'reviews', 'lapses',
  'learningStep', 'createdAt', 'lastReviewed', 'lastUpdated',
  'tags', 'language', 'suspended', 'buried',
];

export const READONLY_FIELDS = new Set<string>(['id', 'createdAt']);

export type DraftValue = string | boolean;

export const CONTENT_BOOLEAN_FIELDS = new Set<keyof FlashcardContent>(['skipExampleTts', 'unpopulated']);
export const METADATA_BOOLEAN_FIELDS = new Set<keyof Flashcard>(['suspended', 'buried']);
export const CLEARABLE_METADATA_FIELDS = new Set<keyof Flashcard>(['tags', 'language', 'suspended', 'buried']);

/** Serialize a value to a displayable draft value for the advanced editor. */
export function valueToDraftValue(val: unknown): DraftValue {
  if (val === undefined || val === null) return '';
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return JSON.stringify(val, null, 2);
}

/** Parse a string back into a typed value for the given field. */
export function parseFieldValue(key: string, raw: DraftValue): unknown {
  if (typeof raw === 'boolean') return raw;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const numFields = new Set([
    'level', 'ease', 'interval', 'dueDate', 'reviews',
    'lapses', 'learningStep', 'createdAt', 'lastReviewed', 'lastUpdated',
  ]);
  if (numFields.has(key)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }

  if (key === 'state') {
    const valid: FlashcardState[] = ['new', 'learning', 'review', 'relearning'];
    if (valid.includes(trimmed as FlashcardState)) return trimmed;
    return trimmed;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      log.error("error", e);
      return trimmed;
    }
  }

  return trimmed;
}
