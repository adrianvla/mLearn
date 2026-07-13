import { Button, Popover } from '@heroui/react';
import { Bell, Check, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiClient } from '../api/client';

type Notification = {
  fingerprint: string;
  kind: string;
  severity: string;
  groupId: string;
  message: string;
  href: string;
  createdAt: number;
  read: boolean;
  dismissed: boolean;
};

const api = new ApiClient();

export function NotificationMenu({ groupId }: { groupId: string | null }) {
  const location = useLocation();
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    if (!groupId) {
      setItems([]);
      return;
    }
    try {
      const result = await api.get<{ items: Notification[] }>(`/api/notifications?groupId=${encodeURIComponent(groupId)}`);
      setItems(result.items);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load notifications');
    }
  };
  useEffect(() => { void refresh(); }, [groupId, location.pathname]);
  const update = async (fingerprint: string, patch: { read?: boolean; dismissed?: boolean }) => {
    if (!groupId) return;
    try {
      await api.get(`/api/notifications/${encodeURIComponent(fingerprint)}?groupId=${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setItems((current) => current.map((item) => item.fingerprint === fingerprint ? { ...item, ...patch } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update notification');
    }
  };
  const visible = items.filter((item) => !item.dismissed);
  const unread = visible.filter((item) => !item.read).length;
  return (
    <Popover>
      <Button isIconOnly variant="ghost" aria-label={`Notifications (${unread} unread)`} className="notification-trigger">
        <Bell />
        {unread > 0 ? <span className="notification-count" aria-hidden="true">{unread}</span> : null}
      </Button>
      <Popover.Content className="notification-popover">
        <Popover.Dialog>
          <div className="notification-popover__header">
            <strong>Notifications</strong>
            <Button isIconOnly variant="ghost" aria-label="Refresh notifications" onPress={() => void refresh()}><RefreshCw /></Button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <ul aria-label="Notifications" className="notification-list">
            {visible.map((item) => <li key={item.fingerprint}>
              <article className="notification-item">
                <Link to={item.href} onClick={() => void update(item.fingerprint, { read: true })}>{item.message}</Link>
                <div className="notification-item__actions">
                  {!item.read ? <Button isIconOnly variant="ghost" aria-label="Mark notification as read" onPress={() => void update(item.fingerprint, { read: true })}><Check /></Button> : null}
                  <Button isIconOnly variant="ghost" aria-label="Dismiss notification" onPress={() => void update(item.fingerprint, { dismissed: true })}><X /></Button>
                </div>
              </article>
            </li>)}
          </ul>
          {visible.length === 0 ? <p className="notification-empty">No current notifications.</p> : null}
          <Link className="notification-view-all" to="/governance">View all</Link>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
