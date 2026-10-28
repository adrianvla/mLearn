import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { AuthoredMediaId, Material, MaterialContent, MaterialCreate, MaterialEdit } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { MaterialMedia } from './MaterialMedia';
import { MaterialFields } from './MaterialFields';
import { mediaImportOf, releaseStaged, type MaterialMediaHost, type StagedMedia } from './media';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';

export function MaterialEditor({ client, authoredMedia, initial, material, onSaved, onPropose }: {
  readonly client: RuntimeClient;
  readonly authoredMedia: MaterialMediaHost | null;
  readonly initial: MaterialContent;
  readonly material?: Material;
  readonly onSaved?: (material: Material) => void;
  readonly onPropose?: (material: Material, trigger: View | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(material);
  const [excluded, setExcluded] = useState(material?.excluded ?? false);
  const [pending, setPending] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const locked = useRef(false);
  const proposeTrigger = useRef<View>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [retry, setRetry] = useState<MaterialCreate | MaterialEdit | null>(null);
  const [duplicates, setDuplicates] = useState<Material[]>([]);
  const [staged, setStaged] = useState<readonly StagedMedia[]>([]);
  const [boundStaged, setBoundStaged] = useState<readonly string[]>([]);
  const stagedRef = useRef<readonly StagedMedia[]>([]);
  stagedRef.current = staged;
  const inFlight = useRef<readonly StagedMedia[] | null>(null);
  const owner = useRef<object | null>({});
  useEffect(() => {
    const scope = {};
    owner.current = scope;
    return () => {
      if (owner.current === scope) owner.current = null;
      // A durable save in flight keeps ownership of its imports and releases
      // them when it settles; everything else is abandoned temp work.
      for (const item of stagedRef.current) if (!inFlight.current?.includes(item)) releaseStaged(item);
    };
  }, []);
  function stage(item: StagedMedia) {
    const replaced = stagedRef.current.find(existing => existing.key === item.key);
    if (replaced) releaseStaged(replaced);
    stagedRef.current = [...stagedRef.current.filter(existing => existing.key !== item.key), item];
    setStaged(stagedRef.current);
    setBoundStaged(previous => previous.filter(key => key !== item.key));
    setReceipt('');
  }
  function discardStaged(key: string) {
    const item = stagedRef.current.find(existing => existing.key === key);
    if (item) releaseStaged(item);
    stagedRef.current = stagedRef.current.filter(existing => existing.key !== key);
    setStaged(stagedRef.current);
    setBoundStaged(previous => previous.filter(value => value !== key));
  }
  function removeAttachment(mediaId: AuthoredMediaId) {
    setDraft(previous => ({ ...previous, attachments: previous.attachments.filter(item => item.mediaId !== mediaId) }));
    setReceipt('');
  }
  async function save(command: MaterialCreate | MaterialEdit, imports: readonly StagedMedia[]) {
    if (locked.current) return;
    locked.current = true;
    const scope = owner.current;
    inFlight.current = imports;
    setPending(true); setError(''); setReceipt(''); setConflict(false); setDuplicates([]);
    try {
      const outcome = 'id' in command ? await client.updateMaterial(command) : await client.createMaterial(command);
      const accepted = outcome.status === 'saved' && !outcome.reused;
      // Saved imports are durable now; the host-owned temp copies are released
      // even when this editor unmounted while the write was in flight.
      if (accepted) for (const item of imports) releaseStaged(item);
      if (!scope || owner.current !== scope) {
        if (!accepted) for (const item of imports) releaseStaged(item);
        return;
      }
      setRetry(null);
      if (accepted) {
        setStaged(previous => previous.filter(item => !imports.includes(item)));
        setBoundStaged(previous => previous.filter(key => !imports.some(item => item.key === key)));
      }
      switch (outcome.status) {
        case 'duplicate': setDuplicates(outcome.items); break;
        case 'saved':
          if (outcome.reused) {
            // Quick capture reuses exact identity. This authoring editor keeps
            // its unsaved fields/imports until the user chooses that existing item.
            setDuplicates([outcome.material]);
            break;
          }
          setBase(outcome.material);
          setDraft(outcome.material.content);
          setExcluded(outcome.material.excluded);
          setReceipt(`${outcome.reused ? 'Reused' : 'Saved'} Material · committed revision ${outcome.committedRevision}${outcome.material.revision !== outcome.committedRevision ? ` · current revision ${outcome.material.revision}` : ''}`);
          onSaved?.(outcome.material);
          break;
      }
    } catch (cause) {
      if (scope && owner.current === scope) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRetry(command);
        setConflict(cause instanceof RuntimeError && cause.code === 'conflict');
      } else for (const item of imports) releaseStaged(item);
    } finally {
      inFlight.current = null;
      locked.current = false;
      if (scope && owner.current === scope) setPending(false);
    }
  }
  function submit(distinct = false) {
    if (mediaPending) return;
    try {
      const prepared = base ? client.prepareMaterialEdit(base, draft, excluded) : client.prepareMaterial(draft, distinct);
      const imports = stagedRef.current;
      const command = imports.length ? { ...prepared, mediaImports: imports.map(item => ({
        ...mediaImportOf(item),
        ...(boundStaged.includes(item.key) ? { audioBinding: {
          packageId: draft.packageId, targetId: draft.targetId, phrase: draft.phrase,
        } } : {}),
      })) } : prepared;
      void save(command, imports);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function reload() {
    if (!base || locked.current) return;
    const scope = owner.current;
    locked.current = true; setPending(true);
    try {
      const latest = await client.material(base.id);
      if (scope && owner.current === scope) {
        // Reload the CAS base while preserving every unsaved authored field.
        setBase(latest); setRetry(null); setConflict(false); setError('');
        setReceipt('Latest revision loaded. Your unsaved fields are retained; review them before saving.');
      }
    } catch (cause) {
      if (scope && owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { locked.current = false; if (scope && owner.current === scope) setPending(false); }
  }
  return <View style={styles.editor}>
    <MaterialFields value={draft} disabled={pending || !!retry} onChange={(update, key) => {
      setDraft(update);
      if (key === 'phrase') setBoundStaged([]);
      setReceipt('');
    }} />
    {authoredMedia ? <MaterialMedia host={authoredMedia} source={draft.source} base={base}
      attachments={draft.attachments} staged={staged} disabled={pending || !!retry}
      canBindAudio={draft.phrase.trim().length > 0} boundStaged={boundStaged}
      onBindStaged={(key, bound) => {
        setBoundStaged(previous => bound ? [...previous.filter(value => value !== key), key] : previous.filter(value => value !== key));
        setReceipt('');
      }}
      onBindAttachment={(mediaId, bound) => {
        setDraft(previous => ({ ...previous, attachments: previous.attachments.map(item => item.mediaId === mediaId
          ? { ...item, audioBinding: bound ? { packageId: previous.packageId, targetId: previous.targetId, phrase: previous.phrase } : null }
          : item) }));
        setReceipt('');
      }}
      onBusyChange={setMediaPending}
      onStage={stage} onDiscardStaged={discardStaged} onRemoveAttachment={removeAttachment} /> : null}
    {base ? <Row><Button label={excluded ? 'Include Material' : 'Exclude Material'} variant="secondary"
      disabled={pending || !!retry} accessibilityState={{ selected: excluded }} onPress={() => setExcluded(value => !value)} />
      <Text variant="caption">{excluded ? 'Excluded from learning' : 'Included in learning'}</Text></Row> : null}
    <Row><Button label={base ? 'Save changes' : 'Save Material'} testID="material-save" busy={pending}
      disabled={!!retry || mediaPending} onPress={() => submit()} />
      {base && onPropose ? <Button ref={proposeTrigger} label="Propose changes to saved Material" variant="secondary"
        disabled={pending || !!retry || mediaPending} onPress={() => onPropose(base, proposeTrigger.current)} /> : null}</Row>
    {receipt ? <Text accessibilityLiveRegion="polite" testID="material-result">{receipt}</Text> : null}
    {error ? <Text accessibilityRole="alert" testID="material-error">{error}</Text> : null}
    {retry ? <Row>
      {conflict ? <Button label="Reload latest revision" disabled={pending} onPress={() => void reload()} />
        : <Button label="Retry save" disabled={pending} onPress={() => void save(retry, stagedRef.current)} />}
      <Button label="Continue editing" variant="secondary" disabled={pending} onPress={() => { setRetry(null); setError(''); }} />
    </Row> : null}
    {duplicates.length ? <View style={styles.reference} testID="material-duplicates">
      <Text>Existing Material found. Choose an existing item or keep this context distinct.</Text>
      {duplicates.map(item => <Button key={item.id} label={`Use existing: ${item.content.phrase}`}
        detail={item.content.context || item.content.meaning} variant="secondary" onPress={() => {
          // The abandoned draft's staged imports were never saved; release them.
          for (const entry of stagedRef.current) releaseStaged(entry);
          setStaged([]);
          setBoundStaged([]);
          setBase(item); setDraft(item.content); setExcluded(item.excluded); setDuplicates([]);
          setReceipt('Existing Material selected.'); onSaved?.(item);
        }} />)}
      <Button label="Keep distinct" disabled={pending} onPress={() => submit(true)} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  editor: { gap: theme.spacing.compact, minWidth: 0 },
  reference: { gap: theme.spacing.small, paddingVertical: theme.spacing.small },
}));
