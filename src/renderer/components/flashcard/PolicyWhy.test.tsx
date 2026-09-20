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
    why: 'due for review (3 days overdue)',
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
  it('shows the decision\'s own brief reason by default; the toggle reveals the emitted trace verbatim', async () => {
    const harness = mount(decision);
    expect(harness.container.querySelector('[data-testid="policy-why-brief"]')?.textContent).toBe('due for review (3 days overdue)');
    // Default UX is brief: no calculation math until the learner asks.
    expect(harness.container.querySelector('[data-testid="policy-why-details"]')).toBeNull();

    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    const details = harness.container.querySelector('[data-testid="policy-why-details"]');
    expect(details).toBeTruthy();
    // Same computation, rendered verbatim: version, effective weights (with
    // the rule's arithmetic), ranking (selected first) with per-dimension
    // contributions, exclusions, and the honesty limits.
    expect(details!.textContent).toContain('policy-trace-v3');
    expect(details!.textContent).toContain('TEACH');
    expect(details!.textContent).toContain('deadline-novelty-discount');
    expect(details!.textContent).toContain('open horizon: no deadline weighting');
    expect(details!.textContent).toContain('card-a');
    expect(details!.textContent).toContain('retention');
    // Trace/result agreement in the VIEW: the selected row renders first.
    const rows = Array.from(details!.querySelectorAll('.policy-why__rank')) as HTMLElement[];
    expect(rows[0].getAttribute('data-key')).toBe('card-a');
    expect(rows[0].getAttribute('data-selected')).toBe('true');
    // Exclusions and limits surface (bounded, with omitted counts).
    expect(details!.textContent).toContain('card-c');
    expect(details!.textContent).toContain('on probe cooldown');
    expect(details!.textContent).toContain('+1');
    expect(details!.textContent).toContain('Selection weights are heuristics, not validated probabilities.');
    // The decision's carried metadata renders verbatim (scalar provenance).
    expect(details!.textContent).toContain('dueDate');
    expect(details!.textContent).toContain('999000');

    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    expect(harness.container.querySelector('[data-testid="policy-why-details"]')).toBeNull();
    harness.remove();
  });

  it('stays honest when no trace was emitted: the brief reason stands, the gap is named', async () => {
    const noTrace: PolicyDecision = { ...decision, trace: undefined };
    const harness = mount(noTrace);
    expect(harness.container.querySelector('[data-testid="policy-why-brief"]')?.textContent).toBe('due for review (3 days overdue)');
    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    expect(harness.container.querySelector('[data-testid="policy-why-no-trace"]')).toBeTruthy();
    // No invented math: no ranking section can appear without a trace.
    expect(harness.container.querySelector('.policy-why__rank')).toBeNull();
    harness.remove();
  });

  it('renders nothing without a decision (completion screens, null memos)', () => {
    const harness = mount(null);
    expect(harness.container.querySelector('[data-testid="policy-why"]')).toBeNull();
    harness.remove();
  });

  it('renders carried metadata verbatim, including string provenance like curriculum patterns', async () => {
    const withPatternMeta: PolicyDecision = {
      ...decision,
      trace: {
        ...trace,
        ranking: [
          { ...trace.ranking[0], meta: { pattern: 'weil', category: 'reasons', contentVersion: '2026.09' } },
          ...trace.ranking.slice(1),
        ],
      },
    };
    const harness = mount(withPatternMeta);
    (harness.container.querySelector('[data-testid="policy-why-toggle"]') as HTMLButtonElement).click();
    await tick();
    const details = harness.container.querySelector('[data-testid="policy-why-details"]');
    expect(details!.textContent).toContain('weil');
    expect(details!.textContent).toContain('reasons');
    expect(details!.textContent).toContain('2026.09');
    harness.remove();
  });
});
