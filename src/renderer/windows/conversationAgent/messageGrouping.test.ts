import { describe, expect, it } from 'vitest';
import { sameMessageGroup } from './messageGrouping';

describe('messenger message groups', () => {
  const first = { role: 'assistant' as const, actorId: 'person-a', content: 'Hi', timestamp: 1000 };
  it('groups separate nearby messages from the same person', () => {
    expect(sameMessageGroup(first, { ...first, content: 'Are you there?', timestamp: 2000 })).toBe(true);
  });
  it('does not group different people, long gaps, errors or unknown identities', () => {
    expect(sameMessageGroup(first, { ...first, actorId: 'person-b' })).toBe(false);
    expect(sameMessageGroup(first, { ...first, timestamp: 400000 })).toBe(false);
    expect(sameMessageGroup(first, { ...first, isError: true })).toBe(false);
    expect(sameMessageGroup({ ...first, actorId: undefined }, { ...first, actorId: undefined })).toBe(false);
  });
  it('keeps user messages separate from character messages', () => {
    expect(sameMessageGroup(first, { ...first, role: 'user' })).toBe(false);
  });
});
