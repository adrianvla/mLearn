import { uniqueId, validateTokens, type FilterToken } from '../../components/common/FilterBuilder/filterExpr';

export interface FilterScope {
  language: string;
  provider?: string;
  packageVersion?: string;
}

/** Read-only discovery across expressions. Activation still validates the complete owner record. */
export function wordSyncSavedTasks(storage: Pick<Storage, 'getItem'>, key: string, scope: FilterScope) {
  const tasks: Array<{ id: string; rated: number; total: number; tokens: FilterToken[] }> = [];
  try {
    const current = storage.getItem(key);
    const index: unknown = JSON.parse(storage.getItem(`${key}:sessions`) ?? '[]');
    const raws = [current, ...(Array.isArray(index) ? index.flatMap(id => typeof id === 'string'
      ? [storage.getItem(`${key}:session:${encodeURIComponent(id)}`)] : []) : [])];
    for (const raw of raws) {
      const tokens = wordSyncSavedFilter(raw, scope);
      if (!raw || tokens === null) continue;
      const record = JSON.parse(raw);
      if (record.index >= record.queue.length || tasks.some(task => task.id === record.id)) continue;
      tasks.push({ id: record.id, rated: record.rated, total: record.queue.length, tokens });
    }
  } catch { /* Unavailable storage exposes no fabricated resume choice. */ }
  return tasks;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);

/** Recover the expression from the existing session, before building its pool.
 * The controller still owns validation and recovery of the cursor and attempts. */
export function wordSyncSavedFilter(raw: string | null, scope: FilterScope): FilterToken[] | null {
  try {
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (!isObject(record) || typeof record.id !== 'string' || typeof record.identity !== 'string'
      || !Array.isArray(record.queue)) return null;
    const queue = record.queue;
    if (!queue.every(item => isObject(item) && typeof item.id === 'string')
      || !Array.isArray(record.visited) || !record.visited.every(index => Number.isInteger(index) && index >= 0 && index < queue.length)
      || !Number.isInteger(record.index) || Number(record.index) < 0 || Number(record.index) > queue.length
      || !Number.isInteger(record.rated) || Number(record.rated) < 0
      || !isObject(record.meta) || record.meta.assessment !== undefined) return null;
    const identity: unknown = JSON.parse(record.identity);
    if (!isObject(identity) || identity.language !== scope.language || identity.provider !== scope.provider
      || identity.packageVersion !== scope.packageVersion || !Array.isArray(identity.tokens)) return null;
    const tokens: FilterToken[] = [];
    for (const token of identity.tokens) {
      if (!isObject(token)) return null;
      const valid = token.kind === 'operand'
        ? typeof token.field === 'string' && typeof token.value === 'string'
          && typeof token.op === 'string' && ['eq', 'neq', 'in', 'gte', 'lte'].includes(token.op)
        : token.kind === 'operator' ? token.op === 'AND' || token.op === 'OR'
          : token.kind === 'not' ? true
            : token.kind === 'paren' && (token.dir === 'open' || token.dir === 'close');
      if (!valid) return null;
      // Preserve package-owned fields and opaque values; IDs belong to this UI mount.
      tokens.push({ ...token, instanceId: uniqueId() } as FilterToken);
    }
    return validateTokens(tokens).ok ? tokens : null;
  } catch { return null; }
}
