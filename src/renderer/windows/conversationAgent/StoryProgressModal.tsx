import { For, Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { progressSummary, type StoryAdvanceRecord, type StorySource, type StoryTrack, type StoryTrackDraft } from '../../../shared/story';
import type { WorldSnapshot } from '../../../shared/world';
import { Button, FormField, Input, Modal, Select, ToggleSwitch } from '../../components/common';
import { useLocalization } from '../../context';
import './StoryProgressModal.css';

const blank = (): StoryTrackDraft => ({ title: '', edition: '', unitLabel: '', completed: [], sources: [], relations: [], autoAdvance: false });

export const StoryProgressModal: Component<{ initialTrackId?: string; generationAvailable?: boolean; onRequestGenerationAccess?: () => boolean; world: WorldSnapshot; onClose: () => void; onRefresh: () => Promise<void> }> = (props) => {
  const { t } = useLocalization();
  const [selectedId, setSelectedId] = createSignal('');
  const [draft, setDraft] = createSignal<StoryTrackDraft>(blank());
  const [revision, setRevision] = createSignal<number>();
  const [unit, setUnit] = createSignal('');
  const [sourceUrl, setSourceUrl] = createSignal('');
  const [sourceFrom, setSourceFrom] = createSignal('');
  const [sourceTo, setSourceTo] = createSignal('');
  const [advance, setAdvance] = createSignal<StoryAdvanceRecord>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [dirty, setDirty] = createSignal(false);
  let disposed = false;
  let runningAdvanceId = '';
  onCleanup(() => {
    disposed = true;
    if (runningAdvanceId) void getBridge().world.cancelStoryAdvance(runningAdvanceId);
  });
  const current = (): StoryTrack | undefined => props.world.storyTracks?.find(track => track.id === selectedId());
  const choose = (track?: StoryTrack): void => {
    setSelectedId(track?.id ?? '');
    setRevision(track?.revision);
    setDraft(track ? { title: track.title, edition: track.edition, collection: track.collection, unitLabel: track.unitLabel,
      totalUnits: track.totalUnits, unitNames: track.unitNames, completed: track.completed, sources: track.sources,
      relations: track.relations, sourceWiki: track.sourceWiki, externalUrl: track.externalUrl, autoAdvance: track.autoAdvance,
      archived: track.archived } : blank());
    setAdvance(undefined); setError(''); setDirty(false);
  };
  onMount(() => { if (props.initialTrackId) choose(props.world.storyTracks?.find(track => track.id === props.initialTrackId)); });
  const change = <K extends keyof StoryTrackDraft>(key: K, value: StoryTrackDraft[K]): void => { setDraft(previous => ({ ...previous, [key]: value })); setDirty(true); };
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy()) return;
    setBusy(true); setError('');
    try { await work(); }
    catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!disposed) setBusy(false); }
  };
  const save = (): void => { void run(async () => {
    const track = await getBridge().world.saveStoryTrack({ id: selectedId() || undefined, expectedRevision: revision(), track: draft() });
    await props.onRefresh(); choose(track);
  }); };
  const setProgress = (kind: 'through' | 'complete' | 'remove'): void => { void run(async () => {
    const track = current();
    const value = Number(unit());
    if (!track || !Number.isSafeInteger(value)) throw new Error(t('mlearn.ConversationAgent.Story.ValidUnit'));
    const updated = await getBridge().world.setStoryProgress({ trackId: track.id, expectedRevision: track.revision, change: { kind, unit: value } });
    await props.onRefresh(); choose(updated); setUnit('');
  }); };
  const addSource = (): void => {
    const from = Number(sourceFrom()), to = Number(sourceTo());
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || !sourceUrl().trim()) { setError(t('mlearn.ConversationAgent.Story.ValidSource')); return; }
    const source: StorySource = { id: crypto.randomUUID(), url: sourceUrl().trim(), from, to, confirmed: true };
    change('sources', [...draft().sources, source]); setSourceUrl(''); setSourceFrom(''); setSourceTo(''); setError('');
  };
  const prepare = (): void => {
    if (props.onRequestGenerationAccess?.() === false || props.generationAvailable === false) return;
    void run(async () => {
      const track = current();
      if (!track) return;
      runningAdvanceId = crypto.randomUUID();
      const record = await getBridge().world.prepareStoryAdvance({ operationId: runningAdvanceId, trackId: track.id, expectedRevision: track.revision });
      runningAdvanceId = '';
      if (!disposed) { setAdvance(record); await props.onRefresh(); }
    });
  };
  const apply = (): void => { void run(async () => {
    const record = advance();
    if (!record || dirty()) return;
    setAdvance(await getBridge().world.applyStoryAdvance(record.id));
    await props.onRefresh();
  }); };

  return <Modal isOpen onClose={props.onClose} title={t('mlearn.ConversationAgent.Story.Title')} size="lg" fullHeight>
    <div class="story-progress">
      <div class="story-progress-list">
        <Select aria-label={t('mlearn.ConversationAgent.Story.Track')} value={selectedId()} disabled={busy()} onChange={event => choose(props.world.storyTracks?.find(item => item.id === event.currentTarget.value))}
          options={[{ value: '', label: t('mlearn.ConversationAgent.Story.NewTrack') }, ...(props.world.storyTracks ?? []).filter(item => !item.archived).map(item => ({ value: item.id, label: `${item.title} · ${item.edition}` }))]} />
      </div>
      <div class="story-progress-grid">
        <FormField label={t('mlearn.ConversationAgent.Story.Work')}><Input value={draft().title} disabled={busy()} onInput={event => change('title', event.currentTarget.value)} /></FormField>
        <FormField label={t('mlearn.ConversationAgent.Story.Edition')}><Input value={draft().edition} disabled={busy()} onInput={event => change('edition', event.currentTarget.value)} /></FormField>
        <FormField label={t('mlearn.ConversationAgent.Story.Unit')}><Input value={draft().unitLabel} disabled={busy()} onInput={event => change('unitLabel', event.currentTarget.value)} /></FormField>
        <FormField label={t('mlearn.ConversationAgent.Story.Total')}><Input type="number" min="1" value={draft().totalUnits ?? ''} disabled={busy()} onInput={event => change('totalUnits', event.currentTarget.value ? Number(event.currentTarget.value) : undefined)} /></FormField>
      </div>
      <FormField label={t('mlearn.ConversationAgent.Story.SourceWiki')}><Input type="url" value={draft().sourceWiki ?? ''} disabled={busy()} onInput={event => change('sourceWiki', event.currentTarget.value || undefined)} /></FormField>
      <ToggleSwitch label={t('mlearn.ConversationAgent.Story.AutoAdvance')} checked={draft().autoAdvance} disabled={busy()} onChange={value => change('autoAdvance', value)} />
      <div class="story-progress-actions"><Button variant="primary" disabled={busy() || !draft().title.trim() || !draft().edition.trim() || !draft().unitLabel.trim()} onClick={save}>{t('mlearn.ConversationAgent.Details.Save')}</Button></div>
      <Show when={dirty() && current()}><p class="story-progress-note">{t('mlearn.ConversationAgent.Story.SaveBeforeUse')}</p></Show>
      <Show when={current()}>{track => <>
        <section class="story-progress-section">
          <h3>{t('mlearn.ConversationAgent.Story.Progress')}</h3>
          <p>{progressSummary(track().completed).count} / {track().totalUnits ?? '–'} {track().unitLabel}</p>
          <div class="story-progress-inline"><Input type="number" min="0" value={unit()} disabled={busy()} onInput={event => setUnit(event.currentTarget.value)} aria-label={t('mlearn.ConversationAgent.Story.UnitNumber')} />
            <Button size="sm" disabled={busy() || dirty()} onClick={() => setProgress('through')}>{t('mlearn.ConversationAgent.Story.Through')}</Button>
            <Button size="sm" disabled={busy() || dirty()} onClick={() => setProgress('complete')}>{t('mlearn.ConversationAgent.Story.Complete')}</Button>
            <Button size="sm" variant="ghost" disabled={busy() || dirty()} onClick={() => setProgress('remove')}>{t('mlearn.ConversationAgent.Story.Remove')}</Button>
          </div>
        </section>
        <section class="story-progress-section">
          <h3>{t('mlearn.ConversationAgent.Story.Sources')}</h3>
          <For each={draft().sources}>{source => <div class="story-progress-source"><span>{source.from}–{source.to} · {source.url}</span>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => change('sources', draft().sources.filter(item => item.id !== source.id))}>{t('mlearn.ConversationAgent.Story.Remove')}</Button></div>}</For>
          <div class="story-progress-source-form"><Input type="url" value={sourceUrl()} disabled={busy()} onInput={event => setSourceUrl(event.currentTarget.value)} placeholder="https://" aria-label={t('mlearn.ConversationAgent.Story.SourceUrl')} />
            <Input type="number" min="1" value={sourceFrom()} disabled={busy()} onInput={event => setSourceFrom(event.currentTarget.value)} aria-label={t('mlearn.ConversationAgent.Story.From')} />
            <Input type="number" min="1" value={sourceTo()} disabled={busy()} onInput={event => setSourceTo(event.currentTarget.value)} aria-label={t('mlearn.ConversationAgent.Story.To')} />
            <Button size="sm" disabled={busy()} onClick={addSource}>{t('mlearn.ConversationAgent.Story.AddSource')}</Button></div>
          <p class="story-progress-note">{t('mlearn.ConversationAgent.Story.SourceHint')}</p>
        </section>
        <section class="story-progress-section">
          <h3>{t('mlearn.ConversationAgent.Story.UpdatePeople')}</h3>
          <For each={(props.world.storyAdvances ?? []).filter(item => item.trackId === track().id).slice(-3).reverse()}>{record =>
            <p class="story-progress-note">{record.status}{record.error ? ` · ${record.error}` : ''}</p>}</For>
          <Button disabled={busy() || dirty() || !track().sources.length} onClick={prepare}>{t('mlearn.ConversationAgent.Story.ReviewUpdate')}</Button>
          <Show when={advance()}>{record => <div class="story-progress-review" role="status">
            <p>{record().status === 'ready' ? t('mlearn.ConversationAgent.Story.Ready') : record().error ?? record().status}</p>
            <For each={record().proposals}>{proposal => <div class="story-progress-proposal">
              <strong>{props.world.participants.find(person => person.id === proposal.participantId)?.displayName ?? proposal.participantId}</strong>
              <p>{proposal.canon.baseline.context}</p>
            </div>}</For>
            <Show when={record().status === 'ready'}><Button variant="primary" disabled={busy() || dirty()} onClick={apply}>{t('mlearn.ConversationAgent.Story.ApplyUpdate')}</Button></Show>
          </div>}</Show>
        </section>
      </>}</Show>
      <Show when={error()}><p class="story-progress-error" role="alert">{error()}</p></Show>
    </div>
  </Modal>;
};
