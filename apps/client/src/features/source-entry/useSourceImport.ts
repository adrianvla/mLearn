import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { useRuntime } from '../../bootstrap/RuntimeProvider';

type ImportKind = 'video' | 'document' | 'images' | 'folder';

/** Own picker/staging/session lifetimes for Home drops and source entry screens. */
export function useSourceImport(packageId: string) {
  const host = useRuntime();
  const router = useRouter();
  const busyRef = useRef(false);
  const intent = useRef<object | null>(null);
  const session = useRef<ReturnType<RuntimeClient['beginSourceSession']> | null>(null);
  const selection = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<ImportKind | null>(null);
  const [error, setError] = useState('');
  const cancel = useCallback(() => {
    intent.current = null;
    selection.current?.abort();
    void session.current?.cancel().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);
  useFocusEffect(useCallback(() => () => cancel(), [cancel, host, packageId]));

  async function run(kind: ImportKind, operation: (current: () => boolean) => Promise<void>) {
    if (!host.available || busyRef.current) return;
    if (!packageId) {
      setError('Select a language package before opening a source.');
      return;
    }
    busyRef.current = true;
    const ownedIntent = {};
    const ownedSession = host.client.beginSourceSession();
    intent.current = ownedIntent;
    session.current = ownedSession;
    const current = () => intent.current === ownedIntent && ownedSession.isCurrent();
    setBusy(true);
    setOpening(kind);
    setError('');
    try {
      await ownedSession.ready;
      if (current()) await operation(current);
    } catch (cause: unknown) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (intent.current === ownedIntent) intent.current = null;
      if (session.current === ownedSession) session.current = null;
      busyRef.current = false;
      setBusy(false);
      setOpening(null);
    }
  }

  async function openVideo(droppedPath?: string) {
    if (!host.available) return;
    await run('video', async current => {
      const path = droppedPath ?? await host.media.pick(false);
      if (!path) return;
      try {
        if (!current()) return;
        const opened = await host.client.openSource(path, packageId);
        if (current()) router.push({ pathname: '/watch', params: { id: opened.source.id } });
      } finally {
        if (!droppedPath) await host.media.releasePicked(path);
      }
    });
  }

  async function openDocument(droppedPath?: string) {
    if (!host.available) return;
    await run('document', async current => {
      const path = droppedPath ?? await host.documents.pick();
      if (!path) return;
      try {
        if (!current()) return;
        const opened = await host.client.openDocument(path, packageId);
        if (current()) router.push({ pathname: '/reader', params: { id: opened.source.id } });
      } finally {
        if (!droppedPath) await host.documents.releasePicked(path);
      }
    });
  }

  async function openImages(folder: boolean, droppedPaths?: string[]) {
    if (!host.available) return;
    await run(folder ? 'folder' : 'images', async current => {
      const controller = new AbortController();
      selection.current = controller;
      try {
        const picked = droppedPaths ? null : await host.documents.pickImages(folder, controller.signal);
        const paths = droppedPaths ?? picked?.paths;
        if (!paths) return;
        try {
          if (!current() || controller.signal.aborted) return;
          const opened = await host.client.importImages(paths, picked?.title ?? 'Image collection', packageId);
          if (current() && !controller.signal.aborted)
            router.push({ pathname: '/reader', params: { id: opened.source.id } });
        } finally {
          await picked?.release();
        }
      } finally {
        if (selection.current === controller) selection.current = null;
      }
    });
  }

  useFocusEffect(useCallback(() => {
    if (!host.available || !host.media.subscribeDrop) return;
    let active = true;
    let stop: (() => void) | undefined;
    host.media.subscribeDrop(paths => {
      if (!active) return;
      if (paths.length && paths.every(path => /\.(?:png|jpe?g|gif|webp)$/i.test(path))) {
        void openImages(false, paths);
      } else if (paths.length !== 1) {
        setError('Drop one video or document at a time.');
      } else if (/\.(?:txt|epub|pdf)$/i.test(paths[0])) {
        void openDocument(paths[0]);
      } else {
        void openVideo(paths[0]);
      }
    }).then(unsubscribe => {
      if (active) stop = unsubscribe;
      else unsubscribe();
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; stop?.(); };
  }, [host, packageId]));

  return { busy, opening, error, openVideo, openDocument, openImages, cancel };
}
