import type { KnowledgeProjectionState } from '../../../../shared/graph/ipc';

/** Display horizon only. A long schedule is still a schedule, never infinite retention. */
export function retentionPresentation(retention: NonNullable<KnowledgeProjectionState['retention']>, now: number): { key: string; params: Record<string, string> } {
  const date = new Date(retention.dueAt);
  if (!Number.isFinite(date.getTime())) return { key: 'mlearn.Knowledge.Projection.RetentionUnavailable', params: {} };
  if (retention.pressure === 0 && retention.dueAt - now > 365 * 24 * 60 * 60 * 1000) {
    return { key: 'mlearn.Knowledge.Projection.RetentionDistant', params: {} };
  }
  return { key: 'mlearn.Knowledge.Projection.Retention', params: { pressure: retention.pressure.toFixed(2), due: date.toLocaleDateString() } };
}
