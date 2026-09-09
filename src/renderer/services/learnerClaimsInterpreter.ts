import type { LLMToolCall, LLMToolDefinition } from '../../shared/types';
import type { WordStatus } from '../../shared/constants';

/**
 * "Tell mLearn…" — the natural-language long-tail escape hatch.
 *
 * NOT a chat feature. The learner types a correction in their own words; a
 * small LLM tool-calling pass translates it into a narrow, typed set of
 * CLAIM operations. Natural-language statements are CLAIMS or POLICY, never
 * fabricated Evidence: there is deliberately no writeEvidence /
 * setKnowledge / recordAttempt tool here. Every applied op returns its
 * deterministic summary from the actual mutation, never from model prose,
 * and every op has an inverse through the existing append-only claim model
 * (clearing claims / claim withdrawal).
 */

export type LearnerClaimOp =
  | { op: 'setAccessClaim'; capability: string; status: WordStatus }
  | { op: 'clearAccessClaim'; capability: string }
  | { op: 'setWordClaim'; status: WordStatus }
  | { op: 'clearWordClaim' };
const VALID_STATUSES: Record<string, true> = { known: true, learning: true, unknown: true };

export const LEARNER_CLAIM_TOOLS: LLMToolDefinition[] = [
  {
    name: 'set_access_claim',
    description:
      'Record that the learner CLAIMS a specific access on the current word (e.g. known when heard, reading always wrong). Status is known, learning, or unknown. This is the learner\'s own statement — not a test result.',
    parameters: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description:
            'Directed access id. Core ids: sense-recognition, surface-recognition, surface-reading, spoken-recognition, prosodic-pattern, character-recognition, character-reading, morpheme-recognition. Package-declared namespaced ids (e.g. x-acme::classifier) are equally valid.',
        },
        status: { type: 'string', enum: ['known', 'learning', 'unknown'] },
      },
      required: ['capability', 'status'],
    },
  },
  {
    name: 'clear_access_claim',
    description:
      'Withdraw the learner\'s claim on one access so evidence classification resumes. Use for statements like "actually I am not sure I know the meaning".',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'Which directed access claim to withdraw.' },
      },
      required: ['capability'],
    },
  },
  {
    name: 'set_word_claim',
    description:
      'Record a whole-word status claim (known / learning / unknown) — the learner knows the LEXICAL OBJECT itself, independent of any one access.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['known', 'learning', 'unknown'] },
      },
      required: ['status'],
    },
  },
  {
    name: 'clear_word_claim',
    description: 'Withdraw the whole-word status claim; the evidence projection resumes.',
    parameters: { type: 'object', properties: {} },
  },
];

const opCapability = (args: Record<string, unknown>): string | null => {
  const capability = args.capability;
  return typeof capability === 'string' && capability.trim().length > 0 ? capability.trim() : null;
};

const opStatus = (args: Record<string, unknown>): WordStatus | null => {
  const status = args.status;
  return typeof status === 'string' && VALID_STATUSES[status] ? (status as WordStatus) : null;
};

/** Tool-call arguments → typed claim ops. Unknown tools and malformed arguments are dropped. */
export function parseClaimToolCalls(calls: readonly LLMToolCall[]): LearnerClaimOp[] {
  const ops: LearnerClaimOp[] = [];
  for (const call of calls) {
    const args = call.arguments ?? {};
    switch (call.name) {
      case 'set_access_claim': {
        const capability = opCapability(args);
        const status = opStatus(args);
        if (capability && status) ops.push({ op: 'setAccessClaim', capability, status });
        break;
      }
      case 'clear_access_claim': {
        const capability = opCapability(args);
        if (capability) ops.push({ op: 'clearAccessClaim', capability });
        break;
      }
      case 'set_word_claim': {
        const status = opStatus(args);
        if (status) ops.push({ op: 'setWordClaim', status });
        break;
      }
      case 'clear_word_claim':
        ops.push({ op: 'clearWordClaim' });
        break;
    }
  }
  return ops;
}

/** Deterministic summary line for one applied op — localized by the caller. */
export interface AppliedClaimOp {
  op: LearnerClaimOp;
  /** Localization key describing WHAT was addressed (e.g. capability label). */
  labelKey: string;
  /** Localization key for the status word, when the op sets one. */
  statusKey?: string;
}

export const capabilityLabelKey = (capability: string): string =>
  `mlearn.Knowledge.Capability.${capability}`;

/** Compacts the current learner state for the model — no eager graph fetches. */
export interface ClaimContextInput {
  word: string;
  reading?: string | null;
  language: string;
  /** capability → effective status ('known' | 'learning' | 'unknown'); absent = unmeasured. */
  accessStates: Readonly<Record<string, WordStatus | undefined>>;
  wordClaim?: WordStatus | null;
  /** Graph-attested component characters of the word, when available. */
  componentCharacters?: readonly string[];
}

export function buildClaimPromptContext(input: ClaimContextInput): string {
  const lines: string[] = [
    `Current word: ${input.word}${input.reading ? ` (${input.reading})` : ''}`,
    `Language: ${input.language}`,
  ];
  const accesses = Object.entries(input.accessStates).filter(([, status]) => status !== undefined);
  lines.push(`Learner access state: ${
    accesses.length > 0
      ? accesses.map(([capability, status]) => `${capability}=${status}`).join(', ')
      : 'unmeasured'
  }`);
  lines.push(`Whole-word claim: ${input.wordClaim ?? 'none'}`);
  if (input.componentCharacters?.length) {
    lines.push(`Character components: ${input.componentCharacters.join(' ')}`);
  }
  return lines.join('\n');
}

export const CLAIM_SYSTEM_PROMPT = [
  'You translate a language learner\'s correction about ONE word into typed claim operations.',
  'Use ONLY the provided tools. Do not invent knowledge the learner did not state.',
  'Claims are the learner\'s own statements (I know / I do not know); they are not test results.',
  'Prefer the fewest operations that faithfully capture the statement. If the statement is',
  'already reflected in the learner state, emit no operations.',
].join(' ');
