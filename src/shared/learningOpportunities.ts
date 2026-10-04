import { readActiveEvidence, type KnowledgeEvent } from './knowledgeEvents';

const BURST_GAP_MS = 30 * 60_000; // Operational episode grouping, not a claim about a learner's calendar.
const RECENT_BURSTS = 20; // Adaptation/memory bound; old habits cannot grow future assumed time indefinitely.
const DAY = 86_400_000;
export interface LearningOpportunities {
  availableSeconds: number[];
  gapDays: number[];
  observedActiveSeconds: number;
  censoredBursts: number;
  interruptions: number;
  priorDriven: boolean;
  limits: string[];
}

/** Native focused response time is a lower bound on engagement, never exact free time. */
export function inferLearningOpportunities(events: readonly KnowledgeEvent[], nowMs: number): LearningOpportunities {
  const seen = new Set<string>();
  const bursts: Array<{ at: number; end: number; seconds: number }> = [];
  let interruptions = 0;
  for (const event of readActiveEvidence(events).filter(event => event.t <= nowMs).sort((a, b) => a.t - b.t)) {
    if (!event.attemptId || seen.has(event.attemptId)) continue;
    seen.add(event.attemptId);
    if (event.interrupted || event.interruptionCount) interruptions++;
    if (event.stalled || event.interrupted || event.interruptionCount || !event.activeLatencyMs
      || !Number.isFinite(event.activeLatencyMs) || event.activeLatencyMs <= 0) continue;
    const seconds = event.activeLatencyMs / 1000;
    const last = bursts.at(-1);
    if (last && event.t - last.end <= BURST_GAP_MS) { last.seconds += seconds; last.end = event.t; }
    else bursts.push({ at: event.t, end: event.t, seconds });
  }
  const recent = bursts.slice(-RECENT_BURSTS);
  // All historical session ends are censored: an app limit or disappearance is not a voluntary stopping time.
  // Bootstrap lower bounds, retaining broad prior headroom. No survival fit without known stop events.
  const priorSeconds = [60, 120, 300]; // Explicit unfitted opportunity prior, sensitivity-tested; never a compulsory schedule.
  const availableSeconds = recent.length ? recent.flatMap(burst => priorSeconds.map(prior => burst.seconds + prior)) : priorSeconds;
  const gapDays = recent.slice(1).map((burst, index) => Math.max(0, (burst.at - recent[index].at) / DAY));
  // Missing current opportunities are right-censored too; include the observed absence, not invented study.
  if (recent.length && nowMs - recent.at(-1)!.end > DAY) gapDays.push((nowMs - recent.at(-1)!.end) / DAY);
  return { availableSeconds, gapDays: gapDays.length ? gapDays : [1, 3, 7],
    observedActiveSeconds: recent.reduce((sum, burst) => sum + burst.seconds, 0), censoredBursts: recent.length, interruptions,
    priorDriven: recent.length < 3,
    limits: ['Observed use is a censored lower bound, not available free time or a calendar.',
      'Session limits and closing/background time never become observed learner stopping times.',
      'Sparse opportunity headroom prior: 60/120/300 seconds; sparse renewal gaps: 1/3/7 days; these are unfitted assumptions.',
      'Only the latest 20 bursts inform manageable work. A 30 minute gap groups episodes operationally.',
      'Chunks stop at a natural boundary of at most 12 encounters; continuation remains available.'] };
}

export function manageableEncounterCount(opportunities: Pick<LearningOpportunities, 'availableSeconds'>, effortSeconds: number): number {
  const sorted = [...opportunities.availableSeconds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 120;
  return Math.max(1, Math.min(12, Math.floor(median / Math.max(1, effortSeconds))));
}
