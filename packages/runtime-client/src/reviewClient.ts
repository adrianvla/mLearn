import type { Request, ReviewCommand, ReviewMode, ReviewSession } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isMaterialResponse } from './materialProtocol';
import { isReviewCommand, isReviewResponse } from './reviewProtocol';

type Mutation = Exclude<ReviewCommand, { kind: 'start' }>;
export type ReviewAction = Mutation extends infer Command
  ? Command extends Mutation ? Omit<Command, 'mutation'> : never : never;

export function createReviewClient(request: (command: Request) => Promise<unknown>, commandId: () => string) {
  // Only revision fences are retained, never encounter content or learner history.
  const revisions = new Map<string, number>();
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched Review response.');
  function current(sessions: readonly ReviewSession[]) {
    if (sessions.some(session => session.revision < (revisions.get(session.id) ?? 0)))
      throw new RuntimeError('stale_result', 'Review changed while this request was pending; reload the session.');
    for (const session of sessions) {
      revisions.delete(session.id);
      revisions.set(session.id, session.revision);
      if (revisions.size > 32) {
        const oldest = revisions.keys().next();
        if (!oldest.done) revisions.delete(oldest.value);
      }
    }
  }
  function prepared(command: ReviewCommand): ReviewCommand {
    if (!isReviewCommand(command)) throw new RuntimeError('invalid_request', 'Invalid Review command.');
    // Identity and grades belong to this intent, not to a subsequently edited form.
    return structuredClone(command);
  }
  return {
    prepareReviewStart(mode: ReviewMode): ReviewCommand {
      return prepared({ kind: 'start', start: { commandId: commandId(), sessionId: commandId(), mode } });
    },
    prepareReviewMutation(session: ReviewSession, action: ReviewAction): ReviewCommand {
      return prepared({ ...action, mutation: {
        commandId: commandId(), sessionId: session.id, expectedRevision: session.revision,
      } });
    },
    async review(command: ReviewCommand) {
      const snapshot = prepared(command);
      const identity = snapshot.kind === 'start' ? snapshot.start : snapshot.mutation;
      const value = await request({ type: 'review', command: snapshot });
      if (!isReviewResponse(value) || value.type !== 'review' || value.commit.commandId !== identity.commandId
        || value.commit.session.id !== identity.sessionId
        || value.commit.committedRevision !== (snapshot.kind === 'start' ? 1 : snapshot.mutation.expectedRevision + 1))
        throw malformed();
      current([value.commit.session]);
      return value.commit;
    },
    async reviewSession(sessionId: string) {
      const value = await request({ type: 'review_session', sessionId });
      if (!isReviewResponse(value) || value.type !== 'review_session' || value.session.id !== sessionId) throw malformed();
      current([value.session]);
      return value.session;
    },
    async reviewSessions() {
      const value = await request({ type: 'review_sessions' });
      if (!isReviewResponse(value) || value.type !== 'review_sessions') throw malformed();
      current(value.sessions);
      return value.sessions;
    },
    async returnReviewSource(sessionId: string, encounterId: string) {
      const value = await request({ type: 'return_review_source', sessionId, encounterId });
      if (!isMaterialResponse(value) || value.type !== 'material_source'
        && value.type !== 'document_material_source' && value.type !== 'image_material_source'
        && value.type !== 'conversation_material_source') throw malformed();
      return value;
    },
  };
}
