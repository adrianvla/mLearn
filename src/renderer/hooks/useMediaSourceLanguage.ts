import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { loadMediaSourceLanguage, saveMediaSourceLanguage, mediaSourceLanguageKey,
  type MediaSourceIdentity, type MediaSourceLanguage, type MediaLanguagePreference } from '../services/mediaSourceLanguage';

export interface PreparedMediaSource {
  source: MediaSourceIdentity;
  selection: MediaSourceLanguage;
  revision: number;
}

/** Route-local presentation lifetime; durable source preferences remain in KV. */
export function useMediaSourceLanguage(fallbackLanguage: Accessor<string>, fallbackVariant: Accessor<string | undefined>) {
  const [active, setActive] = createSignal<PreparedMediaSource | null>(null);
  const [error, setError] = createSignal<unknown>(null);
  const [saving, setSaving] = createSignal(false);
  const [lastSelection, setLastSelection] = createSignal<MediaLanguagePreference | null>(null);
  let revision = 0;
  let selectionRevision = 0;
  let writeChain: Promise<void> = Promise.resolve();
  let disposed = false;
  onCleanup(() => { disposed = true; revision++; });

  const prepare = async (source: MediaSourceIdentity, authoredLanguages?: readonly string[]): Promise<PreparedMediaSource | null> => {
    const admittedRevision = ++revision;
    const fallback = fallbackLanguage();
    const variant = fallbackVariant();
    const selection = await loadMediaSourceLanguage(source, { authoredLanguages, fallbackLanguage: fallback, fallbackVariantId: variant });
    if (disposed || admittedRevision !== revision) return null;
    return { source, selection, revision: admittedRevision };
  };
  const adopt = (prepared: PreparedMediaSource): boolean => {
    if (disposed || prepared.revision !== revision) return false;
    setActive(prepared);
    setError(null);
    return true;
  };
  const select = async (preference: MediaLanguagePreference): Promise<void> => {
    const admitted = active();
    if (!admitted) return;
    const admittedSelection = ++selectionRevision;
    setLastSelection(preference);
    setSaving(true);
    setError(null);
    try {
      const write = writeChain.then(() => saveMediaSourceLanguage(admitted.source, preference));
      writeChain = write.catch(() => { /* A failed write must not prevent an explicit retry. */ });
      await write;
      if (!disposed && active() === admitted && admittedSelection === selectionRevision) {
        setActive({ ...admitted, selection: { ...preference, basis: 'override', authoredLanguages: admitted.selection.authoredLanguages } });
      }
    } catch (failure) {
      if (!disposed && active() === admitted && admittedSelection === selectionRevision) setError(failure);
      throw failure;
    } finally {
      if (!disposed && admittedSelection === selectionRevision) setSaving(false);
    }
  };
  return {
    active, prepare, adopt, select, error, saving, lastSelection,
    isCurrent: (prepared: PreparedMediaSource) => !disposed && prepared.revision === revision,
    language: () => active()?.selection.language ?? fallbackLanguage(),
    variantId: () => active()?.selection.variantId,
    sourceKey: () => { const source = active(); return source ? mediaSourceLanguageKey(source.source) : undefined; },
  };
}
export type MediaSourceLanguageScope = ReturnType<typeof useMediaSourceLanguage>;
