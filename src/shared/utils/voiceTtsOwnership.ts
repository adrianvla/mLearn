import type { VoiceTtsRequestIdentity } from '../types';

/** Untagged legacy events cannot become evidence of a current owned request. */
export function matchesVoiceTtsRequest(
  event: Partial<VoiceTtsRequestIdentity>,
  request: VoiceTtsRequestIdentity | null | undefined,
): boolean {
  return Boolean(request && event.sessionId === request.sessionId && event.requestId === request.requestId
    && (request.utteranceId === undefined || event.utteranceId === request.utteranceId)
    && (request.actorId === undefined || event.actorId === request.actorId));
}
