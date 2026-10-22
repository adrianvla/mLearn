import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { AuthoredMediaId, Material, MaterialAttachment, MaterialMediaKind, MediaCaptureRequest, SourceAnchor } from '@mlearn/contracts';
import { RuntimeError } from '@mlearn/runtime-client';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { Badge } from '@mlearn/ui/badge';
import { Row } from '@mlearn/ui/layout';
import { AttachmentPlayer } from './AttachmentPlayer';
import { MAX_ATTACHMENTS, formatBytes, formatRangeMs, stageFile, type MaterialMediaHost, type StagedMedia } from './media';

type PreviewState =
  | { readonly state: 'pending' }
  | { readonly state: 'ready'; readonly uri: string }
  | { readonly state: 'error'; readonly message: string };

type ExportState =
  | { readonly state: 'pending' }
  | { readonly state: 'done' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'failed'; readonly message: string };

const IMPORT_KINDS = ['image', 'audio', 'video'] as const;

export function MaterialMedia({ host, source, base, attachments, staged, disabled, onStage, onDiscardStaged, onRemoveAttachment, onBusyChange }: {
  readonly host: MaterialMediaHost;
  readonly source: SourceAnchor | null;
  readonly base: Material | undefined;
  readonly attachments: readonly MaterialAttachment[];
  readonly staged: readonly StagedMedia[];
  readonly disabled: boolean;
  readonly onBusyChange: (pending: boolean) => void;
  readonly onStage: (item: StagedMedia) => void;
  readonly onDiscardStaged: (key: string) => void;
  readonly onRemoveAttachment: (mediaId: AuthoredMediaId) => void;
}) {
  const [pickPending, setPickPending] = useState<MaterialMediaKind | null>(null);
  const [capturePending, setCapturePending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [captureRetry, setCaptureRetry] = useState<{ readonly label: string; readonly request: MediaCaptureRequest } | null>(null);
  const [expanded, setExpanded] = useState<AuthoredMediaId | null>(null);
  const [previews, setPreviews] = useState<Readonly<Record<string, PreviewState>>>({});
  const [exportStates, setExportStates] = useState<Readonly<Record<string, ExportState>>>({});
  const abort = useRef<AbortController | null>(null);
  const actionLock = useRef(false);
  const owner = useRef<object | null>(null);
  useEffect(() => {
    if (!staged.length) setNotice('');
  }, [staged.length]);
  useEffect(() => {
    const scope = {};
    owner.current = scope;
    return () => {
      if (owner.current === scope) owner.current = null;
      abort.current?.abort();
    };
  }, []);
  const mediaById = new Map((base?.media ?? []).map(item => [item.id, item]));
  const full = attachments.length + staged.length >= MAX_ATTACHMENTS;
  const busy = disabled || pickPending !== null || capturePending !== null;
  const captures: { readonly label: string; readonly request: MediaCaptureRequest }[] = [];
  if (source) {
    captures.push({
      label: 'Capture frame',
      request: { sourceId: source.sourceId, contentRevision: source.contentRevision, selection: { kind: 'frame', positionMs: source.locator.positionMs } },
    });
    if (source.locator.subtitleRevision !== null && source.locator.cueIndex !== null) {
      const cue = { subtitleRevision: source.locator.subtitleRevision, cueIndex: source.locator.cueIndex };
      for (const mediaKind of IMPORT_KINDS) {
        captures.push({
          label: `Capture cue ${mediaKind}`,
          request: { sourceId: source.sourceId, contentRevision: source.contentRevision, selection: { kind: 'cue', ...cue, mediaKind } },
        });
      }
    }
  }
  async function pick(kind: MaterialMediaKind, replaceMediaId: AuthoredMediaId | null = null) {
    if (actionLock.current || disabled) return;
    actionLock.current = true;
    onBusyChange(true);
    setPickPending(kind); setError(''); setCaptureRetry(null); setNotice('');
    try {
      const picked = await host.pick(kind);
      if (!picked) return;
      if (!owner.current) { await picked.release(); return; }
      onStage(stageFile(picked.path, picked.name, picked.kind, null, picked.release));
      if (replaceMediaId !== null) onRemoveAttachment(replaceMediaId);
      setNotice(replaceMediaId !== null ? 'Replacement staged. Save this Material to keep it.' : `${picked.name} staged. Save this Material to keep it.`);
    } catch (cause) {
      if (owner.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      actionLock.current = false;
      if (owner.current) { setPickPending(null); onBusyChange(false); }
    }
  }
  async function capture(label: string, request: MediaCaptureRequest) {
    if (actionLock.current || disabled) return;
    actionLock.current = true;
    onBusyChange(true);
    const controller = new AbortController();
    abort.current = controller;
    setCapturePending(label); setError(''); setCaptureRetry(null); setNotice('');
    try {
      const result = await host.capture(request, controller.signal);
      if (!owner.current) { await result.release(); return; }
      onStage(stageFile(result.file.path, result.file.name, result.file.kind, result.file.segment, result.release));
      setNotice(`${result.file.name} staged. Save this Material to keep it.`);
    } catch (cause) {
      if (owner.current) {
        if (cause instanceof RuntimeError && cause.code === 'cancelled') setNotice('Capture cancelled.');
        else {
          setError(cause instanceof Error ? cause.message : String(cause));
          setCaptureRetry({ label, request });
        }
      }
    } finally {
      actionLock.current = false;
      abort.current = null;
      if (owner.current) { setCapturePending(null); onBusyChange(false); }
    }
  }
  async function togglePreview(mediaId: AuthoredMediaId) {
    const preview = previews[mediaId];
    if (expanded === mediaId && preview?.state !== 'error') { setExpanded(null); return; }
    setExpanded(mediaId);
    if (preview && preview.state !== 'error') return;
    setPreviews(previous => ({ ...previous, [mediaId]: { state: 'pending' } }));
    try {
      const uri = await host.uri(mediaId);
      if (owner.current) setPreviews(previous => ({ ...previous, [mediaId]: { state: 'ready', uri } }));
    } catch (cause) {
      if (owner.current) setPreviews(previous => ({ ...previous, [mediaId]: { state: 'error', message: cause instanceof Error ? cause.message : String(cause) } }));
    }
  }
  async function exportMedia(mediaId: AuthoredMediaId) {
    if (exportStates[mediaId]?.state === 'pending') return;
    setExportStates(previous => ({ ...previous, [mediaId]: { state: 'pending' } }));
    try {
      const exported = await host.export(mediaId);
      if (owner.current) setExportStates(previous => ({ ...previous, [mediaId]: { state: exported ? 'done' : 'unavailable' } }));
    } catch (cause) {
      if (owner.current) setExportStates(previous => ({ ...previous, [mediaId]: { state: 'failed', message: cause instanceof Error ? cause.message : String(cause) } }));
    }
  }
  function removeSaved(mediaId: AuthoredMediaId) {
    if (expanded === mediaId) setExpanded(null);
    onRemoveAttachment(mediaId);
  }
  return <View style={styles.section}>
    <Text accessibilityRole="header">Media</Text>
    <Row>
      {IMPORT_KINDS.map(kind => <Button key={kind} label={`Import ${kind}`} size="compact" variant="secondary"
        busy={pickPending === kind} disabled={busy || full} onPress={() => void pick(kind)} />)}
    </Row>
    {captures.length ? <Row>
      {captures.map(({ label, request }) => <Button key={label} label={label} size="compact" variant="secondary"
        busy={capturePending === label} disabled={busy || full} onPress={() => void capture(label, request)} />)}
    </Row> : null}
    {capturePending ? <Row>
      <Text accessibilityLiveRegion="polite">{capturePending}…</Text>
      <Button label="Cancel capture" size="compact" variant="quiet" onPress={() => abort.current?.abort()} />
    </Row> : null}
    {full ? <Text variant="caption" muted>Material supports up to {MAX_ATTACHMENTS} attachments.</Text> : null}
    {staged.map(item => <View key={item.key} style={styles.attachment}>
      <Row>
        <Badge label={`Pending ${item.kind}`} />
        <Text selectable>{item.name}</Text>
      </Row>
      {item.segment ? <Text variant="caption" muted>Source range {formatRangeMs(item.segment.startMs, item.segment.endMs)}</Text> : null}
      <Row>
        <Button label={`Remove ${item.name}`} size="compact" variant="quiet" disabled={disabled}
          onPress={() => onDiscardStaged(item.key)} />
      </Row>
    </View>)}
    {attachments.map(attachment => {
      const metadata = mediaById.get(attachment.mediaId);
      const name = metadata?.name ?? attachment.mediaId;
      const preview = previews[attachment.mediaId];
      const exportState = exportStates[attachment.mediaId];
      return <View key={attachment.mediaId} style={styles.attachment}>
        <Row>
          {metadata ? <Badge label={metadata.kind} /> : <Badge label="attachment" />}
          <Text selectable>{name}</Text>
          {metadata ? <Text variant="caption" muted>{formatBytes(metadata.byteLength)}</Text> : null}
        </Row>
        {attachment.segment ? <Text variant="caption" muted>Source range {formatRangeMs(attachment.segment.startMs, attachment.segment.endMs)}</Text> : null}
        <Row>
          {metadata ? <Button label={`Preview ${name}`} size="compact" variant="secondary"
            accessibilityState={{ expanded: expanded === attachment.mediaId }}
            onPress={() => void togglePreview(attachment.mediaId)} /> : null}
          {metadata ? <Button label={`Replace ${name}`} size="compact" variant="secondary" disabled={busy}
            onPress={() => void pick(metadata.kind, attachment.mediaId)} /> : null}
          {metadata ? <Button label={`Export ${name}`} size="compact" variant="secondary" disabled={busy || exportState?.state === 'pending'}
            onPress={() => void exportMedia(attachment.mediaId)} /> : null}
          <Button label={`Remove ${name}`} size="compact" variant="quiet" disabled={disabled}
            onPress={() => removeSaved(attachment.mediaId)} />
        </Row>
        {expanded === attachment.mediaId && preview?.state === 'pending' ? <Text accessibilityLiveRegion="polite">Loading preview…</Text> : null}
        {expanded === attachment.mediaId && preview?.state === 'error' ? <Text accessibilityRole="alert">{preview.message}</Text> : null}
        {expanded === attachment.mediaId && preview?.state === 'ready' && metadata ? (
          metadata.kind === 'image'
            ? <Image source={{ uri: preview.uri }} style={styles.image} resizeMode="contain" accessibilityLabel={name} />
            : <AttachmentPlayer uri={preview.uri} label={name} height={metadata.kind === 'audio' ? 64 : 200} />
        ) : null}
        {exportState?.state === 'pending' ? <Text accessibilityLiveRegion="polite" variant="caption">Exporting {name}…</Text> : null}
        {exportState?.state === 'done' ? <Text accessibilityLiveRegion="polite" variant="caption">Exported {name}.</Text> : null}
        {exportState?.state === 'unavailable' ? <Text variant="caption" muted>Export of {name} was cancelled or is unavailable on this host.</Text> : null}
        {exportState?.state === 'failed' ? <Text accessibilityRole="alert" variant="caption">{exportState.message}</Text> : null}
      </View>;
    })}
    {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
    {error ? <View style={styles.feedback}>
      <Text accessibilityRole="alert">{error}</Text>
      {captureRetry ? <Button label={`Retry ${captureRetry.label}`} size="compact" disabled={busy}
        onPress={() => void capture(captureRetry.label, captureRetry.request)} /> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  section: { gap: theme.spacing.compact, minWidth: 0 },
  attachment: { gap: theme.spacing.small, paddingVertical: theme.spacing.small, borderTopWidth: 1, borderTopColor: theme.colors.border },
  image: { width: '100%', height: 200, borderRadius: theme.radius, backgroundColor: theme.colors.surface },
  feedback: { gap: theme.spacing.small },
}));
