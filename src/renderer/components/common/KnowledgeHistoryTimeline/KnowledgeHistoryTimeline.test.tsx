// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { KnowledgeHistoryTimeline, type HistoryEvent } from './KnowledgeHistoryTimeline';

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

const DAY = 24 * 3600_000;

describe('KnowledgeHistoryTimeline', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('groups events by day with Today/Yesterday labels, newest day first', () => {
    // Anchor at local noon: ±26h offsets always land on distinct calendar
    // days, no matter what wall-clock time the suite runs at.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    const events: KnowledgeEvent[] = [
      { t: now - DAY - 60_000, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'good' },
      { t: now - 3600_000, kind: 'claim', source: 'manual', aspect: 'meaning', fromStatus: 'learning', toStatus: 'known' },
      { t: now - DAY, kind: 'review', source: 'anki', aspect: 'meaning', rating: 'easy' },
    ];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events as HistoryEvent[]} />, container);

    const days = Array.from(container.querySelectorAll('.knowledge-timeline__day-label')).map((el) => el.textContent);
    expect(days).toEqual(['mlearn.Knowledge.History.Today', 'mlearn.Knowledge.History.Yesterday']);

    const today = container.querySelectorAll('.knowledge-timeline__day')[0];
    expect(today?.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    expect(today?.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(today?.textContent).toContain('mlearn.WordHover.Status.Known');

    dispose();
  });

  it('aggregates repetitive same-outcome rows behind one count and expands to individual events', () => {
    // Anchor at local noon: the -1/-2/-3h offsets must stay on one calendar
    // day (raw Date.now() splits them across midnight when the suite runs in
    // the first three hours after 00:00, breaking the single-day aggregation).
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    const events: KnowledgeEvent[] = [
      { t: now - 3600_000, kind: 'status', source: 'anki', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' },
      { t: now - 7200_000, kind: 'status', source: 'anki', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' },
      { t: now - 10_800_000, kind: 'status', source: 'anki', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' },
    ];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events as HistoryEvent[]} />, container);

    // One summary row, not three raw log lines.
    expect(container.querySelectorAll('.knowledge-timeline__summary')).toHaveLength(1);
    expect(container.querySelector('.knowledge-timeline__summary')?.textContent).toContain('mlearn.Knowledge.History.Times');
    expect(container.querySelectorAll('.knowledge-timeline__events li')).toHaveLength(0);

    (container.querySelector('.knowledge-timeline__summary') as HTMLButtonElement).click();
    const expanded = container.querySelectorAll('.knowledge-timeline__events li');
    expect(expanded).toHaveLength(3);

    dispose();
  });

  it('renders a claim as the user statement, distinct from evidence rows', () => {
    const now = Date.now();
    const events: KnowledgeEvent[] = [
      { t: now - 3600_000, kind: 'claim', source: 'manual', aspect: 'meaning', fromStatus: 'learning', toStatus: 'known' },
      { t: now - 7200_000, kind: 'review', source: 'anki', aspect: 'meaning', rating: 'easy' },
    ];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events as HistoryEvent[]} />, container);

    const claimRow = container.querySelector('.knowledge-timeline__entry--claim');
    expect(claimRow?.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    const reviewRow = container.querySelector('.knowledge-timeline__entry--review');
    expect(reviewRow?.textContent).toContain('mlearn.Knowledge.History.Source.Anki');

    dispose();
  });

  it('keeps different outcomes in separate rows even within one day', () => {
    const now = Date.now();
    const events: KnowledgeEvent[] = [
      { t: now - 3600_000, kind: 'rating', source: 'srs', aspect: 'reading', quality: 'fluent' },
      { t: now - 7200_000, kind: 'rating', source: 'srs', aspect: 'reading', quality: 'struggled' },
    ];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events as HistoryEvent[]} />, container);

    // Distinct outcomes stay separate single rows (aggregation only merges identical ones).
    expect(container.querySelectorAll('.knowledge-timeline__event')).toHaveLength(2);
    expect(container.textContent).toContain('mlearn.Rating.Matrix.Fluent');
    expect(container.textContent).toContain('mlearn.Rating.Matrix.Struggled');

    dispose();
  });

  it('labels historical Anki scheduler snapshots without presenting a measured status transition', () => {
    const events: HistoryEvent[] = [{ t: Date.now(), kind: 'status', source: 'anki', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' }];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events} />, container);
    expect(container.textContent).toContain('mlearn.Knowledge.History.Kind.SourceSnapshot');
    expect(container.textContent).not.toContain('mlearn.Knowledge.History.Kind.Status');
    expect(container.textContent).not.toContain('→');
    expect(container.textContent).not.toContain('mlearn.WordHover.Status.Unknown');
    expect(container.textContent).toContain('mlearn.WordHover.Status.Known');
    dispose();
  });

  it('prioritizes measured outcomes over accompanying projected status changes', () => {
    const events: HistoryEvent[] = [
      { t: Date.now(), kind: 'rating', source: 'srs', aspect: 'meaning', quality: 'missed', fromStatus: 'unknown', toStatus: 'known' },
      { t: Date.now(), kind: 'review', source: 'anki', aspect: 'reading', rating: 'hard', fromStatus: 'unknown', toStatus: 'known' },
    ];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events} />, container);
    expect(container.textContent).toContain('mlearn.Rating.Matrix.Missed');
    expect(container.textContent).toContain('hard');
    expect(container.textContent).not.toContain('→');
    expect(container.textContent).not.toContain('mlearn.WordHover.Status.Known');
    dispose();
  });

  it('preserves unknown package capability identity in history', () => {
    const events: HistoryEvent[] = [{
      t: Date.now(), kind: 'rating', source: 'srs', quality: 'fluent',
      targetRef: { kind: 'entry', id: 'pkg-entry', capability: 'x-package::unknown-feature' },
    }];
    const dispose = render(() => <KnowledgeHistoryTimeline events={events} />, container);
    expect(container.textContent).toContain('x-package::unknown-feature');
    expect(container.textContent).not.toContain('undefined');
    dispose();
  });

  it('renders nothing when there are no events', () => {
    const dispose = render(() => <KnowledgeHistoryTimeline events={[]} />, container);
    expect(container.querySelector('.knowledge-timeline')).toBeNull();
    dispose();
  });
});
