import { useEffect, useRef, useState } from 'react';
import type { ReviewCommand } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import type { CaptureCandidate } from './CaptureList';
import { prepareSourcePractice } from './sourcePractice';

/** A view owns cancellation; an uncertain native admission retains its intent. */
export function useSourcePractice(client: RuntimeClient, candidates: readonly CaptureCandidate[],
  scope: string, onStarted: (sessionId: string) => void) {
  const identity = JSON.stringify([scope, candidates.map(({ key, content }) => [key, content.packageRevision,
    content.source?.sourceId, content.source?.contentRevision, content.source?.locator])]);
  const current = useRef(identity); current.current = identity;
  const owner = useRef<object | null>(null);
  const operation = useRef<AbortController | null>(null);
  const command = useRef<ReviewCommand | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  useEffect(() => {
    const next = {}; owner.current = next;
    command.current = null; setPending(false); setError(''); setRetry(false);
    return () => {
      if (owner.current === next) {
        owner.current = null; operation.current?.abort(); operation.current = null;
      }
    };
  }, [client, identity]);
  async function start() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const capturedOwner = owner.current;
    const active = () => capturedOwner !== null && owner.current === capturedOwner && current.current === identity;
    setPending(true); setError('');
    try {
      const prepared = command.current ?? await prepareSourcePractice(client, candidates, controller.signal);
      if (!active()) return;
      command.current = prepared;
      const { session } = await client.review(prepared);
      if (!active()) return;
      command.current = null; setRetry(false);
      onStarted(session.id);
    } catch (cause) {
      if (active()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRetry(command.current !== null);
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (active()) setPending(false);
    }
  }
  return { pending, error, retry, start };
}
