import type { JournalEvent } from '../../shared/world';

export interface FeedbackAgreement {
  active: boolean;
  scope: string;
  evidence: string;
}

export function parseFeedbackAgreement(value: unknown, sourceText: string): FeedbackAgreement | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.active !== 'boolean' || typeof candidate.scope !== 'string'
    || !candidate.scope.trim() || candidate.scope.length > 2000
    || typeof candidate.evidence !== 'string' || !candidate.evidence.trim()
    || !sourceText.includes(candidate.evidence)) return undefined;
  return { active: candidate.active, scope: candidate.scope, evidence: candidate.evidence };
}

/** Select by the user's source sequence, so delayed checks cannot revive older consent. */
export function currentFeedbackAgreement(events: readonly JournalEvent[], throughEventId?: string): FeedbackAgreement | undefined {
  const throughSequence = throughEventId ? events.find(event => event.id === throughEventId)?.seq ?? -1 : Infinity;
  let newestSource = -1;
  let result: FeedbackAgreement | undefined;
  for (const event of events) {
    if (event.type !== 'feedback.agreement' || event.actorId !== 'harness') continue;
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload || typeof payload.sourceEventId !== 'string') continue;
    const source = events.find(candidate => candidate.id === payload.sourceEventId
      && candidate.type === 'message.user' && candidate.actorId === 'user'
      && candidate.roomId === event.roomId && candidate.scope.kind === event.scope.kind
      && (candidate.scope.kind !== 'thread' || event.scope.kind === 'thread' && candidate.scope.threadId === event.scope.threadId));
    const text = (source?.payload as { text?: unknown } | undefined)?.text;
    if (!source || source.seq > throughSequence || source.seq <= newestSource || typeof text !== 'string') continue;
    const agreement = parseFeedbackAgreement(payload, text);
    if (!agreement) continue;
    newestSource = source.seq; result = agreement;
  }
  return result;
}

export function renderFeedbackAgreement(agreement: FeedbackAgreement | undefined): string {
  return agreement ? `\n\n## Saved feedback agreement\n${JSON.stringify(agreement)}\nThis is the latest recorded user agreement, not a language error or character motive. Honor its scope; an ended agreement forbids correction, including teasing or paraphrasing errors. A new explicit user request can change it. The Practice activity label does not override an exit.` : '';
}
