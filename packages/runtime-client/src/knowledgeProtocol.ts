import type { KnowledgeEvidencePage, KnowledgeObservation } from '@mlearn/contracts';
import { isKnowledgeProjection } from './watchProtocol';
import { isReviewConditions, isReviewGrade } from './reviewProtocol';
import { isSourceAnchor } from './sourceProtocol';

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0') && encoder.encode(value).length <= max;
const uint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
const positive = (value: unknown): value is number => uint(value) && value > 0;
const optionalBoolean = (value: unknown) => value === null || typeof value === 'boolean';
function observation(value: unknown): value is KnowledgeObservation {
  return object(value) && positive(value.sequence) && text(value.attemptId) && text(value.sessionId)
    && text(value.encounterId) && typeof value.active === 'boolean'
    && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
    && text(value.materialId) && positive(value.materialRevision) && text(value.packageVersion)
    && text(value.packageRevision) && text(value.probeId, 256) && positive(value.probeContractVersion)
    && typeof value.direction === 'string' && ['written', 'focused', 'audio'].includes(value.direction)
    && isReviewConditions(value.conditions) && isReviewGrade(value.grade) && value.grade.quality !== null
    && optionalBoolean(value.assessed) && typeof value.practice === 'boolean'
    && (value.source === null || isSourceAnchor(value.source));
}

export function isKnowledgeEvidencePage(value: unknown): value is KnowledgeEvidencePage {
  if (!object(value) || !object(value.projection) || !object(value.projection.key)) return false;
  const key = value.projection.key;
  if (!isKnowledgeProjection(value.projection)
    || !['packageId', 'targetId', 'capability'].every(field => text(key[field]))
    || value.claimRevision !== null && !uint(value.claimRevision)
    || value.assessedAttempt !== null && !text(value.assessedAttempt)
    || (value.assessedAttempt === null) !== (value.projection.assessed === null)
    || !Array.isArray(value.observations) || value.observations.length > 16
    || !value.observations.every(observation)
    || encoder.encode(JSON.stringify(value.observations)).length > 131104
    || encoder.encode(JSON.stringify(value)).length > 196608) return false;
  const observations = value.observations;
  if (new Set(observations.map(item => item.attemptId)).size !== observations.length
    || observations.some((item, index) => index > 0 && item.sequence >= observations[index - 1].sequence)) return false;
  const assessed = observations.find(item => item.attemptId === value.assessedAttempt);
  if (assessed && (!assessed.active || assessed.assessed !== value.projection.assessed)) return false;
  if (value.next === null) return true;
  return object(value.next) && typeof value.next.identity === 'string' && /^[a-f0-9]{64}$/.test(value.next.identity)
    && positive(value.next.before) && value.next.before === observations.at(-1)?.sequence
    && value.next.revision === value.projection.revision;
}
