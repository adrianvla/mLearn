/**
 * Guards the consolidation itself rather than any one behaviour.
 *
 * The debt this replaced was not a wrong message: it was six modules each
 * deciding what a failed provider operation meant. `FlashcardContext` and
 * `flashcards/App` held byte-identical copies of the same two predicates and
 * the same fallback helper, `conversationAgent/App` inlined the same five-arm
 * ternary ladder three times, and `conversationAgent/errorUtils` held a clone
 * of the auth classifier that had already drifted by one code. A test suite
 * that only exercised the new owner would stay green while any of that grew
 * back, which is exactly how it accumulated.
 *
 * So this walks the renderer and fails on the shapes that recreate the class.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const RENDERER_ROOT = join(__dirname, '..');
const SOURCE_FILE = /\.(ts|tsx)$/;

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return rendererSources(full);
    if (!SOURCE_FILE.test(entry.name) || full.includes('.test.')) return [];
    return [full];
  });
}

const files = rendererSources(RENDERER_ROOT).filter(
  (file) => !file.endsWith('providerFailure.ts'),
);

/**
 * Modules that legitimately touch the failure primitives.
 *
 * `cloudSessionManager` defines the error types and the transport classifier
 * that normalises wrapped network errors before anyone sees them.
 * `llmProvider` answers a different question - whether the provider is usable
 * *before* an operation runs - and returns a readiness verdict rather than a
 * user-facing report, which is what `capabilityUnavailable` now owns. Neither
 * is a competing owner of "what went wrong and what do I do".
 */
const PRIMITIVE_OWNERS = ['services/cloudSessionManager.ts', 'services/llmProvider.ts'];

describe('failed provider operations are reported through one owner', () => {
  it('finds renderer sources to check', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no surface re-derives the failure predicates locally', () => {
    // Four modules carried their own `instanceof CloudSessionCancelledError`
    // check, and one of them had added a `name` check the others lacked. That
    // is the exact shape that let a copy drift without anything failing.
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(RENDERER_ROOT, file);
      if (PRIMITIVE_OWNERS.includes(relativePath)) continue;
      const source = readFileSync(file, 'utf-8').replace(/\/\/.*$/gm, '');
      if (/instanceof\s+Cloud(SessionCancelled|Unreachable)Error/.test(source)) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no surface re-derives a provider failure by matching message text', () => {
    // The regex classifiers over error text are what made the conversation
    // agent report a missing model differently from the capability gate, and
    // what let a stale auth check stay unnoticed. Text matching belongs in the
    // owner, once.
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(RENDERER_ROOT, file);
      if (PRIMITIVE_OWNERS.includes(relativePath)) continue;
      const source = readFileSync(file, 'utf-8').replace(/\/\/.*$/gm, '');
      const classifies = /(quota|rate limit|nobinaryfound|econnrefused)/i.test(source)
        && /(isQuotaError|RecoveryKey|isCloudSessionError)\s*\(/.test(source);
      if (classifies) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });

  it('no surface inlines a ladder of failure copy keys', () => {
    // The five-deep ternary was repeated three times in one file and the three
    // did not agree with each other.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8').replace(/\/\/.*$/gm, '');
      const ladderKeys = new Set(source.match(/mlearn\.(AI\.CloudUnreachable|CloudReLogin\.SignInCanceled|CloudReLogin\.SessionExpired|AI\.Settings\.CompatibleConfig\.AuthenticationFailed|ConversationAgent\.Recovery\.[A-Za-z]+)/g) ?? []).size;
      if (ladderKeys >= 2) offenders.push(`${relative(RENDERER_ROOT, file)} (${ladderKeys})`);
    }
    expect(offenders).toEqual([]);
  });

  it('the shared owner is the only module that maps a failure to its copy', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (/ConversationAgent\.Recovery\.(Model|SignIn|Connection|Generic)\b/.test(source)) {
        offenders.push(relative(RENDERER_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no surface keeps its own fallback helper for a failed operation', () => {
    // `handleCloudOperationFallback` existed in two byte-identical copies. Its
    // contract - "return true if this operation produced nothing" - is now a
    // field on the failure record.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (/handleCloudOperationFallback/.test(source)) {
        offenders.push(relative(RENDERER_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Guards the second consolidation in the same area: "can this provider be used
 * right now".
 *
 * This one had a visible symptom rather than a latent one, which makes it more
 * likely to be reintroduced by someone who likes the simpler code: the
 * openai-compatible test button turned red and kept reading "Test connection",
 * because its status was a bare `'error'` string with nowhere to put a reason.
 * The conversation agent meanwhile could only say "Disconnected" for four
 * different problems. Both are the same mistake - a reachability probe whose
 * *reason* is thrown away - so these guards fail on the shapes that produce it.
 */
describe('provider reachability is probed through one owner', () => {
  // `WindowWrapper` listens for *download progress* on a specific model file,
  // which is a different fact from "is the configured provider usable"; it has
  // no configured provider to hand to the probe.
  const PROBE_EXEMPT = ['context/WindowWrapper.tsx'];

  const probeOffenders = () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(RENDERER_ROOT, file);
      if (PROBE_EXEMPT.includes(rel)) continue;
      const source = readFileSync(file, 'utf-8');
      const directProbes = (source.match(/\.checkAvailability\(/g) ?? []).length
        + (source.match(/\.ollamaCheck\(/g) ?? []).length;
      if (directProbes > 0) {
        offenders.push(`${rel} (${directProbes})`);
      }
    }
    return offenders;
  };

  it('finds renderer sources to check', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no surface runs its own per-provider reachability probe', () => {
    // The conversation agent dispatched four providers inline in an effect;
    // three test buttons in two windows reached for an adapter or the bridge
    // directly. Each produced a boolean and discarded why.
    expect(probeOffenders()).toEqual([]);
  });

  it('_documents the exempt sites', () => {
    // Kept as a live list rather than a comment, so a new exemption has to be
    // a deliberate edit here and shows up in the diff.
    expect(PROBE_EXEMPT.every((path) => files.some((f) => relative(RENDERER_ROOT, f) === path))).toBe(true);
  });

  it('no surface keeps a bare success/failure tri-state for a connection test', () => {
    // `'idle' | 'success' | 'error'` cannot say *which* failure, so the button
    // had no reason to render. The outcome has to be a record.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (/(compatible|ollama|connection)\w*Status|Status\w*(compatible|ollama|connection)/.test(source)
        && /createSignal<[^>]*'(idle|success|error)'/.test(source)) {
        offenders.push(relative(RENDERER_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired reason vocabulary is gone', () => {
    // `checkAvailability` answered with one string per provider for what were
    // five spellings of two or three real outcomes. Nothing could interpret
    // them, so every caller that wanted to explain a failure had to re-probe.
    // `cloud_unreachable` is excluded: it is also the `code` on the transport
    // error type, which is a legitimate structured marker rather than the
    // retired diagnostic vocabulary.
    const retired = /'(compatible_unreachable|ollama_unreachable|auth_required|model_not_downloaded|runtime_unavailable|model_check_failed)'/;
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (retired.test(source)) offenders.push(relative(RENDERER_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
