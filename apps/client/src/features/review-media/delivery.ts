import type { AuthoredMediaId, ReviewDelivery, ReviewEncounterId } from '@mlearn/contracts';

export type PlaybackEvent =
  | { readonly kind: 'started' | 'completed' | 'interrupted' }
  | { readonly kind: 'failed'; readonly message: string };

export type AudioState =
  | { readonly kind: 'loading' | 'settling' }
  | { readonly kind: 'ready' | 'playing'; readonly uri: string }
  | { readonly kind: 'settled'; readonly delivery: ReviewDelivery }
  | { readonly kind: 'failed'; readonly message: string };

export type ReviewAudioDelivery = {
  readonly load: () => Promise<void>;
  readonly playback: (event: PlaybackEvent) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly dispose: () => void;
};

/** One playback attempt, with at most pending, started and one terminal write.
 * The caller owns durable command identity/retry and current session revision.
 * No playback event grades a target or claims that a person understood audio. */
export function createReviewAudioDelivery({
  encounterId, mediaId, initialDelivery = 'pending', uri, onDelivery, onState,
}: {
  readonly encounterId: ReviewEncounterId;
  readonly mediaId: AuthoredMediaId;
  readonly initialDelivery?: ReviewDelivery;
  readonly uri: (id: AuthoredMediaId) => Promise<string>;
  readonly onDelivery: (id: ReviewEncounterId, delivery: ReviewDelivery) => Promise<void>;
  readonly onState: (state: AudioState) => void;
}): ReviewAudioDelivery {
  let disposed = false;
  let loaded = false;
  let terminal = false;
  let started = false;
  let writeFailed = false;
  let resolvedUri: string | null = null;
  let writes = Promise.resolve();
  const show = (state: AudioState) => { if (!disposed) onState(state); };
  const commit = (delivery: ReviewDelivery) => {
    writes = writes.then(async () => {
      if (!writeFailed) await onDelivery(encounterId, delivery);
    }).catch((cause: unknown) => {
      writeFailed = true;
      show({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
    });
    return writes;
  };
  async function finish(delivery: 'completed' | 'interrupted' | 'failed', message?: string) {
    if (terminal || writeFailed) { await writes; return; }
    terminal = true;
    show({ kind: 'settling' });
    await commit(delivery);
    if (!writeFailed) {
      show(delivery === 'failed'
        ? { kind: 'failed', message: message ?? 'Audio playback failed.' }
        : { kind: 'settled', delivery });
    }
  }
  return {
    async load() {
      if (loaded || disposed) return;
      loaded = true;
      switch (initialDelivery) {
        case 'completed':
        case 'interrupted':
          terminal = true;
          show({ kind: 'settled', delivery: initialDelivery });
          return;
        case 'failed':
          terminal = true;
          show({ kind: 'failed', message: 'Previous audio playback failed. Retry to play it again.' });
          return;
        case 'started':
          await finish('interrupted');
          return;
        case 'not_required':
        case 'pending':
          break;
      }
      show({ kind: 'loading' });
      await commit('pending');
      if (disposed || terminal || writeFailed) return;
      try {
        resolvedUri = await uri(mediaId);
        if (!disposed && !terminal) show({ kind: 'ready', uri: resolvedUri });
      } catch (cause) {
        if (!disposed && !terminal) {
          await finish('failed', cause instanceof Error ? cause.message : String(cause));
        }
      }
    },
    async playback(event) {
      if (disposed || terminal || writeFailed || resolvedUri === null) return;
      switch (event.kind) {
        case 'started':
          if (started) return;
          started = true;
          show({ kind: 'playing', uri: resolvedUri });
          await commit('started');
          return;
        case 'completed':
          // An ended/error notification without playback is not delivery.
          if (started) await finish('completed');
          return;
        case 'interrupted':
          if (started) await finish('interrupted');
          return;
        case 'failed':
          await finish('failed', event.message);
          return;
      }
    },
    cancel: () => finish('interrupted'),
    dispose() {
      disposed = true;
      if (loaded) void finish('interrupted');
    },
  };
}
