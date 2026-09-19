import { describe, expect, it } from 'vitest';
import { DiagnosticSession, type DiagnosticCategory } from './diagnosticSampling';

const CATEGORIES: DiagnosticCategory[] = [
  { id: '1', label: 'Level 1', items: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] },
  { id: '2', label: 'Level 2', items: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] },
  { id: '3', label: 'Level 3', items: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] },
];

function driven(session: DiagnosticSession, outcomes: Array<'fluent' | 'struggled' | 'missed'>): string[] {
  const picked: string[] = [];
  for (const quality of outcomes) {
    const pick = session.pick();
    if (pick === null) break;
    picked.push(pick.key);
    expect(session.record(pick.key, quality)).toBe(true);
  }
  return picked;
}

describe('DiagnosticSession', () => {
  it('draws a balanced first pass: every category once before any second draw (harder bands probed first)', () => {
    const session = new DiagnosticSession(CATEGORIES);
    expect(driven(session, ['fluent', 'fluent', 'fluent'])).toEqual(['c1', 'b1', 'a1']);
  });

  it('marks a category secure after the streak and bypasses it afterwards', () => {
    const session = new DiagnosticSession(CATEGORIES);
    // Round robin fills every category once (harder bands first), then level 3
    // completes its streak and secures; nothing else can raise placement.
    const picked = driven(session, ['fluent', 'fluent', 'fluent', 'fluent', 'fluent', 'fluent', 'fluent']);
    expect(picked).toEqual(['c1', 'b1', 'a1', 'c2', 'b2', 'a2', 'c3']);
    const result = session.result();
    expect(result.categories[2]).toMatchObject({ status: 'secure', sampled: 3, hits: 3 });
    expect(result.placement).toEqual({ categoryId: '3', label: 'Level 3' });
    expect(session.isComplete()).toBe(true);
  });

  it('expands around gaps before returning to balanced draws', () => {
    const session = new DiagnosticSession(CATEGORIES);
    // b1 missed twice → level 2 is a gap; expansion keeps drawing from it.
    const picked = driven(session, ['fluent', 'missed', 'fluent', 'struggled']);
    expect(picked).toEqual(['c1', 'b1', 'b2', 'b3']);
    const result = session.result();
    expect(result.categories[1]).toMatchObject({ status: 'gap', misses: 2 });
    expect(result.placement).toBeNull();
  });

  it('stops with a stable placement while undecided lower categories remain', () => {
    const categories: DiagnosticCategory[] = [
      { id: '1', label: 'Low', items: ['l1', 'l2', 'l3', 'l4'] },
      { id: '2', label: 'High', items: ['h1', 'h2', 'h3', 'h4'] },
    ];
    const session = new DiagnosticSession(categories);
    // h1,h2,h3 fluent → High secure; Low still undecided but below placement.
    driven(session, ['fluent', 'fluent', 'fluent', 'fluent', 'fluent']);
    expect(session.isComplete()).toBe(true);
    const result = session.result();
    expect(result.reason).toBe('stable');
    expect(result.placement).toEqual({ categoryId: '2', label: 'High' });
    expect(result.categories[0]).toMatchObject({ status: 'undecided', sampled: 2 });
  });

  it('lets an underconfident learner move ahead: placement reaches the top band and stops early', () => {
    const categories: DiagnosticCategory[] = [
      { id: '1', label: 'A2', items: ['p1', 'p2', 'p3'] },
      { id: '2', label: 'B1', items: ['q1', 'q2', 'q3'] },
      { id: '3', label: 'B2', items: ['r1', 'r2', 'r3'] },
      { id: '4', label: 'C1', items: ['s1', 's2', 's3'] },
    ];
    const session = new DiagnosticSession(categories);
    // Everything fluent: the top band secures first (harder-first ties), so
    // the learner who feared they were A2 demonstrably belongs in C1.
    const picked = driven(session, Array.from({ length: 12 }, () => 'fluent' as const));
    expect(picked).toHaveLength(9);
    const result = session.result();
    expect(result.reason).toBe('stable');
    expect(result.placement).toEqual({ categoryId: '4', label: 'C1' });
    expect(result.sampledCount).toBe(9);
  });

  it('respects the global budget and reports it honestly', () => {
    const session = new DiagnosticSession(CATEGORIES, { maxTotal: 4 });
    const picked = driven(session, ['missed', 'missed', 'missed', 'missed', 'missed']);
    expect(picked).toHaveLength(4);
    expect(session.result().reason).toBe('budget');
  });

  it('never re-draws a sampled key and rejects stale or unknown submissions', () => {
    const session = new DiagnosticSession(CATEGORIES);
    const first = session.pick()!;
    expect(session.record('unknown-key', 'fluent')).toBe(false);
    expect(session.record('a1', 'fluent')).toBe(false); // not the pending pick
    expect(session.record(first.key, 'fluent')).toBe(true);
    const keys = new Set<string>([first.key]);
    for (let i = 0; i < 20; i += 1) {
      const pick = session.pick();
      if (pick === null) break;
      expect(keys.has(pick.key)).toBe(false);
      keys.add(pick.key);
      session.record(pick.key, 'missed');
    }
    expect(session.result().sampledCount).toBe(keys.size);
  });

  it('counts struggled as a miss: a struggled retrieval is not a fluent one', () => {
    const session = new DiagnosticSession([{ id: '1', label: 'L', items: ['x1', 'x2'] }]);
    driven(session, ['struggled', 'struggled']);
    expect(session.result().categories[0]).toMatchObject({ status: 'gap', misses: 2, hits: 0 });
  });

  it('reports an empty result when every pool is empty (G04: no fabricated recommendation)', () => {
    const session = new DiagnosticSession([
      { id: '1', label: 'L1', items: [] },
      { id: '2', label: 'L2', items: [] },
    ]);
    expect(session.pick()).toBeNull();
    const result = session.result();
    expect(result.reason).toBe('empty');
    expect(result.placement).toBeNull();
    expect(result.sampledCount).toBe(0);
  });

  it('finishes all-decided when the top band secures and the lower bands gap out', () => {
    const session = new DiagnosticSession(CATEGORIES);
    driven(session, [
      'fluent', 'fluent', 'fluent', 'fluent',   // first round (c1,b1,a1) + c2
      'missed', 'missed',                       // level 2 gap (b2,b3)
      'missed', 'missed',                       // level 1 gap (a2,a3)
      'fluent',                                 // level 3 completes its streak (c3)
    ]);
    expect(session.isComplete()).toBe(true);
    const result = session.result();
    expect(result.reason).toBe('all-decided');
    expect(result.placement).toEqual({ categoryId: '3', label: 'Level 3' });
    expect(result.categories.map((category) => category.status)).toEqual(['gap', 'gap', 'secure']);
  });
});

describe('DiagnosticSession skip (G04)', () => {
  it('advances past a skipped pick without recording evidence and rebalances to the untouched category', () => {
    const session = new DiagnosticSession(CATEGORIES);
    const first = session.pick()!;
    expect(session.skip('a1')).toBe(false);           // not the pending pick
    expect(session.skip(first.key)).toBe(true);
    expect(session.result().sampledCount).toBe(0);    // a skip is not evidence
    const second = session.pick()!;
    // The skipped draw consumed the category's attention share: balance now
    // goes to the untouched band instead of redrawing the same band.
    expect(second.key).toBe('b1');
    // The skipped key never returns for the rest of the session.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const pick = session.pick();
      if (pick === null) break;
      expect(seen.has(pick.key)).toBe(false);
      seen.add(pick.key);
      session.record(pick.key, 'fluent');
    }
    expect(seen.has(first.key)).toBe(false);
  });

  it('shows skipped items per category in the trace', () => {
    const session = new DiagnosticSession(CATEGORIES);
    session.skip(session.pick()!.key); // c1 skipped
    driven(session, ['fluent', 'fluent']); // balance sends the draws to b1 and a1
    const top = session.result().categories[2]!;
    expect(top).toMatchObject({ categoryId: '3', sampled: 0, skipped: 1, hits: 0 });
  });

  it('keeps going when draws are skipped instead of stopping early', () => {
    const session = new DiagnosticSession([
      { id: '1', label: 'Skipped', items: ['a1', 'a2', 'a3', 'a4'] },
      { id: '2', label: 'Real', items: ['b1', 'b2', 'b3', 'b4'] },
    ]);
    session.skip(session.pick()!.key); // b1 (hardest band first)
    session.skip(session.pick()!.key); // a1
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      const pick = session.pick();
      if (pick === null) break;
      seen.push(pick.key);
      session.record(pick.key, 'fluent');
    }
    // The session continues past the skips; the Real band secures and stops
    // the session with a recommendation (nothing undecided above it).
    expect(seen).toEqual(['b2', 'a2', 'b3', 'a3', 'b4']);
    const result = session.result();
    expect(result.placement).toEqual({ categoryId: '2', label: 'Real' });
    expect(result.categories[1]).toMatchObject({ sampled: 3, skipped: 1, hits: 3, status: 'secure' });
    expect(result.categories[0]).toMatchObject({ sampled: 2, skipped: 1 });
  });
});
