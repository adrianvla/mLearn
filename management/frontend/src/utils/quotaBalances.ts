export interface QuotaBalance {
  scopeKind: string;
  scopeId: string;
  metric: string;
  remaining: number | null;
}

/** Compare remaining capacity only within the same accounting unit. */
export function individualQuotaBalances(buckets: QuotaBalance[]): Record<string, string> {
  const users = new Map<string, Map<string, number | null>>();
  for (const bucket of buckets) {
    if (bucket.scopeKind !== 'user') continue;
    const metrics = users.get(bucket.scopeId) ?? new Map<string, number | null>();
    const current = metrics.get(bucket.metric);
    if (current === undefined || current === null || (bucket.remaining !== null && bucket.remaining < current)) metrics.set(bucket.metric, bucket.remaining);
    users.set(bucket.scopeId, metrics);
  }
  const labels: Record<string, string> = { requests: 'requests', inputTokens: 'input tokens', outputTokens: 'output tokens', totalTokens: 'total tokens', costMicros: 'cost micros' };
  return Object.fromEntries([...users].map(([user, metrics]) => [user, [...metrics].map(([metric, remaining]) => `${remaining === null ? 'Governed' : remaining.toLocaleString()} ${labels[metric] ?? metric}`).join('; ')]));
}
