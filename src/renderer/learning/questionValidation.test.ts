import { describe, expect, it, vi } from 'vitest';
import type { LanguageData, Settings } from '../../shared/types';
import germanPackage from '../../../scripts/language-data/source/root-of-app/languages/de.json';
import {
  QUESTION_VALIDATION_BATCH_LIMIT,
  languageDataWithStoredQuestionValidations,
  loadQuestionValidationRecords,
  validateQuestionItemsWithLLM,
} from './questionValidation';

const source = {
  id: 'de-obwohl-test',
  context: 'Wir gehen spazieren, obwohl es regnet.',
  answerSpan: 'obwohl',
  conditions: ['concessive-reading'],
  distractors: [
    { span: 'weil', violates: ['concessive-reading'], rationale: 'causal rather than concessive' },
    { span: 'deshalb', violates: ['concessive-reading'], rationale: 'result adverb rather than conjunction' },
  ],
  formats: ['mcq', 'typed'] as const,
};

const data = {
  languageData: { version: 'de-test-v1' },
  grammar: [{ pattern: 'obwohl', level: 1, items: [source] }],
} as unknown as LanguageData;

const settings = {
  llmProvider: 'builtin',
  builtinModel: 'local-test-model.gguf',
  ollamaModel: '',
} as Settings;

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('question semantic validation pipeline', () => {
  it('batches through an independent completion, persists the record, and overlays it on current content', async () => {
    const storage = memoryStorage();
    const completion = vi.fn().mockResolvedValue(JSON.stringify({
      items: [{
        id: source.id,
        natural: true,
        objectiveAligned: true,
        legitimateAnswers: ['obwohl'],
        distractorsMeaningful: true,
        accidentalClues: false,
        reasons: ['natural concessive sentence with one legitimate option'],
      }],
    }));
    const result = await validateQuestionItemsWithLLM('de', data, settings, {
      completion,
      storage,
      now: () => '2026-09-19T01:00:00Z',
    });
    expect(completion).toHaveBeenCalledTimes(1);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([expect.objectContaining({
      status: 'passed',
      validator: 'mlearn-llm:builtin',
      validatorVersion: 'local-test-model.gguf',
      at: '2026-09-19T01:00:00Z',
    })]);
    const overlaid = languageDataWithStoredQuestionValidations('de', data, storage);
    expect(overlaid.grammar?.[0].items?.[0].validation?.semantic).toEqual(result.records[0]);

    const changedRegister = {
      ...data,
      grammar: [{ pattern: 'obwohl', level: 1, items: [{ ...source, register: 'formal written German' }] }],
    } as unknown as LanguageData;
    expect(languageDataWithStoredQuestionValidations('de', changedRegister, storage).grammar?.[0].items?.[0].validation?.semantic)
      .toBeUndefined();

    const cached = await validateQuestionItemsWithLLM('de', data, settings, { completion, storage });
    expect(cached.cached).toBe(1);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it('binds records to the owning pattern and store schema: a remapped item revalidates', async () => {
    const storage = memoryStorage();
    const completion = vi.fn().mockResolvedValue(JSON.stringify({
      items: [{
        id: 'de-obwohl-test',
        natural: true,
        objectiveAligned: true,
        legitimateAnswers: ['obwohl'],
        distractorsMeaningful: true,
        accidentalClues: false,
        reasons: ['clean contrast'],
      }],
    }));
    const first = await validateQuestionItemsWithLLM('de', data, settings, { completion, storage, now: () => '2026-09-19T01:00:00Z' });
    expect(first.records).toHaveLength(1);
    // Same id and content under a DIFFERENT owning pattern: the record must
    // not apply — the target the validator assessed changed (R12/G03). The
    // item is unreviewed again and the producer revalidates it (never cached).
    const remapped = {
      ...data,
      grammar: [{ ...data.grammar![0], pattern: 'konzession-ohne-ausnahme' }],
    } as unknown as LanguageData;
    expect(languageDataWithStoredQuestionValidations('de', remapped, storage).grammar?.[0].items?.[0].validation?.semantic).toBeUndefined();
    const rerun = await validateQuestionItemsWithLLM('de', remapped, settings, { completion, storage });
    expect(rerun.cached).toBe(0);
    expect(rerun.records).toHaveLength(1);
    expect(languageDataWithStoredQuestionValidations('de', remapped, storage).grammar?.[0].items?.[0].validation?.semantic).toEqual(rerun.records[0]);
    // Legacy schema-1 envelopes (pre-pattern-binding keys) never apply.
    expect(loadQuestionValidationRecords('de', { getItem: () => JSON.stringify({ schemaVersion: 1, records: {} }) }).size).toBe(0);
  });

  it('records a rejection when the validator finds ambiguity, without fabricating a pass', async () => {
    const storage = memoryStorage();
    const result = await validateQuestionItemsWithLLM('de', data, settings, {
      storage,
      completion: async () => JSON.stringify({
        items: [{
          id: source.id,
          natural: true,
          objectiveAligned: true,
          legitimateAnswers: ['obwohl', 'weil'],
          distractorsMeaningful: true,
          accidentalClues: false,
          reasons: ['more than one alternative is legitimate'],
        }],
      }),
    });
    expect(result.records[0]?.status).toBe('rejected');
  });

  it('abstains on malformed output and requires explicit opt-in for cloud validation', async () => {
    const storage = memoryStorage();
    const malformed = await validateQuestionItemsWithLLM('de', data, settings, {
      storage,
      completion: async () => 'not-json',
    });
    expect(malformed.records).toEqual([]);
    expect(malformed.errors).toEqual(['malformed-validator-response']);
    expect(languageDataWithStoredQuestionValidations('de', data, storage)).toBe(data);

    const completion = vi.fn();
    const cloud = await validateQuestionItemsWithLLM('de', data, { ...settings, llmProvider: 'cloud' }, {
      storage,
      completion,
    });
    expect(cloud.errors).toEqual(['cloud-validation-requires-explicit-opt-in']);
    expect(completion).not.toHaveBeenCalled();
  });

  it('runs bounded batches of at most 32 items per completion', async () => {
    const storage = memoryStorage();
    const items = Array.from({ length: 40 }, (_, index) => ({
      ...source,
      id: `de-batch-${index}`,
      context: `Wir bleiben zu Hause, obwohl es regnet (${index}).`,
    }));
    const batchData = {
      languageData: { version: 'de-test-v1' },
      grammar: [{ pattern: 'obwohl', level: 1, items }],
    } as unknown as LanguageData;
    const completion = vi.fn(async (messages: readonly [{ content: string }, { content: string }]) => {
      const payload = JSON.parse(messages[1].content.split('\n')[1]) as Array<{ id: string }>;
      return JSON.stringify({
        items: payload.map((entry) => ({
          id: entry.id,
          natural: true,
          objectiveAligned: true,
          legitimateAnswers: ['obwohl'],
          distractorsMeaningful: true,
          accidentalClues: false,
          reasons: ['well-formed concessive item'],
        })),
      });
    });
    const result = await validateQuestionItemsWithLLM('de', batchData, settings, { completion, storage });
    expect(completion).toHaveBeenCalledTimes(2);
    const sizes = completion.mock.calls.map(
      (call) => (JSON.parse(call[0][1].content.split('\n')[1]) as unknown[]).length,
    );
    expect(sizes).toEqual([QUESTION_VALIDATION_BATCH_LIMIT, 8]);
    expect(result.records).toHaveLength(40);
    expect(result.errors).toEqual([]);
  });

  it('skips deterministically-invalid items before any LLM call (rejectedBeforeLLM)', async () => {
    const storage = memoryStorage();
    const ambiguous = {
      ...source,
      id: 'de-broken-1',
      distractors: [{ span: 'weil', violates: [], rationale: 'author gave no declared condition' }],
    };
    const mixedData = {
      languageData: { version: 'de-test-v1' },
      grammar: [{ pattern: 'obwohl', level: 1, items: [source, ambiguous] }],
    } as unknown as LanguageData;
    const completion = vi.fn(async () => JSON.stringify({
      items: [{
        id: source.id,
        natural: true,
        objectiveAligned: true,
        legitimateAnswers: ['obwohl'],
        distractorsMeaningful: true,
        accidentalClues: false,
        reasons: ['fine'],
      }],
    }));
    const result = await validateQuestionItemsWithLLM('de', mixedData, settings, { completion, storage });
    expect(result.rejectedBeforeLLM).toEqual(['de-broken-1']);
    expect(result.records).toHaveLength(1); // only the well-formed item was validated
    expect(JSON.parse(completion.mock.calls[0][0][1].content.split('\n')[1]) as unknown[]).toHaveLength(1);
  });

  it('sends the validator a GOLD-BLIND payload: no proposed pattern, original context, rationales, or answer-span field', async () => {
    const storage = memoryStorage();
    let sent = '';
    const completion = async (messages: readonly [{ content: string }, { content: string }]) => {
      sent = messages.map((message) => message.content).join('\n');
      return JSON.stringify({
        items: [{
          id: source.id,
          natural: true,
          objectiveAligned: true,
          legitimateAnswers: ['obwohl'],
          distractorsMeaningful: true,
          accidentalClues: false,
          reasons: ['derived independently from the delivered item'],
        }],
      });
    };
    await validateQuestionItemsWithLLM('de', data, settings, { completion, storage });
    // R12: the validator assesses independently of the proposed gold answer.
    // Declared rationales or span fields would mark the gold by exclusion.
    expect(sent).not.toContain('distractorRationales');
    expect(sent).not.toContain('rationale');
    expect(sent).not.toContain('answerSpan');
    expect(sent).not.toContain('originalContext');
    expect(sent).not.toContain(source.context);
    const payload = JSON.parse(sent.split('\n').at(-1)!) as Array<{ target: Record<string, unknown> }>;
    expect(payload[0].target).not.toHaveProperty('pattern');
    // The delivered alternatives are all present, without any correctness flag.
    expect(sent).toContain('obwohl');
    expect(sent).toContain('weil');
    expect(sent).toContain('deshalb');
  });

  it('accepts independently derived lowercase answers for every shipped German item', async () => {
    const germanData = germanPackage as unknown as LanguageData;
    const answers = new Map<string, string>();
    for (const point of germanData.grammar ?? []) {
      for (const item of point.items ?? []) {
        expect(item.accepts, item.id).toBeUndefined();
        answers.set(item.id, item.answerSpan);
      }
    }
    const result = await validateQuestionItemsWithLLM('de', germanData, settings, {
      storage: memoryStorage(),
      completion: async (messages) => {
        const payload = JSON.parse(messages[1].content.split('\n')[1]) as Array<{ id: string }>;
        return JSON.stringify({
          items: payload.map(({ id }) => ({
            id,
            natural: true,
            objectiveAligned: true,
            legitimateAnswers: [answers.get(id)],
            distractorsMeaningful: true,
            accidentalClues: false,
            reasons: ['independently derived from the delivered item'],
          })),
        });
      },
    });
    expect(answers.size).toBe(6);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(6);
    expect(result.records.every((record) => record.status === 'passed')).toBe(true);
  });
});
