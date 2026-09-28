/** One profile editor for both adding contacts and editing canonical participants. */
import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import type { Participant, CanonAnchor } from '../../../shared/world';
import { formatProgress, type StoryTrack } from '../../../shared/story';
import type { CharacterResearchResult } from '../../../shared/characterIdentity';
import type { WorldBridge } from '../../../shared/bridges/types';
import { getBridge } from '../../../shared/bridges';
import { Avatar, Button, Disclosure, FormField, HintText, Input, ModalForm, Select, Textarea, ToggleSwitch, VoiceSamplePicker } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { resizeProfilePhoto } from '../../utils/profilePhoto';
import './ParticipantEditorModal.css';

type CreateParticipantInput = Parameters<WorldBridge['createParticipant']>[0];
type ParticipantEditorModalProps = { onClose: () => void; storyTracks?: StoryTrack[]; persistentOnly?: boolean } & (
  | { participant: Participant; onSave: (participant: Participant) => Promise<void> | void; onCreate?: never }
  | { participant?: never; onSave?: never; onCreate: (input: CreateParticipantInput) => Promise<void> | void }
);

export const ParticipantEditorModal: Component<ParticipantEditorModalProps> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const [displayName, setDisplayName] = createSignal(props.participant?.displayName ?? '');
  const [personaText, setPersonaText] = createSignal(props.participant?.personaText ?? '');
  const [profilePhoto, setProfilePhoto] = createSignal(props.participant?.profilePhoto ?? '');
  const [voiceSampleId, setVoiceSampleId] = createSignal(props.participant?.voiceSampleId ?? '');
  const [continuity, setContinuity] = createSignal(props.persistentOnly || props.participant?.kind === 'persistent' || !props.participant);
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [consent, setConsent] = createSignal(false);
  const [error, setError] = createSignal('');
  const [sourceUrl, setSourceUrl] = createSignal('');
  const [trackId, setTrackId] = createSignal('');
  const [researching, setResearching] = createSignal(false);
  const [researchDraft, setResearchDraft] = createSignal<CharacterResearchResult>();
  const [acceptedResearch, setAcceptedResearch] = createSignal<CharacterResearchResult>();
  let researchOperationId = '';
  let fileInputRef: HTMLInputElement | undefined;
  let disposed = false;
  let stopConsentWait: (() => void) | undefined;
  let photoVersion = 0;
  onCleanup(() => { disposed = true; photoVersion++; stopConsentWait?.(); if (researchOperationId) void getBridge().world.cancelCharacterResearch(researchOperationId); });

  const close = (): void => {
    if (saving() && !stopConsentWait) return;
    if (researchOperationId) void getBridge().world.cancelCharacterResearch(researchOperationId);
    stopConsentWait?.(); props.onClose();
  };
  const research = async (): Promise<void> => {
    if (researching() || !displayName().trim() || !sourceUrl().trim()) return;
    setResearching(true); setError(''); setResearchDraft(undefined); setAcceptedResearch(undefined);
    const track = props.storyTracks?.find(item => item.id === trackId());
    researchOperationId = crypto.randomUUID();
    try {
      const result = await getBridge().world.researchCharacter({ operationId: researchOperationId,
        name: displayName().trim(), sourceUrl: sourceUrl().trim(), language: settings.language,
        ...(track ? { trackId: track.id, trackRevision: track.revision } : {}) });
      if (!disposed) setResearchDraft(result);
    } catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { researchOperationId = ''; if (!disposed) setResearching(false); }
  };
  const acceptResearch = (): void => {
    const result = researchDraft();
    if (!result) return;
    setAcceptedResearch(result); setPersonaText(result.baseline.lore);
  };
  const canonFromResearch = (result: CharacterResearchResult): CanonAnchor => {
    const track = props.storyTracks?.find(item => item.id === result.trackId);
    return { trackId: result.trackId, trackRevision: result.trackRevision, coverage: result.evidence.coverage,
      workTitle: track?.title ?? new URL(result.evidence.pageUrl).hostname,
      fandomBaseUrl: result.evidence.wikiUrl, characterPageTitle: result.evidence.pageTitle,
      coordinate: { kind: 'point', value: track ? formatProgress({ ...track, completed: result.evidence.coverage }) : '' }, baseline: result.baseline };
  };
  const handlePhotoUpload = async (): Promise<void> => {
    const input = fileInputRef;
    const file = input?.files?.[0];
    if (!file) return;
    const version = ++photoVersion;
    setUploading(true); setError('');
    try {
      const photo = await resizeProfilePhoto(file);
      if (!disposed && version === photoVersion) setProfilePhoto(photo);
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!disposed) setUploading(false);
      if (input) input.value = '';
    }
  };

  const commit = async (kind: 'persistent' | 'temporary'): Promise<void> => {
    if (!displayName().trim() || saving() || uploading()) return;
    setSaving(true); setError('');
    const fields = { displayName: displayName().trim(), personaText: personaText().trim(),
      profilePhoto: profilePhoto() || undefined, voiceSampleId: voiceSampleId() || undefined };
    try {
      if (props.participant) await props.onSave({ ...props.participant, ...fields });
      else await props.onCreate({ ...fields, kind, ...(acceptedResearch() ? { canon: canonFromResearch(acceptedResearch()!) } : {}) });
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err));
    } finally { if (!disposed) setSaving(false); }
  };
  const save = (): void => {
    const persistent = props.persistentOnly || continuity();
    if (!props.participant && persistent && !settings.livingWorldEnabled) { setConsent(true); return; }
    void commit(persistent ? 'persistent' : 'temporary');
  };
  // Wait for main's persisted settings acknowledgement, not the optimistic UI store.
  const enableAndCreate = (): void => {
    if (saving()) return;
    setSaving(true); setError('');
    const bridge = getBridge().settings;
    const stopSaved = bridge.onSettingsSaved(() => bridge.getSettings());
    const stopSettings = bridge.onSettings(persisted => {
      if (!persisted.livingWorldEnabled || disposed) return;
      stopConsentWait?.(); setSaving(false); void commit('persistent');
    });
    stopConsentWait = () => { stopSaved(); stopSettings(); stopConsentWait = undefined; };
    try { updateSettings({ livingWorldEnabled: true }); }
    catch (err) { stopConsentWait(); setSaving(false); setError(String(err)); }
  };

  return <ModalForm isOpen onClose={close} onSubmit={save} size="sm"
    title={t(props.participant ? 'mlearn.ConversationAgent.Details.EditParticipant' : 'mlearn.ConversationAgent.Contacts.Add')}
    closeOnOverlay={!saving()} closeOnEscape={!saving()} showCloseButton={!saving()}
    footer={<div class="participant-editor-actions">
      <Button variant="ghost" onClick={close} disabled={saving() && !stopConsentWait}>{t('mlearn.ConversationAgent.Details.Cancel')}</Button>
      <Button variant="primary" onClick={consent() ? enableAndCreate : save} loading={saving()} disabled={!displayName().trim() || uploading()}
        aria-label={t(props.participant ? 'mlearn.ConversationAgent.Details.Save' : 'mlearn.ConversationAgent.Contacts.Add')}>
        {t(consent() ? 'mlearn.ConversationAgent.Contacts.EnableAndAdd' : props.participant ? 'mlearn.ConversationAgent.Details.Save' : 'mlearn.ConversationAgent.Contacts.Add')}
      </Button>
    </div>}>
    <div class="participant-editor">
      <Show when={error()}><p class="participant-editor-error" role="alert">{error()}</p></Show>
      <div class="participant-editor-identity">
        <Avatar name={displayName()} src={profilePhoto()} size="lg" />
        <div class="participant-editor-identity-meta">
          <Button variant="ghost" size="sm" onClick={() => fileInputRef?.click()} disabled={uploading() || saving()}>{t('mlearn.ConversationAgent.Details.PhotoChange')}</Button>
          <Show when={profilePhoto()}><Button variant="ghost" size="sm" disabled={saving()} onClick={() => { photoVersion++; setProfilePhoto(''); }}>{t('mlearn.ConversationAgent.Details.PhotoRemove')}</Button></Show>
          <input ref={fileInputRef} type="file" accept="image/*" class="participant-editor-photo-input" onChange={() => { void handlePhotoUpload(); }} />
        </div>
      </div>
      <FormField label={t('mlearn.ConversationAgent.Details.NameLabel')}>
        <Input type="text" autofocus value={displayName()} disabled={saving() || researching()} aria-label={t('mlearn.ConversationAgent.Details.NameLabel')}
          onInput={event => {
            if (acceptedResearch() && personaText() === acceptedResearch()!.baseline.lore) setPersonaText('');
            setDisplayName(event.currentTarget.value); setResearchDraft(undefined); setAcceptedResearch(undefined);
          }} />
      </FormField>
      <FormField label={t('mlearn.ConversationAgent.Contacts.About')}>
        <Textarea value={personaText()} disabled={saving()} onInput={event => setPersonaText(event.currentTarget.value)} rows={4}
          placeholder={t('mlearn.ConversationAgent.Details.PersonaPlaceholder')} aria-label={t('mlearn.ConversationAgent.Contacts.About')} />
      </FormField>
      <Show when={!props.participant}>
        <Disclosure title={t('mlearn.ConversationAgent.Story.ResearchIdentity')}>
          <div class="participant-editor-research">
            <FormField label={t('mlearn.ConversationAgent.Story.SourceUrl')}><Input type="url" value={sourceUrl()} disabled={researching()}
              onInput={event => { setSourceUrl(event.currentTarget.value); setResearchDraft(undefined); setAcceptedResearch(undefined); }} /></FormField>
            <FormField label={t('mlearn.ConversationAgent.Story.Track')}><Select value={trackId()} disabled={researching()}
              onChange={event => { setTrackId(event.currentTarget.value); setResearchDraft(undefined); setAcceptedResearch(undefined); }}
              options={[{ value: '', label: t('mlearn.ConversationAgent.Story.NoTrack') }, ...(props.storyTracks ?? []).filter(track => !track.archived).map(track => ({ value: track.id, label: `${track.title} · ${track.edition}` }))]} /></FormField>
            <Button disabled={!sourceUrl().trim() || !displayName().trim() || researching()} loading={researching()} onClick={() => { void research(); }}>{t('mlearn.ConversationAgent.Story.Research')}</Button>
            <Show when={researchDraft()}>{result => <div class="participant-editor-research-draft">
              <p>{result().baseline.lore}</p>
              <Show when={result().baseline.context}><h3>{t('mlearn.ConversationAgent.Story.ScopedContext')}</h3><p>{result().baseline.context}</p></Show>
              <Show when={result().baseline.quotes.length}><h3>{t('mlearn.ConversationAgent.Story.SourceQuotes')}</h3><For each={result().baseline.quotes}>{quote => <blockquote>{quote}</blockquote>}</For></Show>
              <Show when={result().unknowns.length}><h3>{t('mlearn.ConversationAgent.Story.Unknowns')}</h3><For each={result().unknowns}>{unknown => <p>{unknown}</p>}</For></Show>
              <Button variant={acceptedResearch() ? 'secondary' : 'primary'} onClick={acceptResearch}>{t(acceptedResearch() ? 'mlearn.ConversationAgent.Story.ResearchAccepted' : 'mlearn.ConversationAgent.Story.UseDraft')}</Button>
            </div>}</Show>
          </div>
        </Disclosure>
      </Show>
      <Disclosure title={t('mlearn.ConversationAgent.Details.VoiceLabel')}>
        <VoiceSamplePicker value={voiceSampleId()} onChange={setVoiceSampleId} />
      </Disclosure>
      <Show when={!props.participant}>
        <Show when={!props.persistentOnly}><div class="participant-editor-continuity">
          <ToggleSwitch checked={continuity()} disabled={saving()} onChange={value => { setContinuity(value); setConsent(false); }}
            label={t('mlearn.ConversationAgent.Contacts.WorldMember')} />
          <HintText>{t(continuity() ? 'mlearn.ConversationAgent.NewConversation.PersistentHint' : 'mlearn.ConversationAgent.Contacts.PracticeProfileHint')}</HintText>
        </div></Show>
        <Show when={consent()}><p class="participant-editor-consent" role="status">{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</p></Show>
      </Show>
    </div>
  </ModalForm>;
};
