import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import type { PackageInstallCommand, PackageInstallStatus } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';

export function usePackageInstall(client: RuntimeClient | null, enabled: boolean, onInstalled: () => Promise<void>) {
  const [command, setCommand] = useState<PackageInstallCommand | null>(null);
  const [status, setStatus] = useState<PackageInstallStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelRequested, setCancelRequested] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const mounted = useRef(true);
  const current = useRef<PackageInstallCommand | null>(null);
  const observed = useRef<PackageInstallStatus | null>(null);
  const pending = useRef(false);
  const cancelling = useRef(false);
  const generation = useRef(0);
  const reading = useRef<{
    readonly request: Promise<PackageInstallStatus | null>;
    readonly generation: number;
  } | null>(null);
  const refreshed = useRef<string | null>(null);
  const refreshCommand = useRef<string | null>(null);
  const refresh = useRef(onInstalled);
  refresh.current = onInstalled;

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { mounted.current = false; subscription.remove(); };
  }, []);

  const refreshInstalled = useCallback(async (commandId: string) => {
    refreshCommand.current = commandId;
    if (refreshed.current === commandId) return;
    refreshed.current = commandId;
    try {
      await refresh.current();
      if (mounted.current) setRefreshError(null);
    } catch (cause: unknown) {
      refreshed.current = null;
      if (mounted.current) setRefreshError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!client || !enabled || !foreground) return;
    const runtime = client;
    generation.current++;
    setReady(false);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function readStatus() {
      try {
        // A returning focus reuses the outstanding read rather than queuing another.
        const read = reading.current ?? { request: runtime.currentPackageInstall(), generation: generation.current };
        reading.current = read;
        let value: PackageInstallStatus | null;
        try { value = await read.request; }
        finally { if (reading.current === read) reading.current = null; }
        if (!active) return;
        if (read.generation !== generation.current) {
          void readStatus();
          return;
        }
        setReadError(null);
        setReady(true);
        // An earlier read may still describe the previous job during admission.
        if (pending.current && current.current && value?.command.commandId !== current.current.commandId) {
          timer = setTimeout(() => void readStatus(), 500);
          return;
        }
        if (value) {
          if (current.current?.commandId !== value.command.commandId) {
            setInstallError(null);
            setCancelError(null);
            setCancelRequested(null);
          }
          current.current = value.command;
          observed.current = value;
          setCommand(value.command);
          setStatus(value);
          if (value.phase === 'succeeded') void refreshInstalled(value.command.commandId);
        } else if (!current.current) {
          observed.current = null;
          setStatus(null);
        } else {
          setReadError('No native status is available for this install. Retry status before starting another.');
          return;
        }
        if (value?.phase === 'downloading' || value?.phase === 'validating') {
          timer = setTimeout(() => void readStatus(), 500);
        }
      } catch (cause: unknown) {
        if (active) setReadError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    void readStatus();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [client, enabled, foreground, readVersion, refreshInstalled]));

  async function submit(prepared: PackageInstallCommand) {
    if (!client || pending.current) return;
    const fresh = current.current?.commandId !== prepared.commandId;
    pending.current = true;
    generation.current++;
    current.current = prepared;
    setCommand(prepared);
    if (fresh) {
      observed.current = null;
      setStatus(null);
      setCancelError(null);
      setCancelRequested(null);
    }
    setSubmitting(true);
    setInstallError(null);
    setReadVersion(value => value + 1);
    try {
      await client.installPackage(prepared);
    } catch (cause: unknown) {
      if (mounted.current && !(cause instanceof RuntimeError && cause.code === 'cancelled'))
        setInstallError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      generation.current++;
      if (mounted.current) {
        setSubmitting(false);
        setReadVersion(value => value + 1);
      }
    }
  }

  async function cancel() {
    const value = observed.current;
    if (!client || !value || cancelling.current || (value.phase !== 'downloading' && value.phase !== 'validating')) return;
    const commandId = value.command.commandId;
    cancelling.current = true;
    generation.current++;
    setCancelRequested(commandId);
    setCancelError(null);
    try {
      const result = await client.cancelPackageInstall(commandId);
      if (!mounted.current || current.current?.commandId !== commandId) return;
      if (result) {
        observed.current = result;
        setStatus(result);
        if (result.phase === 'succeeded') void refreshInstalled(commandId);
      } else {
        setCancelError('Native cancellation was not acknowledged. Retry status.');
      }
    } catch (cause: unknown) {
      if (mounted.current) setCancelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      cancelling.current = false;
      generation.current++;
      if (mounted.current) setReadVersion(value => value + 1);
    }
  }

  const terminal = status?.phase === 'succeeded' || status?.phase === 'failed' || status?.phase === 'cancelled';
  return {
    command, status, submitting, cancelRequested, installError, readError, cancelError, refreshError,
    canStart: ready && !readError && !submitting && (!command || terminal),
    canReplay: !!command && !!installError && !submitting && !terminal,
    start(pluginId: string) {
      if (client && ready && !readError && !pending.current && (!current.current || terminal)) {
        void submit(client.prepareInstall(pluginId));
      }
    },
    replay() { if (command && !pending.current && !terminal) void submit(command); },
    cancel,
    retryRead() { setReadVersion(value => value + 1); },
    retryRefresh() { if (refreshCommand.current) void refreshInstalled(refreshCommand.current); },
  };
}
