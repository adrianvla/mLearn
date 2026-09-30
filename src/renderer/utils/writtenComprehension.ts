import type { WordStatus } from '../../shared/constants';
import type { AccessStatusResult } from './accessKnowledge';
import type { CapabilityKey } from '../../shared/types';

interface WrittenComprehensionQuery {
  readonly surface: string;
  readonly language: string;
  readonly lexicalWord?: string;
}

type ReadAccess = (word: string, capability: CapabilityKey, language: string) => AccessStatusResult;

/**
 * Silent comprehension traverses the presented surface to identity, then
 * identity to meaning.
 *
 * A whole-word claim settles the traversal whatever the written-form bridge
 * happens to say. That is not the same as reading the bridge: an unmeasured
 * `surface-recognition` is normally the *correct* answer for a word the learner
 * only knows by heart, and this function is what keeps such a word out of the
 * unknown-words list. But the manual claim is an explicit statement about the
 * word, and it is stored word-level, so the surface read cannot see it — a word
 * the learner had answered "I know this" for was re-listed as unknown by every
 * surface that asks this question, even though the comprehensive projection
 * reported it as `known` on the very same screen.
 *
 * Only a claim counts here, and only to release the word from the unknown
 * list. Evidence still decides on its own: an unmeasured bridge keeps a
 * learner who has merely *seen* a word in the list, which is the whole reason
 * this rule exists.
 */
export function getWrittenComprehensionStatus(query: WrittenComprehensionQuery, readAccess: ReadAccess): WordStatus {
  const surface = readAccess(query.surface, 'surface-recognition', query.language).status;
  const meaning = readAccess(query.lexicalWord ?? query.surface, 'sense-recognition', query.language);
  // A claim is a statement about the word, so it settles the traversal even
  // when the written-form bridge has never been measured. It is stored
  // word-level, so it cannot be seen from the surface read - but it must not
  // be allowed to speak for a SPELLING the learner was never shown either,
  // so it only releases the exact surface it was made on. Everything else
  // still decides on evidence alone, which is what keeps a word known only by
  // heart in the list.
  if (surface === 'unknown'
    && meaning.basis === 'claim'
    && query.surface === (query.lexicalWord ?? query.surface)) {
    return meaning.status;
  }
  if (surface === 'unknown' || meaning.status === 'unknown') return 'unknown';
  if (surface === 'learning' || meaning.status === 'learning') return 'learning';
  return 'known';
}
