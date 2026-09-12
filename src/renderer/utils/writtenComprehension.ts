import type { WordStatus } from '../../shared/constants';
import type { AccessStatusResult } from './accessKnowledge';
import type { CapabilityKey } from '../../shared/types';

interface WrittenComprehensionQuery {
  readonly surface: string;
  readonly language: string;
  readonly lexicalWord?: string;
}

type ReadAccess = (word: string, capability: CapabilityKey, language: string) => AccessStatusResult;

/** Silent comprehension traverses the presented surface to identity, then identity to meaning. */
export function getWrittenComprehensionStatus(query: WrittenComprehensionQuery, readAccess: ReadAccess): WordStatus {
  const surface = readAccess(query.surface, 'surface-recognition', query.language).status;
  const meaning = readAccess(query.lexicalWord ?? query.surface, 'sense-recognition', query.language).status;
  if (surface === 'unknown' || meaning === 'unknown') return 'unknown';
  if (surface === 'learning' || meaning === 'learning') return 'learning';
  return 'known';
}
