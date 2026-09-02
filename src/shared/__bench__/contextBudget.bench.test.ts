/**
 * Context-budget benchmark — baseline harness for the bounded-retrieval finish
 * pass. Measures compileContext (NO turn arg — today's behavior) +
 * renderCompiledContext wall time and rendered prompt size on synthetic
 * journals so the orchestrator can compare before/after WS1 lands.
 *
 * Node vitest project only; imports shared modules plus the pure
 * renderCompiledContext leaf from roomMessages.ts (shared types only, no
 * Solid/DOM — approved for this harness). Deterministic: index-derived texts,
 * no randomness, no clock reads besides performance.now() measurements.
 * Results print as greppable `BENCH_JSON:` lines; nothing timing-related is
 * asserted.
 */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { compileContext, type CompileContextInput } from '../contextCompiler';
import { renderCompiledContext } from '../../renderer/windows/conversationAgent/roomMessages';
import { HARNESS_ACTOR, USER_ACTOR, type JournalEvent, type Participant } from '../world';

const ROOM_ID = 'bench-room';
const BASE_MS = 1735689600000; // fixed epoch; no clock reads
const SEA_COUNT = 240; // fixed sea-stream size; N varies the thread stream only
const THREAD_SIZES = [500, 2000, 10000] as const;
const RUNS = 5;
const ALL_WITNESSES = [USER_ACTOR, 'p1', 'p2'];

const OLD_RELEVANT_BELIEFS = [
  'The learner is allergic to peanuts — severe reaction history.',
  'The learner is preparing for a work trip to Lisbon next month.',
  'The learner gets anxious speaking on the phone in Portuguese.',
  'The learner prefers gentle corrections over fluency-first practice.',
];

function beliefText(k: number): string {
  if (k < OLD_RELEVANT_BELIEFS.length * 2) return OLD_RELEVANT_BELIEFS[k % OLD_RELEVANT_BELIEFS.length];
  return `The learner mentioned liking music genre ${k % 9} on day ${k}.`;
}

function threadText(i: number): string {
  if (i % 7 === 3) return `今日はいい天気ですね。例文 ${i} を練習しましょう。`;
  if (i % 2 === 0) return `I want to practice talking about topic ${i % 24} today.`;
  return `Sure — let's try example ${i} and see how it goes.`;
}


/**
 * Fixed-size sea stream: owner-scoped memory.belief mix (old/relevant +
 * recent/irrelevant), one p2 absence interval (removed → gap beliefs →
 * re-added), deletion tombstones, schedule and call events. Beliefs narrow-
 * witnessed every 28th k exercise the witness filter for p2.
 */
function buildSeaEvents(): JournalEvent[] {
  const events: JournalEvent[] = [];
  const beliefIds: string[] = [];
  let seq = 0;
  let ms = BASE_MS;
  const push = (
    type: JournalEvent['type'],
    payload: unknown,
    opts?: { witnesses?: string[]; actorId?: string },
  ): JournalEvent => {
    seq += 1;
    ms += 60_000;
    const event: JournalEvent = {
      id: `evt-sea-${seq}`,
      seq,
      roomId: ROOM_ID,
      scope: { kind: 'sea' },
      type,
      actorId: opts?.actorId ?? 'p2',
      witnesses: opts?.witnesses ?? ALL_WITNESSES,
      payload,
      createdAt: ms,
    };
    events.push(event);
    return event;
  };

  push('membership', { participantId: 'p1', action: 'added' }, { actorId: HARNESS_ACTOR });
  push('membership', { participantId: 'p2', action: 'added' }, { actorId: HARNESS_ACTOR });

  for (let k = 0; seq < SEA_COUNT; k += 1) {
    if (k === 96) {
      push('membership', { participantId: 'p2', action: 'removed' }, { actorId: HARNESS_ACTOR });
      for (let g = 0; g < 6; g += 1) {
        push('memory.belief', {
          ownerId: 'p2',
          kind: 'belief',
          text: `The learner seemed tired during the rejoin gap (gap ${g}).`,
        });
      }
      push('membership', { participantId: 'p2', action: 'added' }, { actorId: HARNESS_ACTOR });
      continue;
    }
    if (k > 4 && k % 20 === 4 && beliefIds.length > 0) {
      push('deletion', { targetId: beliefIds[(k >> 1) % beliefIds.length], ownerId: 'p2' });
      continue;
    }
    if (k % 20 === 8) {
      push(
        'schedule',
        { candidateId: `cand-${k}`, kind: 'message', participantId: 'p1', fireAt: ms + 3_600_000, score: 0.5 },
        { actorId: HARNESS_ACTOR },
      );
      continue;
    }
    if (k % 30 === 14) {
      push('call_initiated', { callId: `call-${k}` });
      push('call_accepted', { callId: `call-${k}` });
      push('call_ended', { callId: `call-${k}`, reason: 'completed' });
      continue;
    }
    if (k % 16 === 5) {
      push('memory.belief', {
        ownerId: 'p2',
        kind: 'open-loop',
        text: `Follow up on the learner's goal: ordering food in Portuguese (loop ${k}).`,
      });
    } else if (k % 32 === 7) {
      push('memory.belief', {
        ownerId: 'p2',
        kind: 'relationship',
        toId: 'p1',
        label: `gets along well with Mia (rel ${k})`,
        text: `gets along well with Mia (rel ${k})`,
      });
    } else if (k % 48 === 11) {
      push('memory.belief', {
        ownerId: 'p2',
        kind: 'fact',
        text: `Studies every morning before work (fact ${k}).`,
      });
    } else if (k % 64 === 13) {
      push('memory.belief', {
        ownerId: 'p2',
        kind: 'episode',
        text: `Told a story about missing a train in Osaka (ep ${k}).`,
      });
    } else {
      const narrow = k % 28 === 12;
      const event = push(
        'memory.belief',
        { ownerId: 'p2', kind: 'belief', text: beliefText(k) },
        narrow ? { witnesses: [USER_ACTOR, 'p1'] } : undefined,
      );
      beliefIds.push(event.id);
    }
  }
  return events;
}

/** Thread stream of n alternating user/character messages (per-stream seq). */
function buildThreadEvents(n: number): JournalEvent[] {
  const events: JournalEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    const isUser = i % 2 === 0;
    events.push({
      id: `evt-thr-${i + 1}`,
      seq: i + 1,
      roomId: ROOM_ID,
      scope: { kind: 'thread', threadId: 't1' },
      type: isUser ? 'message.user' : 'message.character',
      actorId: isUser ? USER_ACTOR : i % 4 === 1 ? 'p1' : 'p2',
      witnesses: (i + 1) % 13 === 0 ? [USER_ACTOR, 'p1'] : ALL_WITNESSES,
      payload: { text: threadText(i), modality: 'text' },
      createdAt: BASE_MS + (SEA_COUNT + i + 1) * 60_000,
    });
  }
  return events;
}

/** chars/4 with CJK code points as 1 token each (conservative, WS1 contract). */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) cjk += 1;
  }
  return Math.ceil((text.length - cjk) / 4) + cjk;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}


describe('context budget baseline', () => {
  it('compiles and renders synthetic journals at 500/2000/10000 thread events', () => {
    const p1: Participant = {
      id: 'p1',
      displayName: 'Mia',
      kind: 'persistent',
      personaText: 'Mia is a patient language partner who encourages the learner and corrects gently.',
      setupComplete: true,
    };
    const p2: Participant = {
      id: 'p2',
      displayName: 'Tomas',
      kind: 'persistent',
      personaText: 'Tomas is a patient language partner who encourages the learner and corrects gently.',
      setupComplete: true,
    };
    const participants = [p1, p2];

    for (const n of THREAD_SIZES) {
      const input: CompileContextInput = {
        participant: p2, // exercises the absence interval + witness filtering
        participants,
        seaEvents: buildSeaEvents(),
        threadEvents: buildThreadEvents(n),
      };

      const compileMs: number[] = [];
      const renderMs: number[] = [];
      let rendered = '';
      for (let r = 0; r < RUNS; r += 1) {
        const t0 = performance.now();
        const ctx = compileContext(input);
        const t1 = performance.now();
        rendered = renderCompiledContext(ctx, participants, 'You');
        const t2 = performance.now();
        compileMs.push(t1 - t0);
        renderMs.push(t2 - t1);
      }

      expect(rendered).toContain('## Persona');

      const recentIdx = rendered.indexOf('## Recent Conversation');
      const recentSection = recentIdx >= 0 ? rendered.slice(recentIdx) : '';
      const line = {
        compileMs: Math.round(median(compileMs) * 100) / 100,
        renderMs: Math.round(median(renderMs) * 100) / 100,
        promptChars: rendered.length,
        promptTokensEst: estimateTokens(rendered),
        recentTokensEst: estimateTokens(recentSection),
      };
      // Emitted on stderr: vitest v4's default reporter suppresses passing
      // tests' intercepted stdout, which would hide the baseline lines from
      // `vitest run` output. stderr passes through un-intercepted.
      process.stderr.write(`BENCH_JSON:${JSON.stringify(line)}\n`);
    }
});
});

describe('context budget with turn-specific retrieval', () => {
  it('compiles with a turn query under default budgets at 500/2000/10000 thread events', () => {
    const p1: Participant = {
      id: 'p1',
      displayName: 'Mia',
      kind: 'persistent',
      personaText: 'Mia is a patient language partner who encourages the learner and corrects gently.',
      setupComplete: true,
    };
    const p2: Participant = {
      id: 'p2',
      displayName: 'Tomas',
      kind: 'persistent',
      personaText: 'Tomas is a patient language partner who encourages the learner and corrects gently.',
      setupComplete: true,
    };
    const participants = [p1, p2];

    for (const n of THREAD_SIZES) {
      const input: CompileContextInput = {
        participant: p2,
        participants,
        seaEvents: buildSeaEvents(),
        threadEvents: buildThreadEvents(n),
        turn: { text: 'allergic to peanuts Tokyo trip plans' },
      };

      const compileMs: number[] = [];
      let rendered = '';
      for (let r = 0; r < RUNS; r += 1) {
        const t0 = performance.now();
        const ctx = compileContext(input);
        const t1 = performance.now();
        rendered = renderCompiledContext(ctx, participants, 'You');
        compileMs.push(t1 - t0);
      }

      expect(rendered).toContain('## Persona');

      const recentIdx = rendered.indexOf('## Recent Conversation');
      const recentSection = recentIdx >= 0 ? rendered.slice(recentIdx) : '';
      const line = {
        compileMs: Math.round(median(compileMs) * 100) / 100,
        promptChars: rendered.length,
        promptTokensEst: estimateTokens(rendered),
        recentTokensEst: estimateTokens(recentSection),
      };
      process.stderr.write(`BENCH_JSON_TURN:${JSON.stringify(line)}\n`);
    }
  });
});
