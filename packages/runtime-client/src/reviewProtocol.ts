import type { ChoiceOption, PracticeItem, Response, ResponseSpec, ReviewCapture, ReviewCommand, ReviewConditions, ReviewEncounter, ReviewGrade, ReviewMode, ReviewSession, ReviewSubject, ReviewTask, TargetPracticeItem, TaskResponse, ValidationOutput } from '@mlearn/contracts';
import { encodedBytes, isSourceAnchor } from './materialProtocol';

const encoder = new TextEncoder();
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const text = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= max;
const uint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
const positive = (value: unknown): value is number => uint(value) && value > 0;
export function isReviewSubject(value: unknown): value is ReviewSubject & Record<string, unknown> {
  if (!object(value)) return false;
  if (Object.hasOwn(value, 'targetId')) {
    return text(value.targetId) && !value.targetId.includes('\0') && !Object.hasOwn(value, 'materialId')
      && !Object.hasOwn(value, 'materialRevision');
  }
  return text(value.materialId) && !value.materialId.includes('\0') && positive(value.materialRevision);
}
const nullable = (value: unknown, guard: (item: unknown) => boolean) => value === null || guard(value);
function list<T>(value: unknown, max: number, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= max && value.every(guard);
}
const member = (value: unknown, choices: readonly string[]): value is string =>
  typeof value === 'string' && choices.includes(value);
const assistance = (value: unknown): value is string =>
  member(value, ['inspector', 'source', 'prior_disclosure', 'repeated_exposure']);
const delivery = (value: unknown): value is string =>
  member(value, ['not_required', 'pending', 'started', 'completed', 'interrupted', 'failed']);
export function isReviewConditions(value: unknown): value is ReviewConditions {
  return record(value, ['revealed', 'exposureCount', 'assistance', 'delivery'])
    && typeof value.revealed === 'boolean' && uint(value.exposureCount)
    && list(value.assistance, 4, assistance) && new Set(value.assistance).size === value.assistance.length
    && delivery(value.delivery);
}
export function isReviewGrade(value: unknown): value is ReviewGrade {
  return record(value, ['targetId', 'quality', 'method', 'easy']) && text(value.targetId, 256)
    && nullable(value.quality, item => member(item, ['missed', 'struggled', 'fluent']))
    && member(value.method, ['remembered', 'worked_out']) && typeof value.easy === 'boolean'
    && (!value.easy || value.quality === 'fluent');
}
function key(value: unknown): value is { packageId: string; targetId: string; capability: string } {
  return record(value, ['packageId', 'targetId', 'capability'])
    && text(value.packageId) && text(value.targetId) && text(value.capability);
}
const keyId = (value: { packageId: string; targetId: string; capability: string }) =>
  JSON.stringify([value.packageId, value.targetId, value.capability]);
function target(value: unknown): value is ReviewEncounter['targets'][number] {
  return record(value, ['id', 'label', 'mnemonic', 'key']) && text(value.id, 256) && text(value.label, 256)
    && nullable(value.mnemonic, item => typeof item === 'string' && encoder.encode(item).length <= 16384)
    && nullable(value.key, key);
}
function practiceItem(value: unknown): value is PracticeItem {
  return record(value, ['materialId', 'source']) && text(value.materialId)
    && nullable(value.source, isSourceAnchor);
}
function targetPracticeItem(value: unknown): value is TargetPracticeItem {
  return record(value, ['packageId', 'packageRevision', 'targetId', 'capabilities', 'source'])
    && text(value.packageId) && text(value.packageRevision) && text(value.targetId)
    && list(value.capabilities, 32, (item): item is string => text(item)) && value.capabilities.length > 0
    && new Set(value.capabilities).size === value.capabilities.length
    && nullable(value.source, isSourceAnchor);
}
function responseSpec(value: unknown): value is ResponseSpec {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'self_report': return record(value, ['kind']);
    case 'typed_text': return record(value, ['kind', 'maxBytes'])
      && positive(value.maxBytes) && value.maxBytes <= 2048;
    case 'choice_id': return record(value, ['kind', 'options'])
      && list(value.options, 8, (item): item is ChoiceOption =>
        record(item, ['id', 'label']) && text(item.id, 256) && text(item.label, 2048))
      && value.options.length >= 2
      && new Set(value.options.map(option => option.id)).size === value.options.length;
    default: return false;
  }
}
function taskResponse(value: unknown): value is TaskResponse {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'typed_text': return record(value, ['kind', 'text'])
      && typeof value.text === 'string' && value.text.length <= 2048 && encoder.encode(value.text).length <= 2048;
    case 'choice_id': return record(value, ['kind', 'id']) && text(value.id, 256);
    default: return false;
  }
}
function task(value: unknown): value is ReviewTask {
  return record(value, ['revision', 'responseSpec', 'attribution', 'limitations'])
    && positive(value.revision) && responseSpec(value.responseSpec)
    && text(value.attribution, 4096) && text(value.limitations, 4096);
}
function validation(value: unknown): value is ValidationOutput {
  return record(value, ['contractVersion', 'taskId', 'taskRevision', 'validatorId', 'outcomes'])
    && value.contractVersion === 1 && text(value.taskId, 256)
    && positive(value.taskRevision) && text(value.validatorId, 256)
    && list(value.outcomes, 32, (row): row is ValidationOutput['outcomes'][number] =>
      record(row, ['targetId', 'result', 'reason']) && text(row.targetId, 256)
      && member(row.result, ['accepted', 'rejected', 'unassessed']) && text(row.reason, 256))
    && value.outcomes.length > 0
    && new Set(value.outcomes.map(row => row.targetId)).size === value.outcomes.length;
}
export function isReviewCapture(value: unknown): value is ReviewCapture {
  return record(value, ['id', 'response', 'conditions', 'feedback'])
    && text(value.id) && taskResponse(value.response) && isReviewConditions(value.conditions)
    && nullable(value.feedback, validation);
}
function responseMatchesTask(specification: ResponseSpec, response: TaskResponse): boolean {
  switch (specification.kind) {
    case 'self_report': return false;
    case 'typed_text': return response.kind === 'typed_text'
      && encoder.encode(response.text).length <= specification.maxBytes;
    case 'choice_id': return response.kind === 'choice_id'
      && specification.options.some(option => option.id === response.id);
  }
}
function mode(value: unknown): value is ReviewMode {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'continuous': return record(value, ['kind']);
    case 'finite': return record(value, ['kind', 'limit']) && positive(value.limit) && value.limit <= 128;
    case 'practice': return record(value, ['kind', 'items']) && list(value.items, 128, practiceItem)
      && value.items.length > 0 && new Set(value.items.map(item => item.materialId)).size === value.items.length;
    case 'target_practice': return record(value,
      Object.hasOwn(value, 'assistance') ? ['kind', 'items', 'assistance'] : ['kind', 'items'])
      && (value.assistance === undefined || list(value.assistance, 2,
        item => item === 'inspector' || item === 'source')
        && new Set(value.assistance).size === value.assistance.length)
      && list(value.items, 128, targetPracticeItem) && value.items.length > 0
      && new Set(value.items.map(item => JSON.stringify([item.packageId, item.targetId]))).size === value.items.length;
    default: return false;
  }
}
function encounter(value: unknown): value is ReviewEncounter {
  const fields = ['id', 'workId', 'packageId', 'packageVersion',
    'packageRevision', 'probeId', 'probeContractVersion', 'direction', 'cue', 'answer', 'targets',
    'supplied', 'requiredMedia', 'source', 'conditions', 'correction'];
  if (object(value) && Object.hasOwn(value, 'task')) fields.push('task');
  if (object(value) && Object.hasOwn(value, 'capture')) fields.push('capture');
  if (object(value) && Object.hasOwn(value, 'targetId')) fields.push('targetId');
  else fields.push('materialId', 'materialRevision');
  if (!record(value, fields)
    || !text(value.id) || !text(value.workId) || !isReviewSubject(value)
    || !text(value.packageId) || !text(value.packageVersion) || !text(value.packageRevision)
    || !text(value.probeId, 256) || value.probeContractVersion !== 1
    || !member(value.direction, ['written', 'focused', 'audio']) || !text(value.cue, 16384)
    || !nullable(value.answer, item => text(item, 16384))
    || !list(value.targets, 32, target) || !value.targets.length || !list(value.supplied, 64, key)
    || !nullable(value.requiredMedia, text) || !nullable(value.source, isSourceAnchor)
    || typeof value.correction !== 'boolean'
    || !isReviewConditions(value.conditions)
    || value.task !== undefined && !task(value.task)
    || value.capture !== undefined && !isReviewCapture(value.capture)) return false;
  const conditions = value.conditions;
  if (conditions.revealed !== (value.answer !== null)
    || value.correction && !conditions.revealed
    || new Set(value.targets.map(row => row.id)).size !== value.targets.length) return false;
  const tested = value.targets.flatMap(row => row.key === null ? [] : [keyId(row.key)]);
  if (new Set(tested).size !== tested.length || value.supplied.some(item => tested.includes(keyId(item)))
    || value.targets.some(row => row.key !== null && row.key.packageId !== value.packageId)) return false;
  if ('targetId' in value && (value.task === undefined
    || value.targets.some(row => row.key === null || row.key.targetId !== value.targetId))) return false;
  const captured = value.capture;
  const specification = value.task;
  const targets = value.targets;
  if (captured !== undefined) {
    if (specification === undefined || !responseMatchesTask(specification.responseSpec, captured.response)
      || captured.conditions.exposureCount > conditions.exposureCount
      || captured.conditions.revealed && !conditions.revealed
      || captured.conditions.assistance.some(item => !conditions.assistance.includes(item))
      || (captured.feedback !== null) !== conditions.revealed) return false;
    if (captured.feedback !== null
      && (captured.feedback.taskId !== value.probeId || captured.feedback.taskRevision !== specification.revision
        || captured.feedback.outcomes.length !== targets.length
        || captured.feedback.outcomes.some(row => !targets.some(target => target.id === row.targetId)))) return false;
  }
  return value.direction === 'audio'
    ? value.requiredMedia !== null && conditions.delivery !== 'not_required'
    : value.requiredMedia === null && conditions.delivery === 'not_required';
}
export function isReviewSession(value: unknown): value is ReviewSession {
  if (!record(value, ['id', 'revision', 'mode', 'state', 'completed', 'total', 'encounter', 'canUndo', 'message'])
    || !text(value.id) || !positive(value.revision) || !mode(value.mode)
    || !member(value.state, ['active', 'paused', 'complete', 'unavailable']) || !uint(value.completed)
    || !nullable(value.total, uint) || typeof value.canUndo !== 'boolean'
    || !nullable(value.message, item => text(item, 32768))) return false;
  if (typeof value.total === 'number' && value.completed > value.total) return false;
  const currentEncounter = value.encounter;
  if (currentEncounter !== null && !encounter(currentEncounter)) return false;
  if (currentEncounter !== null && currentEncounter.task !== undefined
    && value.mode.kind !== 'practice' && value.mode.kind !== 'target_practice') return false;
  switch (value.mode.kind) {
    case 'continuous': return value.total === null;
    case 'finite': return uint(value.total) && value.total <= value.mode.limit;
    case 'practice': return uint(value.total) && value.total >= value.mode.items.length
      && value.total <= value.mode.items.length * 8
      && (currentEncounter === null || 'materialId' in currentEncounter
        && value.mode.items.some(item => item.materialId === currentEncounter.materialId));
    case 'target_practice': return uint(value.total) && value.total >= value.mode.items.length
      && value.total <= value.mode.items.length * 8
      && (currentEncounter === null || 'targetId' in currentEncounter
        && (value.mode.assistance ?? []).every(item => currentEncounter.conditions.assistance.includes(item))
        && value.mode.items.some(item => item.targetId === currentEncounter.targetId
          && item.packageId === currentEncounter.packageId
          && item.packageRevision === currentEncounter.packageRevision
          && currentEncounter.targets.every(row => row.key !== null
            && item.capabilities.includes(row.key.capability))));
  }
}
function mutation(value: unknown) {
  return record(value, ['commandId', 'sessionId', 'expectedRevision'])
    && text(value.commandId, 128) && text(value.sessionId) && positive(value.expectedRevision);
}
function response(value: unknown) {
  const fields = ['encounterId', 'grades'];
  if (object(value) && Object.hasOwn(value, 'captureId')) fields.push('captureId');
  return record(value, fields) && text(value.encounterId)
    && (value.captureId === undefined || text(value.captureId))
    && list(value.grades, 32, isReviewGrade)
    && value.grades.length > 0 && new Set(value.grades.map(row => row.targetId)).size === value.grades.length;
}
export function isReviewCommand(value: unknown): value is ReviewCommand {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'start': return record(value, ['kind', 'start'])
      && record(value.start, ['commandId', 'sessionId', 'mode']) && text(value.start.commandId, 128)
      && text(value.start.sessionId) && mode(value.start.mode);
    case 'next': case 'undo': case 'pause': case 'resume':
      return record(value, ['kind', 'mutation']) && mutation(value.mutation);
    case 'reveal': return record(value, ['kind', 'mutation', 'encounterId'])
      && mutation(value.mutation) && text(value.encounterId);
    case 'delivery': return record(value, ['kind', 'mutation', 'encounterId', 'delivery'])
      && mutation(value.mutation) && text(value.encounterId) && delivery(value.delivery);
    case 'assistance': return record(value, ['kind', 'mutation', 'encounterId', 'assistance'])
      && mutation(value.mutation) && text(value.encounterId) && assistance(value.assistance);
    case 'capture_response': return record(value, ['kind', 'mutation', 'encounterId', 'response'])
      && mutation(value.mutation) && text(value.encounterId) && taskResponse(value.response);
    case 'submit': case 'correct': return record(value, ['kind', 'mutation', 'response'])
      && mutation(value.mutation) && response(value.response);
    default: return false;
  }
}
export type ReviewWireResponse = Extract<Response, { type: 'review' | 'review_session' | 'review_sessions' }>;
export function isReviewResponse(value: unknown): value is ReviewWireResponse {
  if (!object(value) || encodedBytes(value) > 524288) return false;
  switch (value.type) {
    case 'review': return record(value, ['type', 'commit'])
      && record(value.commit, ['commandId', 'committedRevision', 'session']) && text(value.commit.commandId, 128)
      && positive(value.commit.committedRevision) && isReviewSession(value.commit.session)
      && value.commit.committedRevision <= value.commit.session.revision;
    case 'review_session': return record(value, ['type', 'session']) && isReviewSession(value.session);
    case 'review_sessions': return record(value, ['type', 'sessions']) && list(value.sessions, 32, isReviewSession)
      && new Set(value.sessions.map(session => session.id)).size === value.sessions.length;
    default: return false;
  }
}
