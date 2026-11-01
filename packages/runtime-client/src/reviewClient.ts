import type { Request, ReviewCommand, ReviewMode, ReviewSession, SourcePracticeTarget } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isMaterialResponse, isSourceAnchor } from './materialProtocol';
import { isReviewCommand, isReviewResponse } from './reviewProtocol';

type Mutation = Exclude<ReviewCommand, { kind: 'start' }>;
export type ReviewAction = Mutation extends infer Command
  ? Command extends Mutation ? Omit<Command, 'mutation'> : never : never;

export function createReviewClient(request: (command: Request, signal?: AbortSignal) => Promise<unknown>, commandId: () => string) {
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
    async sourcePractice(packageId: string, packageRevision: string, targets: readonly SourcePracticeTarget[], signal?: AbortSignal) {
      const selected = structuredClone(targets);
      if (!packageId || !packageRevision || selected.length === 0 || selected.length > 128
        || selected.some(item => !item.targetId || item.targetId.length > 512 || !isSourceAnchor(item.source)
          || item.source.packageId !== packageId)
        || new Set(selected.map(item => item.targetId)).size !== selected.length)
        throw new RuntimeError('invalid_request', 'Invalid visible Practice target scope.');
      const value = await request({ type: 'prepare_source_practice', packageId, packageRevision, targets: [...selected] }, signal);
      if (!isReviewResponse(value) || value.type !== 'source_practice' || value.items.length !== selected.length
        || value.items.some((item, index) => {
          const original = selected[index];
          const source = item.source;
          return !original || !source || item.packageId !== packageId || item.packageRevision !== packageRevision
            || item.targetId !== original.targetId || source.sourceId !== original.source.sourceId
            || source.contentRevision !== original.source.contentRevision || source.packageId !== original.source.packageId
            || source.packageVersion !== original.source.packageVersion || source.text !== original.source.text
            || Object.entries(source.locator).some(([key, value]) => Reflect.get(original.source.locator, key) !== value);
        }))
        throw malformed();
      return value.items;
    },
    prepareReviewStart(mode: ReviewMode): ReviewCommand {
      return prepared({ kind: 'start', start: { commandId: commandId(), sessionId: commandId(), mode } });
    },
    prepareReviewMutation(session: ReviewSession, action: ReviewAction): ReviewCommand {
      return prepared({ ...action, mutation: {
        commandId: commandId(), sessionId: session.id, expectedRevision: session.revision,
      } });
    },
    async review(command: ReviewCommand, signal?: AbortSignal) {
      const snapshot = prepared(command);
      if(signal&&snapshot.kind!=='capture_response')
        throw new RuntimeError('invalid_request','Only response validation supports operation cancellation.');
      const identity = snapshot.kind === 'start' ? snapshot.start : snapshot.mutation;
      const value = await request({ type: 'review', command: snapshot },signal);
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
