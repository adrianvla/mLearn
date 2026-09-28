/** One profile editor for both adding contacts and editing canonical participants. */
import { Show, createSignal, onCleanup, type Component } from 'solid-js';
import type { Participant } from '../../../shared/world';
import type { WorldBridge } from '../../../shared/bridges/types';
import { getBridge } from '../../../shared/bridges';
import { Avatar, Button, Disclosure, FormField, HintText, Input, ModalForm, Textarea, ToggleSwitch, VoiceSamplePicker } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { resizeProfilePhoto } from '../../utils/profilePhoto';
import './ParticipantEditorModal.css';

type CreateParticipantInput = Parameters<WorldBridge['createParticipant']>[0];
type ParticipantEditorModalProps = { onClose: () => void } & (
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
  const [continuity, setContinuity] = createSignal(props.participant?.kind === 'persistent' || (!props.participant && settings.livingWorldEnabled));
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [consent, setConsent] = createSignal(false);
  const [error, setError] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;
  let disposed = false;
  let stopConsentWait: (() => void) | undefined;
  let photoVersion = 0;
  onCleanup(() => { disposed = true; photoVersion++; stopConsentWait?.(); });

  const close = (): void => {
    if (saving() && !stopConsentWait) return;
    stopConsentWait?.(); props.onClose();
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
      else await props.onCreate({ ...fields, kind });
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err));
    } finally { if (!disposed) setSaving(false); }
  };
  const save = (): void => {
    if (!props.participant && continuity() && !settings.livingWorldEnabled) { setConsent(true); return; }
    void commit(continuity() ? 'persistent' : 'temporary');
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
        <Input type="text" autofocus value={displayName()} disabled={saving()} aria-label={t('mlearn.ConversationAgent.Details.NameLabel')}
          onInput={event => setDisplayName(event.currentTarget.value)} />
      </FormField>
      <FormField label={t('mlearn.ConversationAgent.Contacts.About')}>
        <Textarea value={personaText()} disabled={saving()} onInput={event => setPersonaText(event.currentTarget.value)} rows={4}
          placeholder={t('mlearn.ConversationAgent.Details.PersonaPlaceholder')} aria-label={t('mlearn.ConversationAgent.Contacts.About')} />
      </FormField>
      <Disclosure title={t('mlearn.ConversationAgent.Details.VoiceLabel')}>
        <VoiceSamplePicker value={voiceSampleId()} onChange={setVoiceSampleId} />
      </Disclosure>
      <Show when={!props.participant}>
        <div class="participant-editor-continuity">
          <ToggleSwitch checked={continuity()} disabled={saving()} onChange={value => { setContinuity(value); setConsent(false); }}
            label={t('mlearn.ConversationAgent.Contacts.WorldMember')} />
          <HintText>{t(continuity() ? 'mlearn.ConversationAgent.NewConversation.PersistentHint' : 'mlearn.ConversationAgent.Contacts.PracticeProfileHint')}</HintText>
        </div>
        <Show when={consent()}><p class="participant-editor-consent" role="status">{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</p></Show>
      </Show>
    </div>
  </ModalForm>;
};
