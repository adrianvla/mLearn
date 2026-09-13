import { describe, expect, it } from 'vitest';
import { assembleTargetExplanation } from '../../shared/graph/explanations';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { effectiveStateFromEntry } from '../../shared/knowledge/effectiveKnowledge';
import { knowledgeTrajectoryData } from '../components/common/KnowledgeProjection/knowledgeTrajectoryData';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const policy = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 };
const thresholds = { learning: DEFAULT_SETTINGS.easeThresholdLearning, known: DEFAULT_SETTINGS.easeThresholdKnown };

describe('graph, renderer and trajectory epistemic parity', () => {
  it('classifies active ease 1.4 as Unknown in all three consumers', () => {
    const events: KnowledgeEvent[] = [{ t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 1.4 }];
    const graph = assembleTargetExplanation('sense-recognition', events, policy, 2);
    const renderer = effectiveStateFromEntry({ ...graph.projection!, word: 'sample' }, thresholds);
    expect(renderer.status).toBe('unknown');
    expect(renderer.basis).toBe('evidence');
    expect(graph.state).toBe('unknown');
    expect(knowledgeTrajectoryData(events, [], 'sense-recognition').points[0].state).toBe('unknown');
  });
});

function assertState(events: KnowledgeEvent[], expected: 'unmeasured' | 'unknown' | 'learning' | 'known',
  configured = thresholds, basis: 'unmeasured' | 'claim' | 'evidence' = expected === 'unmeasured' ? 'unmeasured' : 'evidence') {
  const graph = assembleTargetExplanation('sense-recognition', events, policy, 100, undefined, undefined, undefined, configured);
  const renderer = effectiveStateFromEntry(graph.projection ?? undefined, configured);
  const trajectory = knowledgeTrajectoryData(events, [], 'sense-recognition', configured);
  expect(renderer.status).toBe(expected === 'unmeasured' ? 'unknown' : expected);
  expect(renderer.basis).toBe(basis);
  const graphLabel = basis === 'claim' ? `claimed-${expected}` : expected === 'known' ? 'evidence-backed-known' : expected;
  expect(graph.state).toBe(graphLabel);
  if (trajectory.points.length) expect(trajectory.points.at(-1)?.state).toBe(expected);
  return graph;
}
const rating = (ease: number): KnowledgeEvent => ({ t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: ease });

describe.each([
  ['defaults', thresholds],
  ['configured', { learning: 2.1, known: 2.7 }],
] as const)('%s thresholds', (_label, configured) => {
  it.each([
    [configured.learning - 0.000001, 'unknown'],
    [configured.learning, 'learning'],
    [configured.learning + 0.000001, 'learning'],
    [configured.known - 0.000001, 'learning'],
    [configured.known, 'known'],
    [configured.known + 0.000001, 'known'],
  ] as const)('classifies ease %s as %s without changing its evidence value', (ease, expected) => {
    expect(assertState([rating(ease)], expected, configured).projection?.ease).toBe(ease);
  });

  it('keeps passive-only familiarity unmeasured even above Known', () => {
    const passive: KnowledgeEvent = { ...rating(configured.known + 1), kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 4 };
    const result = assertState([passive], 'unmeasured', configured);
    expect(result.projection?.timesSeen).toBe(4);
    expect(result.projection?.ease).toBe(configured.known + 1);
  });

  it.each(['unknown', 'learning', 'known'] as const)('honors an explicit %s claim without altering evidence', status => {
    const result = assertState([rating(configured.known), { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: status }], status, configured, 'claim');
    expect(result.projection?.ease).toBe(configured.known);
  });

  it('keeps a claim-only Unknown measured and restores Unmeasured when cleared', () => {
    const claim: KnowledgeEvent = { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'unknown' };
    assertState([claim], 'unknown', configured, 'claim');
    assertState([claim, { ...claim, t: 2, toStatus: undefined }], 'unmeasured', configured);
  });

  it('restores canonical evidence classification when a claim is cleared', () => {
    assertState([rating(configured.learning),
      { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
      { t: 3, kind: 'claim', source: 'manual', aspect: 'meaning' },
    ], 'learning', configured);
  });

  it('does not measure a scaffold-supplied attempt or a retracted attempt', () => {
    assertState([{ ...rating(configured.known), scaffolds: { translation: true } }], 'unmeasured', configured);
    assertState([{ ...rating(configured.known), attemptId: 'undone' },
      { t: 2, kind: 'retraction', source: 'manual', retracts: 'undone' },
    ], 'unmeasured', configured);
  });
});

it('changing epistemic thresholds leaves replay and retention identical', () => {
  const events: KnowledgeEvent[] = [{ ...rating(1.8), kind: 'review', source: 'srs', rating: 'good' }];
  const defaults = assembleTargetExplanation('sense-recognition', events, policy, 100);
  const configured = assembleTargetExplanation('sense-recognition', events, policy, 100, undefined, undefined, undefined, { learning: 2.1, known: 2.7 });
  expect(defaults.state).toBe('evidence-backed-known');
  expect(configured.state).toBe('unknown');
  expect(configured.projection).toEqual(defaults.projection);
  expect(configured.evidence).toEqual(defaults.evidence);
  expect(defaults.retention).not.toBeNull();
  expect(configured.retention).toEqual(defaults.retention);
});
