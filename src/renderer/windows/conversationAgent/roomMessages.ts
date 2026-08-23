/**
 * Room window pure helpers — message projection from journal events and
 * compiled-context rendering into a system prompt string.
 */

import { USER_ACTOR, type JournalEvent, type Participant } from '../../../shared/world';
import type { CompiledContext } from '../../../shared/contextCompiler';

export interface RoomMessage {
  id: string;
  seq: number;
  actorId: string;
  displayName: string;
  text: string;
  createdAt: number;
  isUser: boolean;
}

export function messageText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === 'string' ? text : undefined;
}

/**
 * Project journal events into display messages: only message events with a
 * text payload; speaker displayName resolved from participants (falls back to
 * the actorId); the user's own messages use `userLabel`.
 */
export function projectMessages(
  events: JournalEvent[],
  participants: Participant[],
  userLabel: string,
): RoomMessage[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const result: RoomMessage[] = [];
  for (const e of events) {
    if (e.type !== 'message.user' && e.type !== 'message.character') continue;
    const text = messageText(e.payload);
    if (text === undefined) continue;
    const isUser = e.actorId === USER_ACTOR;
    result.push({
      id: e.id,
      seq: e.seq,
      actorId: e.actorId,
      displayName: isUser ? userLabel : (byId.get(e.actorId)?.displayName ?? e.actorId),
      text,
      createdAt: e.createdAt,
      isUser,
    });
  }
  return result;
}

/**
 * Render a CompiledContext as the system prompt for one participant's agent.
 * Sections are ordered by epistemic priority: persona, canon, negative
 * knowledge, relationships, memories, open loops, learner projection, then the
 * recent thread transcript with display names.
 */
export function renderCompiledContext(
  ctx: CompiledContext,
  participants: Participant[],
  userLabel: string,
): string {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const resolveName = (actorId: string): string =>
    actorId === USER_ACTOR ? userLabel : (byId.get(actorId)?.displayName ?? actorId);
  const sections: string[] = [];
  sections.push(`## Persona\n${ctx.persona.text}`);
  if (ctx.canonBaseline) {
    sections.push(`## Canon Baseline\n${ctx.canonBaseline.lore}`);
    if (ctx.canonBaseline.quotes.length > 0) {
      sections.push(
        `Sample quotes (match the style, do not repeat verbatim):\n${ctx.canonBaseline.quotes
          .map((q) => `- "${q}"`)
          .join('\n')}`,
      );
    }
  }
  if (ctx.negativeKnowledge.length > 0) {
    sections.push(
      `## Things That Have NOT Happened\n${ctx.negativeKnowledge.map((n) => `- ${n}`).join('\n')}`,
    );
  }
  if (ctx.relationships.length > 0) {
    sections.push(
      `## Relationships\n${ctx.relationships.map((r) => `- ${r.label}`).join('\n')}`,
    );
  }
  if (ctx.memories.length > 0) {
    sections.push(`## Memories\n${ctx.memories.map((m) => `- ${m.text}`).join('\n')}`);
  }
  if (ctx.openLoops.length > 0) {
    sections.push(`## Open Loops\n${ctx.openLoops.map((l) => `- ${l.text}`).join('\n')}`);
  }
  if (ctx.learnerProjection) {
    const parts: string[] = [];
    const lp = ctx.learnerProjection;
    if (lp.language) parts.push(`Language: ${lp.language}`);
    if (lp.levelEstimate) parts.push(`Level estimate: ${lp.levelEstimate}`);
    if (lp.failedWords && lp.failedWords.length > 0) {
      parts.push(lp.wordsBasis === 'prediction'
        ? `Likely unfamiliar words (predicted): ${lp.failedWords.join(', ')}`
        : `Words the learner marked as difficult: ${lp.failedWords.join(', ')}`);
    }
    if (lp.grammarPoints && lp.grammarPoints.length > 0) {
      parts.push(lp.grammarBasis === 'prediction'
        ? `Grammar points likely unfamiliar (predicted, not measured): ${lp.grammarPoints.join(', ')}`
        : `Grammar points selected for practice: ${lp.grammarPoints.join(', ')}`);
    }
    if (parts.length > 0) sections.push(`## Learner\n${parts.join('\n')}`);
  }
  if (ctx.threadMedia) {
    const media = ctx.threadMedia;
    const mediaLines = [`The learner is currently ${media.mediaType === 'video' ? 'watching' : 'reading'}: "${media.mediaName}"`];
    if (media.assessedLevelName) mediaLines.push(`Assessed difficulty level: ${media.assessedLevelName}`);
    sections.push(`## Current Media Context\n${mediaLines.join('\n')}`);
    if (media.characterContext) {
      sections.push(`## Characters\n${media.characterContext}`);
    }
    if (media.subtitleHistory && media.subtitleHistory.length > 0) {
      sections.push(
        `## Recent Dialogue (from subtitles)\nThe following are recent subtitle lines from what the learner is watching. Use this as context for discussion — ask about character actions, opinions, or plot points rather than generic topics.\n${media.subtitleHistory.join('\n')}`,
      );
    }
  }
  if (ctx.recentThreadEvents.length > 0) {
    sections.push(
      `## Recent Conversation\n${ctx.recentThreadEvents
        .map((e) => `${resolveName(e.actorId)}: ${e.text ?? ''}`)
        .join('\n')}`,
    );
  }
  return sections.join('\n\n');
}
