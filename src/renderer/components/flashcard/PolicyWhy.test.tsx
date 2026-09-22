// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { PolicyWhy } from './PolicyWhy';
import type { PolicyDecision } from '../../learning/types';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

const trace = {
  version: 'policy-trace-v3',
  inputs: {
    nowMs: 1_000_000,
    attentionBudgetRemaining: 5,
    probeBudgetRemaining: 2,
    probeCooldownMs: 60_000,
    deferFloor: 0,
    minRepeatDistance: 3,
    recentPickCount: 1,
    task: 'srs-review',
    candidateCount: 4,
    goal: null,
    intensity: null,
    recentPicks: ['card-b'],
    recentPicksOmitted: 0,
    cooldowns: [],
    cooldownsOmitted: 0,
    rng: { seed: 42, draws: [], drawsOmitted: 0 },
  },
  weights: {
    base: { 'retention-need': 1, novelty: 1 },
    effective: { 'retention-need': 1, novelty: 0.8 },
    rules: [
      { rule: 'deadline-novelty-discount' as const, dimension: 'novelty' as const, multiplier: 0.8, addend: 0, why: 'open horizon: no deadline weighting' },
    ],
  },
  ranking: [
    {
      key: 'card-a',
      origin: 'retention' as const,
      meta: { dueDate: 999_000, ease: 1.7, reviews: 3 },
      contributions: [{ dimension: 'retention-need' as const, score: 2.0, weight: 1, value: 2.0 }],
      total: 2.0,
    },
    {
      key: 'card-b',
      origin: 'weak-target' as const,
      contributions: [{ dimension: 'novelty' as const, score: 1, weight: 0.8, value: 0.8 }],
      total: 0.8,
    },
  ],
  rankingOmitted: 1,
  selectedKey: 'card-a',
  action: 'TEACH' as const,
  exclusions: [{ key: 'card-c', reason: 'on probe cooldown' }],
  exclusionsOmitted: 2,
  limits: ['Selection weights are heuristics, not validated probabilities.'],
};

const decision: PolicyDecision = {
  candidate: {
    key: 'card-a',
    word: 'card-a',
    language: 'de',
    targets: [],
    origin: 'retention',
    scores: { 'retention-need': 2.0 },
  },
  action: 'TEACH',
  encounter: {
    targets: [],
    task: {
      taskTemplateId: 'srs-review',
      inputModality: 'written-form',
      responseModality: 'rating',
      supplied: ['written-form'],
      requested: ['sense-recognition'],
      fluencyRequired: false,
      ratingMode: 'profile',
    },
    scaffolds: [],
    why: 'weighted pick over 225 eligible (seed 42): 29b0dc8f-af22-4690-b44a-46d67fa89591 won with score 0.281136' ,
  },
  trace,
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function mount(decision: PolicyDecision | null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <PolicyWhy decision={decision} />, container);
  return { container, dispose, remove: () => { dispose(); container.remove(); } };
}

describe('PolicyWhy (R20 decision explanation surface)', () => {
  it('shows a learner-facing explanation without exposing the internal policy trace', async () => {
    const harness = mount(decision);
    expect(harness.container.querySelector('[data-testid="policy-why-brief"]')?.textContent).toBe('mlearn.Review.Why.Reasons.retention');
    // Default UX is brief: no calculation math until the learner asks.
    expect(harness.container.querySelector('[data-testid="policy-why-details"]')).toBeNull();

    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    const details = harness.container.querySelector('[data-testid="policy-why-details"]');
    expect(details).toBeTruthy();
    expect(details!.textContent).toContain('mlearn.Review.Why.Explanation');
    expect(details!.textContent).toContain('mlearn.Review.Why.Reasons.retention');
    expect(harness.container.textContent).not.toContain('weighted pick');
    expect(harness.container.textContent).not.toContain('29b0dc8f');
    expect(harness.container.textContent).not.toContain('seed');
    expect(harness.container.textContent).not.toContain('0.281136');
    expect(details!.textContent).not.toContain('policy-trace-v3');
    expect(details!.textContent).not.toContain('deadline-novelty-discount');
    expect(details!.textContent).not.toContain('retention-need');
    expect(details!.textContent).not.toContain('dueDate');

    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    expect(harness.container.querySelector('[data-testid="policy-why-details"]')).toBeNull();
    harness.remove();
  });

  it('shows the same explanation when the internal trace is unavailable', async () => {
    const noTrace: PolicyDecision = { ...decision, trace: undefined };
    const harness = mount(noTrace);
    expect(harness.container.querySelector('[data-testid="policy-why-brief"]')?.textContent).toBe('mlearn.Review.Why.Reasons.retention');
    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    expect(harness.container.querySelector('[data-testid="policy-why-details"]')?.textContent).toContain('mlearn.Review.Why.Explanation');
    expect(harness.container.querySelector('[data-testid="policy-why-no-trace"]')).toBeNull();
    harness.remove();
  });

  it('renders nothing without a decision (completion screens, null memos)', () => {
    const harness = mount(null);
    expect(harness.container.querySelector('[data-testid="policy-why"]')).toBeNull();
    harness.remove();
  });

});
