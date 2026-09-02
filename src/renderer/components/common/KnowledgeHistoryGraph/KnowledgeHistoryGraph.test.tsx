// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { HistoryCurvePoint, SourceReignBand } from '../../../utils/knowledgeHistory';
import type { KnowledgeEvent, KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { KnowledgeHistoryGraph } from './KnowledgeHistoryGraph';

let container: HTMLDivElement;

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

const makePoint = (
  t: number,
  strength: number,
  source: KnowledgeEvent['source'],
  kind: KnowledgeEvent['kind'],
  overrides: Partial<KnowledgeEvent> = {},
): HistoryCurvePoint => ({
  t,
  strength,
  source,
  kind,
  event: { t, kind, source, aspect: 'meaning', ...overrides },
});

const points: HistoryCurvePoint[] = [
  makePoint(1000, 0.2, 'passiveTracking', 'rollup'),
  makePoint(2000, 0.5, 'srs', 'review', { easeAfter: 2.1, rating: 'good' }),
  makePoint(3000, 1, 'srs', 'status', { toStatus: 'known' }),
];

const bands: SourceReignBand[] = [
  { from: 1000, to: 2000, source: 'passiveTracking' },
  { from: 2000, to: 3000, source: 'srs' },
  { from: 3000, to: 4000, source: 'srs' },
];

const renderGraph = (
  overrides: Partial<Parameters<typeof KnowledgeHistoryGraph>[0]> = {},
) => {
  const onAspectChange = vi.fn();
  const dispose = render(
    () => (
      <KnowledgeHistoryGraph
        points={overrides.points ?? points}
        bands={overrides.bands ?? bands}
        aspect={overrides.aspect ?? 'meaning'}
        availableAspects={overrides.availableAspects ?? (['meaning', 'reading'] as const)}
        onAspectChange={overrides.onAspectChange ?? onAspectChange}
        mode={overrides.mode ?? 'full'}
        now={overrides.now ?? 4000}
        firstSeen={overrides.firstSeen}
      />
    ),
    container,
  );
  return { dispose, onAspectChange };
};

describe('KnowledgeHistoryGraph', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders a step path and one marker per point', () => {
    renderGraph();
    const line = container.querySelector('.khistory-line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('d')).toBeTruthy();
    expect(container.querySelectorAll('.khistory-marker')).toHaveLength(3);
  });

  it('starts the X axis at firstSeen with a zero-strength baseline before the first event', () => {
    const { dispose } = renderGraph({ firstSeen: 500 });
    const line = container.querySelector('.khistory-line')!;
    const segments = line.getAttribute('d')!.trim().split(/\s+/);
    const startY = Number(segments[2]);
    expect(segments[0]).toBe('M');
    expect(segments[3]).toBe('L');
    expect(Number(segments[5])).toBe(startY);
    dispose();
  });

  it('renders one band rect per band with the source class', () => {
    renderGraph();
    const rects = container.querySelectorAll('.khistory-band');
    expect(rects).toHaveLength(3);
    expect(rects[0].classList.contains('khistory-band-passiveTracking')).toBe(true);
    expect(rects[1].classList.contains('khistory-band-srs')).toBe(true);
    expect(rects[2].classList.contains('khistory-band-srs')).toBe(true);
  });

  it('shows only availableAspects as tabs and reports clicks', () => {
    const { onAspectChange } = renderGraph({
      availableAspects: ['meaning', 'prosody'] as KnowledgeAspect[],
    });
    const tabs = container.querySelectorAll('.khistory-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe('mlearn.Knowledge.Aspect.Meaning');
    expect(tabs[1].textContent).toBe('mlearn.Knowledge.Aspect.Prosody');
    expect(container.querySelector('.khistory-tab-active')!.textContent).toBe('mlearn.Knowledge.Aspect.Meaning');
    (tabs[1] as HTMLButtonElement).click();
    expect(onAspectChange).toHaveBeenCalledWith('prosody');
  });

  it('renders the localized empty state when there are no points', () => {
    renderGraph({ points: [], bands: [] });
    const empty = container.querySelector('.khistory-empty');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('mlearn.Knowledge.History.Empty');
  });
});
