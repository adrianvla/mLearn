import { describe, expect, it } from 'vitest';
import { summarizeCurriculumComponent, type CurriculumRequirement } from './curriculum';

const req = (level: string | number, label: string, weight?: number): CurriculumRequirement => ({
  component: 'grammar',
  level,
  label,
  target: { entityId: `ja:grammar:${label}`, capability: 'grammar-recognition' },
  ...(weight !== undefined ? { weight } : {}),
});

describe('summarizeCurriculumComponent', () => {
  it('aggregates per bucket on the component scale without merging other scales', () => {
    const summary = summarizeCurriculumComponent(
      'grammar',
      [req(4, 'ている'), req(4, 'ば'), req(3, 'ない'), req(4, 'てしまう')],
      [3, 4, 5],
      (requirement) => (requirement.label === 'ている' ? 'known' : requirement.label === 'ば' ? 'learning' : 'unmeasured'),
    );
    expect(summary.component).toBe('grammar');
    expect(summary.buckets.map((bucket) => bucket.level)).toEqual([3, 4, 5]);
    const level4 = summary.buckets.find((bucket) => bucket.level === 4)!;
    expect(level4).toMatchObject({ total: 3, known: 1, learning: 1, unmeasured: 1 });
    expect(summary).toMatchObject({ total: 4, known: 1, learning: 1, unmeasured: 2, complete: false });
  });

  it('an unmeasured target prevents claiming complete coverage', () => {
    const measured = summarizeCurriculumComponent('grammar', [req(4, 'ば')], [4], () => 'known');
    expect(measured.complete).toBe(true);
    const unmeasured = summarizeCurriculumComponent('grammar', [req(4, 'ば'), req(4, 'ない')], [4], (r) => (r.label === 'ば' ? 'known' : 'unmeasured'));
    expect(unmeasured.complete).toBe(false);
  });

  it('weights scale contributions without changing state counts semantics', () => {
    const summary = summarizeCurriculumComponent(
      'grammar',
      [req(4, 'known-a', 2), req(4, 'unmeasured-b', 3)],
      [4],
      (r) => (r.label === 'known-a' ? 'known' : 'unmeasured'),
    );
    expect(summary.buckets[0]).toMatchObject({ total: 5, known: 2, unmeasured: 3 });
    expect(summary.complete).toBe(false);
  });

  it('reports unknown (measured negative) separately from unmeasured', () => {
    const summary = summarizeCurriculumComponent(
      'grammar',
      [req(4, 'failed'), req(4, 'never-seen')],
      [4],
      (r) => (r.label === 'failed' ? 'unknown' : 'unmeasured'),
    );
    expect(summary.buckets[0]).toMatchObject({ unknown: 1, unmeasured: 1 });
    // Measured negative still leaves the never-seen target unmeasured.
    expect(summary.complete).toBe(false);
  });
});
