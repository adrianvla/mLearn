/**
 * ONE executor for a flashcard repair plan. The Repair modal and the Generate
 * tab both run their findings through here, so progress, retry, and failure
 * accounting behave identically no matter which surface started the work.
 *
 * Findings run in dependency order — content, then example sentences, then
 * example translations, then audio — so a card that has just been given a
 * meaning is not also sent to the example generator against nothing, and its
 * audio is not synthesised from a field that is about to change.
 */

import type { LanguageData } from '../../shared/types';
import type { DictionaryTargetSettings } from '../services/wordEnrichment';
import {
  buildContentUpdate,
  type ExampleFinding,
  type RepairFinding,
  type TtsField,
} from './flashcardRepairPlan';

export interface RepairRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Findings that could not be completed, for retry/reporting. */
  remaining: RepairFinding[];
}

/** A pre-generated example patch, or null when the generator produced nothing. */
export type ExampleBatchUpdate = { cardId: string; content: Record<string, unknown> } | null;

export interface RepairRunnerDeps {
  activeLanguage: string;
  getLanguageData: (language: string) => LanguageData | null;
  settings: DictionaryTargetSettings;
  /** Produces the content patch for a card. Defaults to the shared enrichment. */
  buildContent?: typeof buildContentUpdate;
  /** Applies a content patch, honouring learner edits. */
  applyContent: (cardId: string, content: Record<string, unknown>) => void;
  /** Generates (or re-rolls) one audio file. Returns false when nothing was written. */
  generateTts: (finding: { cardId: string; text: string; language: string; field: TtsField }) => Promise<boolean>;
  /**
   * Generates (or re-rolls) example sentences for a whole batch in one call.
   * Batched rather than per-card because these are LLM calls: one prompt for N
   * words is materially cheaper and faster than N prompts.
   */
  generateExamples?: (findings: readonly ExampleFinding[]) => Promise<ExampleBatchUpdate[]>;
  /** Translates an example sentence. Returns null when nothing was written. */
  translateExample?: (exampleText: string, language: string) => Promise<string | null>;
  /** True when the failure is a dead end (cancelled/unreachable) and we must stop. */
  abortOnError?: (error: unknown) => boolean;
  onProgress?: (completed: number, total: number) => void;
  maxRetries?: number;
}

const ORDER = { content: 0, example: 1, exampleMeaning: 2, tts: 3 } as const;

/** Content must land before an example is written against it. */
export function orderFindings(findings: readonly RepairFinding[]): RepairFinding[] {
  return [...findings].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/**
 * Example sentences are generated up front, in one batch, because they are LLM
 * calls. Every finding still goes through the normal per-finding accounting
 * below; only the network round trip is hoisted.
 */
async function prefetchExamples(
  ordered: readonly RepairFinding[],
  deps: RepairRunnerDeps,
): Promise<Map<string, Record<string, unknown>>> {
  const ready = new Map<string, Record<string, unknown>>();
  const pending = ordered.filter((f): f is ExampleFinding => f.kind === 'example');
  if (pending.length === 0 || !deps.generateExamples) return ready;

  const updates = await deps.generateExamples(pending);
  pending.forEach((finding, index) => {
    const update = updates[index];
    if (update) ready.set(finding.card.id, update.content);
  });
  return ready;
}

export async function runFlashcardRepair(
  findings: readonly RepairFinding[],
  deps: RepairRunnerDeps,
): Promise<RepairRunResult> {
  const ordered = orderFindings(findings);
  const total = ordered.length;
  const remaining: RepairFinding[] = [];
  const failed = new Set<RepairFinding>();
  let succeeded = 0;
  let completed = 0;
  const maxRetries = Math.max(1, deps.maxRetries ?? 1);
  const examples = await prefetchExamples(ordered, deps);

  for (const finding of ordered) {
    let done = false;
    for (let attempt = 0; attempt < maxRetries && !done; attempt++) {
      try {
        done = await runOne(finding, deps, examples);
        if (done) succeeded++;
        else failed.add(finding);
      } catch (error) {
        if (deps.abortOnError?.(error)) throw error;
        failed.add(finding);
      }
    }
    if (!done) remaining.push(finding);
    completed++;
    deps.onProgress?.(completed, total);
  }

  return { attempted: total, succeeded, failed: remaining.length, remaining };
}

async function runOne(
  finding: RepairFinding,
  deps: RepairRunnerDeps,
  examples: ReadonlyMap<string, Record<string, unknown>>,
): Promise<boolean> {
  switch (finding.kind) {
    case 'content': {
      const update = await (deps.buildContent ?? buildContentUpdate)(finding, {
        getLanguageData: deps.getLanguageData,
        settings: deps.settings,
      });
      if (!update) return false;
      deps.applyContent(update.cardId, update.content);
      return true;
    }
    case 'example': {
      const content = examples.get(finding.card.id);
      if (!content) return false;
      deps.applyContent(finding.card.id, content);
      return true;
    }
    case 'exampleMeaning': {
      if (!deps.translateExample) return false;
      const meaning = await deps.translateExample(finding.exampleText, finding.language);
      if (!meaning) return false;
      deps.applyContent(finding.card.id, { exampleMeaning: meaning });
      return true;
    }
    case 'tts': {
      return await deps.generateTts({
        cardId: finding.card.id, text: finding.text, language: finding.language, field: finding.field,
      });
    }
  }
}
