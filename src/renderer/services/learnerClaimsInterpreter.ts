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
        basis: {
          type: 'string',
          enum: ['unassisted', 'cue-dependent', 'cue-only'],
          description:
            'Basis for THIS access: unassisted = learner states their ability without the answer supplied (including failure); cue-dependent = learner needs a hint/scaffold to retrieve it; cue-only = answer was supplied and independent ability was not stated. Required cues cannot establish known; cue-only recognition makes no access claim. Judge what the cue supplies, not just whether a cue is mentioned.',
        },
      },
      required: ['capability', 'status', 'basis'],
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
        // A self-report of dependence can claim weak retrieval; merely seeing
        // the answer establishes neither ability nor inability. Keep this at
        // the claim boundary: it must not fabricate scaffolded attempt evidence.
        if (capability && status && (args.basis === 'unassisted' || args.basis === 'cue-dependent')) {
          ops.push({
            op: 'setAccessClaim', capability,
            status: args.basis === 'cue-dependent' && status === 'known' ? 'learning' : status,
          });
        }
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
  'For each access, separate ability WITHOUT an answer-supplying cue from recognition AFTER that cue.',
  'Resolve conditions, negation, and temporal scope before choosing a status. Expressions such as',
  '"only when", "after you show me", "with the hint/scaffold", and "once I see the reading"',
  'can describe cued recognition rather than independent retrieval. They are not keyword rules:',
  'a hint merely being present does not imply dependence, and not needing a hint is unassisted.',
  'Identify which access the cue supplies. A displayed reading or pronunciation audio supplies',
  'surface-reading; a displayed meaning supplies sense-recognition. Apply the same reasoning to',
  'package-declared accesses without inventing capability ids. Never credit the supplied answer',
  'as known for that access, or infer unrelated accesses from it. Context readings are not learner evidence.',
  'Use basis=cue-dependent when the learner says a cue is required: learning for weak/partial',
  'independent retrieval, unknown if they explicitly cannot retrieve it at all without the cue.',
  'Use basis=cue-only when only recognition after seeing the answer is stated and independent',
  'ability is unspecified; omit that access claim. Use basis=unassisted for explicit independent',
  'ability or failure, including "I can read it without hints" and "I cannot read it at all".',
  'For example, "I know what it means only once you show me the reading" supports a whole-word',
  'known claim for the recognized lexical item and surface-reading learning with basis=cue-dependent.',
  '"I cannot read it myself, but after you show me the reading I know the word" instead supports',
  'surface-reading unknown with basis=cue-dependent and a separate whole-word known claim.',
  '"I saw the reading" alone establishes no access or whole-word knowledge. "I know it when I hear it"',
  'supports spoken-recognition known with basis=unassisted: the sound is the input to listening,',
  'not its answer. It does not establish surface-reading. "The hint helps, but I can read it myself"',
  'supports surface-reading known with basis=unassisted. Preserve independently stated abilities.',
  'Lexical recognition after a reading cue can support a whole-word claim, but merely repeating',
  'a supplied translation does not establish lexical knowledge. Do not use a whole-word claim',
  'to bypass a cued access restriction. Leave unstated or ambiguous abilities unchanged.',
  'Prefer the fewest operations that faithfully capture the statement. If the statement is',
  'already reflected in the learner state, emit no operations.',
].join(' ');
