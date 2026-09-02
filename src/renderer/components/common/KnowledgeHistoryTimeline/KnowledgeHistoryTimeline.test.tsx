// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { KnowledgeHistoryTimeline, type HistoryEvent } from './KnowledgeHistoryTimeline';

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));
const events = (now: number): KnowledgeEvent[] => [
  { t: now - 26 * 3600_000 - 60_000, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'good' },
  { t: now - 3600_000, kind: 'claim', source: 'manual', aspect: 'meaning', fromStatus: 'learning', toStatus: 'known' },
  { t: now - 26 * 3600_000, kind: 'review', source: 'anki', aspect: 'meaning', rating: 'easy' },
];

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
    // Anchor at local noon: ±26h offsets then always land on distinct calendar
    // days, no matter what wall-clock time the suite runs at.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    const dispose = render(
      () => <KnowledgeHistoryTimeline events={events(now) as HistoryEvent[]} />,
      container,
    );

    const days = Array.from(container.querySelectorAll('.knowledge-timeline__day-label'))
      .map((el) => el.textContent);
    expect(days).toEqual(['mlearn.Knowledge.History.Today', 'mlearn.Knowledge.History.Yesterday']);

    const today = container.querySelectorAll('.knowledge-timeline__day')[0];
    expect(today?.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    // Transition detail: aspect → status, drawn from the journal event.
    expect(today?.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(today?.textContent).toContain('mlearn.WordHover.Status.Known');

    dispose();
  });

  it('renders a claim as the user statement, distinct from evidence rows', () => {
    const now = Date.now();
    const dispose = render(
      () => <KnowledgeHistoryTimeline events={events(now) as HistoryEvent[]} />,
      container,
    );

    const claimRow = container.querySelector('.knowledge-timeline__event--claim');
    expect(claimRow?.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    expect(container.querySelector('.knowledge-timeline__event--rating')).not.toBeNull();

    dispose();
  });

  it('renders nothing without events', () => {
    const dispose = render(() => <KnowledgeHistoryTimeline events={[]} />, container);
    expect(container.querySelector('.knowledge-timeline')).toBeNull();
    dispose();
  });
});
