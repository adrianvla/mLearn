import type { GraphPage, GraphProperty, JsonValue, LinguisticEntity, LinguisticLabel } from '@mlearn/contracts';
import { isKnowledgeProjection } from './watchProtocol';

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0') && encoder.encode(value).length <= max;
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function json(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) ? value.every(json) : object(value) && Object.values(value).every(json);
}
function label(value: unknown, packageId: string): value is LinguisticLabel {
  return object(value) && text(value.id) && value.id.startsWith(`${packageId}:`)
    && text(value.label, 128) && text(value.attribution, 2048)
    && (value.color === null || typeof value.color === 'string' && /^#[a-f0-9]{6}$/i.test(value.color));
}
function properties(value: unknown, packageId: string): value is GraphProperty[] {
  return Array.isArray(value) && value.length <= 16 && value.every(item => object(item)
    && text(item.id) && item.id.startsWith(`${packageId}:`) && text(item.label, 128)
    && text(item.attribution, 2048) && json(item.value)
    && encoder.encode(JSON.stringify(item.value)).length <= 2048)
    && new Set(value.map(item => item.id)).size === value.length;
}
function entity(value: unknown, packageId: string): value is LinguisticEntity {
  return object(value) && text(value.id) && text(value.label) && label(value.kind, packageId)
    && text(value.attribution, 2048) && (value.targetId === null || text(value.targetId))
    && Array.isArray(value.capabilities) && value.capabilities.length <= 8
    && value.capabilities.every(item => object(item) && text(item.id, 256)
      && item.id.startsWith(`${packageId}:`) && text(item.label, 128))
    && new Set(value.capabilities.map(item => item.id)).size === value.capabilities.length
    && (value.targetId !== null || value.capabilities.length === 0)
    && properties(value.properties, packageId);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((item, index) => sameValue(item, right[index]));
  return object(left) && object(right) && Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([key, item]) => Object.hasOwn(right, key) && sameValue(item, right[key]));
}

export function isGraphPage(value: unknown): value is GraphPage {
  if (!object(value) || !text(value.packageId) || !text(value.packageVersion)
    || !revision(value.packageRevision) || !entity(value.entity, value.packageId)
    || value.entity.targetId === null) return false;
  const packageId = value.packageId;
  const root = value.entity;
  if (!Array.isArray(value.connections) || value.connections.length > 16
    || !value.connections.every(item => object(item) && object(item.relation)
      && entity(item.entity, packageId)
      && text(item.relation.id) && typeof item.relation.category === 'string'
      && ['identity', 'property', 'alternative', 'support'].includes(item.relation.category)
      && label(item.relation.predicate, packageId) && text(item.relation.attribution, 2048)
      && properties(item.relation.qualifiers, packageId)
      && (item.relation.from === root.id && item.relation.to === item.entity.id
        || item.relation.to === root.id && item.relation.from === item.entity.id))
    || new Set(value.connections.map(item => item.relation.id)).size !== value.connections.length
    || !Array.isArray(value.knowledge) || value.knowledge.length > 136
    || !value.knowledge.every(isKnowledgeProjection)
    || !(value.next === null || object(value.next) && revision(value.next.identity) && text(value.next.after))
    || encoder.encode(JSON.stringify({ entity: value.entity, connections: value.connections,
      next: value.next?.after ?? null })).length > 131072
    || encoder.encode(JSON.stringify(value)).length > 393216) return false;
  const keys = new Set<string>();
  const entities = new Map<string, LinguisticEntity>();
  for (const item of [value.entity, ...value.connections.map(connection => connection.entity)]) {
    const previous = entities.get(item.id);
    if (previous && !sameValue(previous, item)) return false;
    entities.set(item.id, item);
    if (item.targetId !== null) for (const capability of item.capabilities)
      keys.add(JSON.stringify([item.targetId, capability.id]));
  }
  const projections = value.knowledge.map(item => JSON.stringify([item.key.targetId, item.key.capability]));
  return value.knowledge.length === keys.size && new Set(projections).size === projections.length
    && value.knowledge.every(item => item.key.packageId === value.packageId)
    && projections.every(key => keys.has(key));
}
