import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiClient } from '../api/client';
import type { AuthorizedGroupNode, Capability } from '../api/types';
import { useAuth } from '../auth/AuthProvider';

export const GROUP_STORAGE_KEY = 'mlearn-management-group';

export interface GroupScopeApi {
  activateGroup(id: string, signal?: AbortSignal): Promise<void>;
}

interface ReadyGroupScope {
  status: 'ready';
  error: null;
  groups: AuthorizedGroupNode[];
  selectedGroup: AuthorizedGroupNode | null;
  selectGroup(id: string): Promise<void>;
  can(capability: Capability): boolean;
}

export type GroupScopeValue = ReadyGroupScope | {
  status: 'loading' | 'signedOut';
  error: null;
  groups: AuthorizedGroupNode[];
  selectedGroup: null;
} | {
  status: 'error';
  error: Error;
  groups: AuthorizedGroupNode[];
  selectedGroup: null;
};

const GroupScopeContext = createContext<GroupScopeValue | null>(null);
const defaultApi = new ApiClient();

export function GroupScopeProvider({ children, api = defaultApi }: { children: ReactNode; api?: GroupScopeApi }) {
  const auth = useAuth();
  const groups = auth.status === 'authenticated' ? auth.user.groups : [];
  const [selectedGroup, setSelectedGroup] = useState<AuthorizedGroupNode | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signedOut' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);

  const activate = useCallback(async (group: AuthorizedGroupNode, signal?: AbortSignal) => {
    setSelectedGroup(null);
    setStatus('loading');
    setError(null);
    try {
      await api.activateGroup(group.id, signal);
      if (signal?.aborted) return;
      localStorage.setItem(GROUP_STORAGE_KEY, group.id);
      setSelectedGroup(group);
      setStatus('ready');
    } catch (caught) {
      if (signal?.aborted) return;
      setStatus('error');
      setError(caught instanceof Error ? caught : new Error('Group activation failed'));
    }
  }, [api]);

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      setSelectedGroup(null);
      setStatus(auth.status === 'signedOut' ? 'signedOut' : 'loading');
      return;
    }
    const persisted = localStorage.getItem(GROUP_STORAGE_KEY);
    const persistedGroup = groups.find((group) => group.id === persisted);
    if (persisted !== null && persistedGroup === undefined) localStorage.removeItem(GROUP_STORAGE_KEY);
    const next = persistedGroup ?? groups[0] ?? null;
    if (next === null) {
      setSelectedGroup(null);
      setStatus('ready');
      return;
    }
    const controller = new AbortController();
    void activate(next, controller.signal);
    return () => controller.abort();
  }, [activate, auth.status, groups]);

  const selectGroup = useCallback(async (id: string) => {
    const group = groups.find((candidate) => candidate.id === id);
    if (group === undefined) {
      localStorage.removeItem(GROUP_STORAGE_KEY);
      throw new Error('Selected group is no longer authorized');
    }
    await activate(group);
  }, [activate, groups]);

  const value = useMemo<GroupScopeValue>(() => {
    if (status === 'ready') return {
      status, error: null, groups, selectedGroup, selectGroup,
      can: (capability) => selectedGroup?.capabilities.includes(capability) ?? false,
    };
    if (status === 'error') return { status, error: error ?? new Error('Group activation failed'), groups, selectedGroup: null };
    return { status, error: null, groups, selectedGroup: null };
  }, [error, groups, selectGroup, selectedGroup, status]);

  return <GroupScopeContext.Provider value={value}>{status === 'ready' ? <div key={selectedGroup?.id ?? 'no-group'}>{children}</div> : children}</GroupScopeContext.Provider>;
}

export function useGroupScope(): GroupScopeValue {
  const value = useContext(GroupScopeContext);
  if (value === null) throw new Error('useGroupScope must be used inside GroupScopeProvider');
  return value;
}
