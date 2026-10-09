import { getBridge } from '../../shared/bridges';
import { hashWordSync } from './srsAlgorithm';

/** A resource identity is never a display title or the ambient study language. */
export interface MediaSourceIdentity {
  kind: 'book' | 'video';
  resourceId: string;
}
export interface MediaLanguagePreference {
  language: string;
  variantId?: string;
}
export interface MediaSourceLanguage extends MediaLanguagePreference {
  basis: 'override' | 'authored' | 'fallback';
  authoredLanguages: string[];
}
interface SourceRecord extends Record<string, unknown> {
  override?: MediaLanguagePreference;
  resolved?: MediaSourceLanguage;
}

export function mediaSourceLanguageKey(source: MediaSourceIdentity): string {
  if (!source.resourceId.trim()) throw new Error('A source resource identity is required');
  return `mlearn-source-language::${hashWordSync(JSON.stringify([source.kind, source.resourceId]))}`;
}

async function readSourceRecord(key: string): Promise<SourceRecord> {
  const raw = await getBridge().kvStore.kvGet(key);
  if (!raw) return {};
  const record: unknown = JSON.parse(raw);
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid source language record');
  for (const value of [(record as SourceRecord).override, (record as SourceRecord).resolved]) {
    if (value !== undefined && (!value || typeof value.language !== 'string' || !value.language.trim()
      || (value.variantId !== undefined && typeof value.variantId !== 'string'))) throw new Error('Invalid source language preference');
  }
  return record as SourceRecord;
}

export async function loadMediaSourceLanguage(source: MediaSourceIdentity, input: {
  authoredLanguages?: readonly string[];
  fallbackLanguage: string;
  fallbackVariantId?: string;
}): Promise<MediaSourceLanguage> {
  const key = mediaSourceLanguageKey(source);
  const record = await readSourceRecord(key);
  const authoredLanguages = [...new Set((input.authoredLanguages ?? record.resolved?.authoredLanguages ?? [])
    .map(language => language.trim()).filter(Boolean))];
  if (record.override) return { ...record.override, basis: 'override', authoredLanguages };
  if (authoredLanguages.length === 1) {
    const resolved: MediaSourceLanguage = { language: authoredLanguages[0], basis: 'authored', authoredLanguages };
    if (JSON.stringify(record.resolved) !== JSON.stringify(resolved)) {
      await getBridge().kvStore.kvSet(key, JSON.stringify({ ...record, resolved }));
    }
    return resolved;
  }
  if (record.resolved) return { ...record.resolved, authoredLanguages };
  if (!input.fallbackLanguage.trim()) throw new Error('Select a source language');
  const resolved: MediaSourceLanguage = {
    language: input.fallbackLanguage,
    ...(input.fallbackVariantId ? { variantId: input.fallbackVariantId } : {}),
    basis: 'fallback', authoredLanguages,
  };
  // A replaceable, visibly labelled fallback is an established source context
  // on subsequent resume. It never becomes an authored claim or learner truth.
  await getBridge().kvStore.kvSet(key, JSON.stringify({ ...record, resolved }));
  return resolved;
}

export async function saveMediaSourceLanguage(source: MediaSourceIdentity, preference: MediaLanguagePreference): Promise<void> {
  if (!preference.language.trim()) throw new Error('Select a source language');
  const key = mediaSourceLanguageKey(source);
  const record = await readSourceRecord(key);
  await getBridge().kvStore.kvSet(key, JSON.stringify({ ...record, override: preference }));
}

/** Pathless imports use bytes, so identically named files never alias. */
export async function mediaFileResourceId(path: string, files: readonly File[]): Promise<string> {
  if (path) return path;
  if (files.length === 0) throw new Error('A source resource is required');
  const hashes: string[] = [];
  for (const file of files) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    hashes.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  return `content:${hashWordSync(JSON.stringify(hashes))}`;
}
