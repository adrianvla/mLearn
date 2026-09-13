import type { KnowledgeProjection } from '../src/shared/graph/ipc';

export function projectionFixture(status = 'unknown', basis = 'unmeasured'): KnowledgeProjection {
  const classification: 'known' | 'learning' | 'unknown' | 'unmeasured' = basis === 'unmeasured' ? 'unmeasured' : status as 'known' | 'learning' | 'unknown';
  const state = { classification, basis: basis as 'claim' | 'evidence' | 'unmeasured' };
  return { status: 'ready', targets: [], lexical: { overall: state, entryIds: [], sense: state, spoken: state, surfaceRecognition: state, synchronized: classification === 'known', missingBridges: [] } };
}
