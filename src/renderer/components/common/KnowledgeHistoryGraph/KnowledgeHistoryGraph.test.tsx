// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { HistoryCurvePoint, SourceReignBand } from '../../../utils/knowledgeHistory';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { CapabilityKind } from '../../../../shared/graph/types';
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

const archivedPoints = [
  { t: 100, strength: 0.3, encounters: 12 },
  { t: 200, strength: 0.6, encounters: 8 },
];

const renderGraph = (
  overrides: Partial<Parameters<typeof KnowledgeHistoryGraph>[0]> = {},
) => {
  const onCapabilityChange = vi.fn();
  const dispose = render(
    () => (
      <KnowledgeHistoryGraph
        points={overrides.points ?? points}
        bands={overrides.bands ?? bands}
        capability={overrides.capability ?? 'sense-recognition'}
        availableCapabilities={overrides.availableCapabilities ?? (['sense-recognition', 'surface-reading'] as const)}
        onCapabilityChange={overrides.onCapabilityChange ?? onCapabilityChange}
        mode={overrides.mode ?? 'full'}
        now={overrides.now ?? 4000}
        firstSeen={overrides.firstSeen}
        archivedPoints={overrides.archivedPoints ?? []}
      />
    ),
    container,
  );
  return { dispose, onCapabilityChange, container };
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

  it('shows only availableCapabilities as tabs and reports clicks', () => {
    const { onCapabilityChange } = renderGraph({
      availableCapabilities: ['sense-recognition', 'prosodic-pattern'] as CapabilityKind[],
    });
    const tabs = container.querySelectorAll('.khistory-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe('mlearn.Knowledge.Capability.sense-recognition');
    expect(tabs[1].textContent).toBe('mlearn.Knowledge.Capability.prosodic-pattern');
    expect(container.querySelector('.khistory-tab-active')!.textContent).toBe('mlearn.Knowledge.Capability.sense-recognition');
    (tabs[1] as HTMLButtonElement).click();
    expect(onCapabilityChange).toHaveBeenCalledWith('prosodic-pattern');
  });

  it('renders the localized empty state when there are no points', () => {
    renderGraph({ points: [], bands: [] });
    const empty = container.querySelector('.khistory-empty');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('mlearn.Knowledge.History.Empty');
  });

  it('renders archived LOD dots when no exact points exist', () => {
    const { container } = renderGraph({ points: [], bands: [], archivedPoints, now: 5000 });
    expect(container.querySelectorAll('.khistory-marker-archived').length).toBe(2);
    expect(container.querySelector('.khistory-empty')).toBeNull();
  });

  it('renders archived dots alongside exact points', () => {
    const { container } = renderGraph({ archivedPoints, now: 5000 });
    expect(container.querySelectorAll('.khistory-marker-archived').length).toBe(2);
    expect(container.querySelectorAll('.khistory-marker').length).toBeGreaterThanOrEqual(points.length + archivedPoints.length);
  });
});
