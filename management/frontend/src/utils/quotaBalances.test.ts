import { expect, it } from 'vitest';
import { individualQuotaBalances } from './quotaBalances';
it('never compares requests, tokens, and money as a single quota number', () => {
  expect(individualQuotaBalances([
    { scopeKind: 'user', scopeId: 'u', metric: 'requests', remaining: 80 },
    { scopeKind: 'user', scopeId: 'u', metric: 'requests', remaining: 20 },
    { scopeKind: 'user', scopeId: 'u', metric: 'totalTokens', remaining: 500 },
    { scopeKind: 'group', scopeId: 'school', metric: 'requests', remaining: 1 },
  ])).toEqual({ u: '20 requests; 500 total tokens' });
});
