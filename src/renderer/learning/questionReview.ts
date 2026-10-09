import type { GrammarItemSemanticValidation, LanguageData } from '../../shared/types';
import { questionObjectiveHash, questionSourceHash } from '../../shared/questionReviewCompatibility';
import { hashWordSync } from '../../shared/utils/wordHash';
import { assembleContrastItem, itemContentVersion, validateAssembledItem, legacyQuestionReviewSeed } from './questionBank';

export const QUESTION_REVIEW_PROTOCOL = 'mlearn-blind-review@1';

export interface QuestionReviewPayload {
  protocol: typeof QUESTION_REVIEW_PROTOCOL;
  /** Opaque binding: source IDs, objective names and original sentences can reveal the gold. */
  binding: string;
  items: Array<{ id: string; language: string; conditions: readonly string[]; register?: string;
    prompt: string; alternatives: string[]; formats: readonly string[] }>;
}

export interface QuestionReviewJudgment {
  id: string;
  natural: boolean;
  objectiveAligned: boolean;
  legitimateAnswers: string[];
  distractorsMeaningful: boolean;
  accidentalClues: boolean;
  reasons: string[];
}

function sourcesOf(data: LanguageData) {
  return (data.grammar ?? []).flatMap(point => (point.items ?? []).map(source => ({ pattern: point.pattern, source })));
}

/** Freeze this payload before opening a fresh teacher/model context. No answer key crosses this boundary. */
export function exportQuestionReview(language: string, data: LanguageData): QuestionReviewPayload {
  const sources = sourcesOf(data);
  return {
    protocol: QUESTION_REVIEW_PROTOCOL,
    binding: hashWordSync(JSON.stringify([language, data.languageData?.version, sources.map(({ pattern, source }) => [pattern, itemContentVersion(source)])])),
    items: sources.map(({ pattern, source }, index) => {
      const item = assembleContrastItem(source, { language, pattern, contentVersion: data.languageData?.version, seed: legacyQuestionReviewSeed(language, source.id, data.languageData?.version ?? '') });
      if (validateAssembledItem(item, source).status !== 'passed') throw new Error(`invalid-review-source:${index}`);
      return { id: `item-${index + 1}`, language, conditions: source.conditions,
        ...(source.register === undefined ? {} : { register: source.register }),
        prompt: item.prompt.slice(0, item.gap.start) + '［　］' + item.prompt.slice(item.gap.end),
        alternatives: item.options.map(option => option.text), formats: source.formats ?? ['mcq'] };
    }),
  };
}

function parseReview(raw: unknown): { reviewer: string; reviewerVersion: string; at: string; items: QuestionReviewJudgment[] } {
  if (!raw || typeof raw !== 'object') throw new Error('malformed-review');
  const value = raw as Record<string, unknown>;
  if (value.protocol !== QUESTION_REVIEW_PROTOCOL || typeof value.reviewer !== 'string' || !value.reviewer.trim()
    || typeof value.reviewerVersion !== 'string' || !value.reviewerVersion.trim()
    || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || !Array.isArray(value.items)) throw new Error('missing-review-provenance');
  for (const row of value.items) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string'
      || !['natural', 'objectiveAligned', 'distractorsMeaningful', 'accidentalClues'].every(key => typeof row[key] === 'boolean')
      || !Array.isArray(row.legitimateAnswers) || !row.legitimateAnswers.every((answer: unknown) => typeof answer === 'string' && answer.trim())
      || !Array.isArray(row.reasons) || row.reasons.length === 0 || !row.reasons.every((reason: unknown) => typeof reason === 'string' && reason.trim())) throw new Error('malformed-review-judgment');
  }
  return value as unknown as ReturnType<typeof parseReview>;
}

/** Import an actually executed independent review; never a preassigned status or completion impersonation. */
export function importQuestionReview(language: string, data: LanguageData, frozen: QuestionReviewPayload, raw: unknown): LanguageData {
  const expected = exportQuestionReview(language, data);
  if (JSON.stringify(frozen) !== JSON.stringify(expected)) throw new Error('stale-review-payload');
  const review = parseReview(raw);
  if ((raw as { payloadBinding?: unknown }).payloadBinding !== frozen.binding) throw new Error('review-binding-mismatch');
  const byId = new Map(review.items.map(item => [item.id, item]));
  if (review.items.length !== frozen.items.length || byId.size !== frozen.items.length
    || frozen.items.some(item => !byId.has(item.id))) throw new Error('incomplete-review');
  let index = 0;
  const normalize = (answers: readonly string[]) => new Set(answers.map(answer => answer.normalize('NFC').trim()));
  return { ...data, grammar: data.grammar?.map(point => ({ ...point, items: point.items?.map(source => {
    const judgment = byId.get(`item-${++index}`)!;
    const declared = normalize([source.answerSpan, ...(source.accepts ?? [])]);
    const actual = normalize(judgment.legitimateAnswers);
    const matches = actual.size === declared.size && [...declared].every(answer => actual.has(answer));
    const semantic: GrammarItemSemanticValidation = {
      status: judgment.natural && judgment.objectiveAligned && judgment.distractorsMeaningful && !judgment.accidentalClues && matches ? 'passed' : 'rejected',
      validator: review.reviewer, validatorVersion: review.reviewerVersion, at: review.at,
      protocol: QUESTION_REVIEW_PROTOCOL, contentHash: itemContentVersion(source),
      scope: { language, pattern: point.pattern, packageVersion: data.languageData?.version ?? '' },
      legitimateAnswers: judgment.legitimateAnswers, reasons: judgment.reasons,
      compatibility: { protocol: 'question-review-continuity@1', reviewProtocol: QUESTION_REVIEW_PROTOCOL,
        contentHash: itemContentVersion(source), taskHash: questionSourceHash(source), objectiveHash: questionObjectiveHash(point),
        reviewPayloadHash: hashWordSync(JSON.stringify(frozen)), reviewResultHash: hashWordSync(JSON.stringify(raw)) },
    };
    return { ...source, validation: { ...source.validation, semantic } };
  }) })) };
}
