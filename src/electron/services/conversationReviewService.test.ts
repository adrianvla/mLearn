import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnReviewRequest } from '../../shared/conversationReview';

let profile = '/profile-a';
const completeJob = vi.fn();
const appendEvent = vi.fn();
const loadWorld = vi.fn();
const loadSettings = vi.fn();
const readSeaProjection = vi.fn();
const trace = { begin: vi.fn(() => 'trace-1'), start: vi.fn(), finish: vi.fn() };
vi.mock('../utils/platform', () => ({ getUserDataPath: () => profile }));
vi.mock('./llmRouter', () => ({ completeJob }));
vi.mock('./journalService', () => ({ appendEvent, readSeaProjection, readThread: vi.fn() }));
vi.mock('./worldStore', () => ({ loadWorld }));
vi.mock('./settings', () => ({ loadSettings }));
vi.mock('./runtimeTraceService', () => ({ runtimeTrace: () => trace }));

const request = (): TurnReviewRequest => ({ operationId: 'review-op-1', roomId: 'room-1', participantId: 'p1',
  sourceEventId: 'user-1', userText: 'Hello', assistantText: 'Hello back.', recent: [], repairContext: 'Mira is patient.', language: 'xx' });

describe('conversation second pass', () => {
  beforeEach(() => {
    profile = '/profile-a'; completeJob.mockReset(); appendEvent.mockReset(); loadWorld.mockReset(); loadSettings.mockReset(); readSeaProjection.mockReset();
    loadSettings.mockReturnValue({ conversationGuardProvider: 'actor' });
    loadWorld.mockResolvedValue({ rooms: [{ id: 'room-1', participantIds: ['p1'] }], threads: [], participants: [] });
    readSeaProjection.mockResolvedValue([{ id: 'user-1', type: 'message.user', actorId: 'user', payload: { text: 'Hello' } }]);
    appendEvent.mockImplementation(async (_roomId, draft) => ({ ...draft, id: 'review-event-1', seq: 2, createdAt: 2 }));
  });

  it('publishes the admitted marker only after a valid review', async () => {
    completeJob.mockResolvedValue('{"decision":"allow","reason":"none","subject":"assistant","evidence":""}');
    const { reviewConversationTurn } = await import('./conversationReviewService');
    const result = await reviewConversationTurn(request());
    expect(result.status).toBe('approved');
    expect(result.reviewEvent?.type).toBe('review.admitted');
    expect(appendEvent).toHaveBeenCalledOnce();
  });

  it('fails closed and publishes no marker when the verdict is malformed', async () => {
    completeJob.mockResolvedValue('allow');
    const { reviewConversationTurn } = await import('./conversationReviewService');
    const result = await reviewConversationTurn({ ...request(), operationId: 'review-op-2' });
    expect(result.status).toBe('unavailable');
    expect(completeJob).toHaveBeenCalledTimes(2);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('retries an empty reviewer response before admitting the turn', async () => {
    completeJob.mockResolvedValueOnce('').mockResolvedValueOnce('{"decision":"allow","reason":"none","subject":"assistant","evidence":""}');
    const { reviewConversationTurn } = await import('./conversationReviewService');
    const result = await reviewConversationTurn({ ...request(), operationId: 'review-op-empty' });
    expect(result.status).toBe('approved');
    expect(completeJob).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenCalledOnce();
  });

  it('does not publish across a profile switch', async () => {
    completeJob.mockImplementation(async () => { profile = '/profile-b'; return '{"decision":"allow","reason":"none","subject":"assistant","evidence":""}'; });
    const { reviewConversationTurn } = await import('./conversationReviewService');
    const result = await reviewConversationTurn({ ...request(), operationId: 'review-op-3' });
    expect(result.status).toBe('unavailable');
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
