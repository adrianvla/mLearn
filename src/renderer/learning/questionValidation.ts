import type {
  GrammarItemSemanticValidation,
  GrammarPracticeItemSource,
  LanguageData,
  LLMChatMessage,
  Settings,
} from '../../shared/types';
import { streamChat } from '../services/llmProvider';
import { assembleContrastItem, itemContentVersion, validateAssembledItem } from './questionBank';

export const QUESTION_VALIDATION_BATCH_LIMIT = 32;
const STORE_SCHEMA_VERSION = 2;
const storageKey = (language: string): string => `mlearn-question-validations:${language}`;
/** Store key for one validation record: item id NUL item content version NUL owning pattern. */
export const questionValidationRecordKey = (id: string, contentHash: string, pattern: string): string => `${id}\u0000${contentHash}\u0000${pattern}`;
const recordKey = questionValidationRecordKey;

interface StoredValidationEnvelope {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  records: Record<string, GrammarItemSemanticValidation>;
}

interface ValidatorItemResult {
  id: string;
  natural: boolean;
  objectiveAligned: boolean;
  legitimateAnswers: string[];
  distractorsMeaningful: boolean;
  accidentalClues: boolean;
  reasons: string[];
}

export interface QuestionValidationRunResult {
  records: readonly GrammarItemSemanticValidation[];
  cached: number;
  rejectedBeforeLLM: readonly string[];
  errors: readonly string[];
}

export type QuestionValidationCompletion = (messages: readonly LLMChatMessage[]) => Promise<string>;

function isSemanticRecord(value: unknown): value is GrammarItemSemanticValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<GrammarItemSemanticValidation>;
  return (record.status === 'passed' || record.status === 'rejected')
    && typeof record.validator === 'string' && record.validator.length > 0
    && typeof record.at === 'string' && record.at.length > 0
    && typeof record.contentHash === 'string' && record.contentHash.length > 0
    && (record.validatorVersion === undefined || typeof record.validatorVersion === 'string')
    && (record.reasons === undefined || (Array.isArray(record.reasons) && record.reasons.every((reason) => typeof reason === 'string')));
}

export function loadQuestionValidationRecords(
  language: string,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): ReadonlyMap<string, GrammarItemSemanticValidation> {
  const records = new Map<string, GrammarItemSemanticValidation>();
  try {
    const raw = storage?.getItem(storageKey(language));
    if (!raw) return records;
    const parsed = JSON.parse(raw) as Partial<StoredValidationEnvelope>;
    if (parsed.schemaVersion !== STORE_SCHEMA_VERSION || !parsed.records || typeof parsed.records !== 'object') return records;
    for (const [key, value] of Object.entries(parsed.records)) {
      if (isSemanticRecord(value)) records.set(key, value);
    }
  } catch {
    return records;
  }
  return records;
}

function saveQuestionValidationRecords(
  language: string,
  records: ReadonlyMap<string, GrammarItemSemanticValidation>,
  storage: Pick<Storage, 'setItem'> | undefined,
): void {
  if (!storage) return;
  const envelope: StoredValidationEnvelope = {
    schemaVersion: STORE_SCHEMA_VERSION,
    records: Object.fromEntries(records),
  };
  storage.setItem(storageKey(language), JSON.stringify(envelope));
}

/** Applies only records bound to the current item bytes; stale records never ride. */
export function languageDataWithStoredQuestionValidations(
  language: string,
  data: LanguageData,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): LanguageData {
  const records = loadQuestionValidationRecords(language, storage);
  if (records.size === 0 || data.grammar === undefined) return data;
  return {
    ...data,
    grammar: data.grammar.map((point) => ({
      ...point,
      ...(point.items === undefined ? {} : {
        items: point.items.map((source) => {
          const contentHash = itemContentVersion(source);
          const semantic = records.get(recordKey(source.id, contentHash, point.pattern));
          return semantic === undefined ? source : { ...source, validation: { semantic } };
        }),
      }),
    })),
  };
}

function defaultCompletion(messages: readonly LLMChatMessage[], settings: Settings): Promise<string> {
  return new Promise((resolve, reject) => {
    streamChat([...messages], [], {
      onChunk: () => {},
      onToolCall: () => {},
      onDone: resolve,
      onError: (error) => reject(error instanceof Error ? error : new Error(String(error))),
    }, settings, undefined, false);
  });
}

function parseValidatorResults(raw: string): ValidatorItemResult[] | null {
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const results: ValidatorItemResult[] = [];
    for (const value of parsed.items) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const item = value as Partial<ValidatorItemResult>;
      if (typeof item.id !== 'string'
        || typeof item.natural !== 'boolean'
        || typeof item.objectiveAligned !== 'boolean'
        || !Array.isArray(item.legitimateAnswers) || !item.legitimateAnswers.every((answer) => typeof answer === 'string')
        || typeof item.distractorsMeaningful !== 'boolean'
        || typeof item.accidentalClues !== 'boolean'
        || !Array.isArray(item.reasons) || !item.reasons.every((reason) => typeof reason === 'string')) return null;
      results.push(item as ValidatorItemResult);
    }
    return results;
  } catch {
    return null;
  }
}

function sameAnswers(actual: readonly string[], source: GrammarPracticeItemSource): boolean {
  const normalize = (value: string): string => value.normalize('NFC').trim();
  const expected = new Set([source.answerSpan, ...(source.accepts ?? [])].map(normalize));
  const received = new Set(actual.map(normalize));
  return expected.size === received.size && [...expected].every((answer) => received.has(answer));
}

/**
 * Runs independent complete-item validation in bounded batches through the
 * existing unified LLM provider, then persists content-bound records. Cloud
 * execution is opt-in so background validation cannot incur paid calls.
 */
export async function validateQuestionItemsWithLLM(
  language: string,
  data: LanguageData,
  settings: Settings,
  options: {
    completion?: QuestionValidationCompletion;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    allowCloud?: boolean;
    now?: () => string;
  } = {},
): Promise<QuestionValidationRunResult> {
  if (settings.llmProvider === 'cloud' && options.allowCloud !== true) {
    return { records: [], cached: 0, rejectedBeforeLLM: [], errors: ['cloud-validation-requires-explicit-opt-in'] };
  }
  const storage = options.storage ?? globalThis.localStorage;
  const stored = new Map(loadQuestionValidationRecords(language, storage));
  const pending: Array<{ pattern: string; source: GrammarPracticeItemSource }> = [];
  const rejectedBeforeLLM: string[] = [];
  let cached = 0;
  for (const point of data.grammar ?? []) {
    for (const source of point.items ?? []) {
      const contentHash = itemContentVersion(source);
      if (stored.has(recordKey(source.id, contentHash, point.pattern))) {
        cached += 1;
        continue;
      }
      const assembled = assembleContrastItem(source, { language, pattern: point.pattern, contentVersion: data.languageData?.version });
      if (validateAssembledItem(assembled, source).status !== 'passed') {
        rejectedBeforeLLM.push(source.id);
        continue;
      }
      pending.push({ pattern: point.pattern, source });
    }
  }

  const produced: GrammarItemSemanticValidation[] = [];
  const errors: string[] = [];
  const complete = options.completion ?? ((messages) => defaultCompletion(messages, settings));
  const validator = `mlearn-llm:${settings.llmProvider}`;
  const validatorVersion = settings.llmProvider === 'ollama'
    ? settings.ollamaModel
    : settings.llmProvider === 'builtin'
      ? settings.builtinModel
      : undefined;
  for (let start = 0; start < pending.length; start += QUESTION_VALIDATION_BATCH_LIMIT) {
    const batch = pending.slice(start, start + QUESTION_VALIDATION_BATCH_LIMIT);
    const payload = batch.map(({ pattern, source }) => {
      const assembled = assembleContrastItem(source, { language, pattern, contentVersion: data.languageData?.version });
      // Gold-blind view (R12): the validator sees ONLY the delivered item —
      // the seeded alternatives WITHOUT any gold flag and WITHOUT the
      // original context/declared distractor rationales (either would reveal
      // the proposed gold). It derives the legitimate answer set independently;
      // the code compares that derived set against the declared span + accepts.
      return {
        id: source.id,
        target: { language, conditions: source.conditions, register: source.register },
        deliveredPrompt: assembled.prompt,
        alternatives: assembled.options.map((option) => option.text),
      };
    });
    const messages: LLMChatMessage[] = [
      {
        role: 'system',
        content: 'Independently validate language-learning questions. Judge the complete item from what the learner will see, not the author intent. Return strict JSON only.',
      },
      {
        role: 'user',
        content: `For every item, assess naturalness, objective alignment, EVERY legitimate answer (the full set a competent learner could correctly complete the gap with, including accepted variants), whether every alternative outside that set is a meaningful confusion for the declared discrimination (never a trick or punishment), and accidental clues. Return {"items":[{"id":"...","natural":true,"objectiveAligned":true,"legitimateAnswers":["..."],"distractorsMeaningful":true,"accidentalClues":false,"reasons":["..."]}]}. Include exactly one result per id.\n${JSON.stringify(payload)}`,
      },
    ];
    let parsed: ValidatorItemResult[] | null;
    try {
      parsed = parseValidatorResults(await complete(messages));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (parsed === null || parsed.length !== batch.length || new Set(parsed.map((item) => item.id)).size !== batch.length) {
      errors.push('malformed-validator-response');
      continue;
    }
    const byId = new Map(parsed.map((item) => [item.id, item]));
    for (const { pattern, source } of batch) {
      const result = byId.get(source.id);
      if (result === undefined) {
        errors.push(`missing-validator-result:${source.id}`);
        continue;
      }
      const passed = result.natural
        && result.objectiveAligned
        && result.distractorsMeaningful
        && !result.accidentalClues
        && result.reasons.length > 0
        && sameAnswers(result.legitimateAnswers, source);
      const record: GrammarItemSemanticValidation = {
        status: passed ? 'passed' : 'rejected',
        validator,
        ...(validatorVersion ? { validatorVersion } : {}),
        at: options.now?.() ?? new Date().toISOString(),
        contentHash: itemContentVersion(source),
        reasons: result.reasons,
      };
      stored.set(recordKey(source.id, record.contentHash, pattern), record);
      produced.push(record);
    }
    try {
      saveQuestionValidationRecords(language, stored, storage);
    } catch {
      errors.push('validation-store-unavailable');
    }
  }
  return { records: produced, cached, rejectedBeforeLLM, errors };
}
