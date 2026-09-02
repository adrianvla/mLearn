import type { Settings } from './types';

export interface ProactiveCandidate {
  id: string;
  participantId: string;
  kind: 'message' | 'call';
  text?: string;
  score: number;
  createdAt: number;
  lastFiredAt?: number;
}

export type Suppression = 'master-switch' | 'opt-out' | 'call-opt-out' | 'quiet-hours' | 'threshold' | 'cooldown' | 'ineligible-participant';

export interface ProactivityDecision {
  kind: 'message' | 'call' | 'nothing';
  candidate?: ProactiveCandidate;
  suppressedBy?: Suppression;
}

export const MESSAGE_SCORE_THRESHOLD = 0.7;
export const CALL_SCORE_THRESHOLD = 0.9;
export const MESSAGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const CALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type QuietHoursSettings = Pick<Settings, 'proactiveQuietHoursEnabled' | 'proactiveQuietHoursStart' | 'proactiveQuietHoursEnd'>;

function minutesSinceMidnight(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function isInQuietHours(settings: QuietHoursSettings, now: number): boolean {
  if (!settings.proactiveQuietHoursEnabled) return false;

  const start = minutesSinceMidnight(settings.proactiveQuietHoursStart);
  const end = minutesSinceMidnight(settings.proactiveQuietHoursEnd);
  if (start === undefined || end === undefined || start === end) return false;

  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function suppressionFor(
  candidate: ProactiveCandidate,
  settings: Settings,
  now: number,
  participantKinds: Record<string, 'persistent' | 'temporary'>,
): Suppression | undefined {
  if (participantKinds[candidate.participantId] === 'temporary') return 'ineligible-participant';
  if (settings.proactiveOptOutParticipantIds.includes(candidate.participantId)) return 'opt-out';
  if (candidate.kind === 'call' && settings.proactiveCallOptOutParticipantIds.includes(candidate.participantId)) return 'call-opt-out';
  if (isInQuietHours(settings, now)) return 'quiet-hours';

  const cooldown = candidate.kind === 'call' ? CALL_COOLDOWN_MS : MESSAGE_COOLDOWN_MS;
  if (candidate.lastFiredAt !== undefined && now - candidate.lastFiredAt < cooldown) return 'cooldown';

  const threshold = candidate.kind === 'call' ? CALL_SCORE_THRESHOLD : MESSAGE_SCORE_THRESHOLD;
  return candidate.score < threshold ? 'threshold' : undefined;
}

export function evaluateProactivity(
  candidates: ProactiveCandidate[],
  settings: Settings,
  opts: { now: number; participantKinds: Record<string, 'persistent' | 'temporary'> },
): ProactivityDecision {
  if (!settings.proactivityEnabled) return { kind: 'nothing', suppressedBy: 'master-switch' };

  let suppressedBy: Suppression | undefined;
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const suppression = suppressionFor(candidate, settings, opts.now, opts.participantKinds);
    if (!suppression) return { kind: candidate.kind, candidate };
    suppressedBy ??= suppression;
  }
  return suppressedBy ? { kind: 'nothing', suppressedBy } : { kind: 'nothing' };
}

export function nextCallEventType(outcome: 'initiated' | 'accepted' | 'declined' | 'missed' | 'ended'): 'call_initiated' | 'call_accepted' | 'call_declined' | 'call_missed' | 'call_ended' {
  return `call_${outcome}`;
}
