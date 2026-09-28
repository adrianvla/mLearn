export interface ReviewContextMessage { role: 'user' | 'assistant'; content: string }

export interface TurnReviewRequest {
  operationId: string;
  roomId: string;
  threadId?: string;
  participantId: string;
  sourceEventId?: string;
  userText: string;
  assistantText: string;
  auxiliaryText?: string;
  recent: ReviewContextMessage[];
  repairContext: string;
  language: string;
}

export type ReviewReason = 'none' | 'reference' | 'sexual-interaction' | 'self-harm' | 'dangerous-instructions';
export interface ProductReview {
  decision: 'allow' | 'redirect' | 'support';
  reason: ReviewReason;
  subject: 'user' | 'assistant';
  evidence: string;
}
import type { JournalEvent } from './world';
export type TurnReviewResult =
  | { status: 'approved' | 'replaced'; text: string; reason: ReviewReason; restrictUserContext: boolean; reviewId: string; reviewEvent?: JournalEvent }
  | { status: 'support'; reason: 'self-harm'; restrictUserContext: true; reviewId: string; reviewEvent?: JournalEvent }
  | { status: 'unavailable'; reviewId: string; error: string };

export const REVIEW_LIMITS = { text: 16_000, context: 30_000, recent: 12, recentText: 4_000, auxiliary: 12_000 } as const;
export interface GuardVerdict { safety: 'Safe' | 'Controversial' | 'Unsafe'; categories: string[]; refusal?: 'Yes' | 'No' }
export interface LocalGuardStatus { model: string; installed: boolean; verified: boolean; loaded: boolean; downloading: boolean; progress: number; error?: string }

export function parseGuardVerdict(raw: string): GuardVerdict {
  const safety = /^Safety:\s*(Safe|Controversial|Unsafe)\s*$/m.exec(raw)?.[1] as GuardVerdict['safety'] | undefined;
  const categories = /^Categories:\s*([^\r\n]+)\s*$/m.exec(raw)?.[1]?.split(/,\s*/).map(value => value.trim());
  const refusal = /^Refusal:\s*(Yes|No)\s*$/m.exec(raw)?.[1] as GuardVerdict['refusal'] | undefined;
  if (!safety || !categories?.length || categories.some(value => !value || value.length > 100)) throw new Error('Local guard returned an invalid verdict');
  return { safety, categories, ...(refusal ? { refusal } : {}) };
}

export function parseProductReview(raw: string, userText: string, assistantText: string): ProductReview {
  let parsed: unknown;
  const json = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  try { parsed = JSON.parse(json); } catch { throw new Error('Conversation review returned invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Conversation review returned invalid data');
  const value = parsed as Record<string, unknown>;
  const subject = value.subject === 'learner' ? 'user' : value.subject === 'candidate' ? 'assistant'
    : value.subject === 'none' && value.decision === 'allow' && value.reason === 'none' ? 'user' : value.subject;
  if (!['allow', 'redirect', 'support'].includes(String(value.decision))
    || !['none', 'reference', 'sexual-interaction', 'self-harm', 'dangerous-instructions'].includes(String(value.reason))
    || !['user', 'assistant'].includes(String(subject)) || typeof value.evidence !== 'string') {
    throw new Error('Conversation review returned invalid judgment');
  }
  const review = { ...value, subject } as unknown as ProductReview;
  if (review.decision === 'allow' && (review.reason === 'none' || review.reason === 'reference')) {
    return { ...review, evidence: '' };
  }
  if (!review.evidence || !(review.subject === 'user' ? userText : assistantText).includes(review.evidence)) {
    throw new Error('Conversation review cited no exact current-text evidence');
  }
  if (review.decision === 'support' && (review.reason !== 'self-harm' || review.subject !== 'user')) throw new Error('Invalid support judgment');
  if (review.decision === 'redirect' && review.reason === 'none') throw new Error('Invalid redirect judgment');
  return review;
}
