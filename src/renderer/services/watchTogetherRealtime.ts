import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';

import { getLogger } from '../../shared/utils/logger';

const log = getLogger('renderer.services.watchTogetherRealtime');

const clientCache = new Map<string, SupabaseClient>();

function getOrCreateClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
  const key = `${supabaseUrl}::${supabaseAnonKey}`;
  let client = clientCache.get(key);
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    clientCache.set(key, client);
  }
  return client;
}

export function subscribeToWatchTogetherRoom(
  supabaseUrl: string,
  supabaseAnonKey: string,
  roomId: string,
  accessToken: string,
  callback: (row: Record<string, unknown>) => void,
): () => void {
  const client = getOrCreateClient(supabaseUrl, supabaseAnonKey);

  client.realtime.setAuth(accessToken);

  const channelName = `watch-together-room-${roomId}`;

  const channel: RealtimeChannel = client.channel(channelName, {
    config: {
      broadcast: { self: false },
    },
  });

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'watch_together_rooms', filter: `id=eq.${roomId}` },
    (payload) => {
      if (payload.new) {
        callback(payload.new as Record<string, unknown>);
      }
    },
  );

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      log.debug(`[WatchTogetherRealtime] Subscribed to room ${roomId}`);
    } else if (status === 'CHANNEL_ERROR') {
      log.error(`[WatchTogetherRealtime] Channel error for room ${roomId}`);
    } else if (status === 'TIMED_OUT') {
      log.warn(`[WatchTogetherRealtime] Subscription timed out for room ${roomId}`);
    }
  });

  return () => {
    void client.removeChannel(channel);
    log.debug(`[WatchTogetherRealtime] Unsubscribed from room ${roomId}`);
  };
}