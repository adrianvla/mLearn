import { Button, Drawer, useOverlayState } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../api/client';
import type { HistoryEventPage } from '../../api/types';

const api = new ApiClient();

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  groupId: string | null;
  from: number;
  to: number;
}

export function HistoryDrawer({ open, onOpenChange, groupId, from, to }: HistoryDrawerProps) {
  const state = useOverlayState({ isOpen: open, onOpenChange });
  const [page, setPage] = useState<HistoryEventPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string, append = false, signal?: AbortSignal) => {
    if (groupId === null) return;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ groupId, from: String(from), to: String(to), limit: '50' });
    if (cursor !== undefined) query.set('cursor', cursor);
    try {
      const next = await api.get<HistoryEventPage>(`/api/analytics/history/events?${query.toString()}`, { signal });
      if (!signal?.aborted) setPage((current) => append && current !== null ? { ...next, items: [...current.items, ...next.items] } : next);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'The request did not complete.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [from, groupId, to]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPage(null);
    void load(undefined, false, controller.signal);
    return () => controller.abort();
  }, [load, open]);

  if (!open) return null;
  const loaded = page?.items.length ?? 0;
  return <Drawer state={state}>
    <Drawer.Trigger className="sr-only">Recorded events</Drawer.Trigger>
    <Drawer.Backdrop>
      <Drawer.Content placement="right">
        <Drawer.Dialog aria-label="Recorded events">
          <Drawer.Header>
            <Drawer.Heading>Recorded events</Drawer.Heading>
            <Drawer.CloseTrigger aria-label="Close recorded events" />
          </Drawer.Header>
          <Drawer.Body>
            <p>{formatDate(from)} – {formatDate(to)}</p>
            {page !== null ? <>
              <p>{loaded} of {page.total} recorded event{page.total === 1 ? '' : 's'}</p>
              {page.coverage === 'rawExpired' ? <p role="status">Some raw activity events have expired under the retention policy. This drawer only shows the factual events that remain available.</p> : null}
              {page.items.length === 0 ? <p role="status">No retained factual events are available for this period.</p> : <div className="table-scroll"><table aria-label="Recorded event details"><thead><tr><th scope="col">Occurred</th><th scope="col">Kind</th><th scope="col">Event</th><th scope="col">Learner</th><th scope="col">Recorded context</th></tr></thead><tbody>{page.items.map((event) => <tr key={event.id}><td>{formatDate(event.occurredAt)}</td><td>{event.activityKind}</td><td>{event.eventType}</td><td>{event.learnerId ?? 'Not recorded'}</td><td>{formatContext(event)}</td></tr>)}</tbody></table></div>}
              {page.nextCursor !== null ? <Button isDisabled={loading} onPress={() => void load(page.nextCursor, true)} aria-label="Load more events">Load more events</Button> : null}
            </> : null}
            {loading ? <p role="status">Loading recorded events.</p> : null}
            {error !== null ? <p role="alert">Unable to load recorded events. {error}</p> : null}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  </Drawer>;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString();
}

function formatContext(event: HistoryEventPage['items'][number]): string {
  const parts = [event.contentTitle, event.readerPage === null ? null : `Reader page ${event.readerPage}`, event.videoTimeMillis === null ? null : `Video ${event.videoTimeMillis} ms`].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'No content or progress context recorded' : parts.join(' · ');
}
