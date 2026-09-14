/**
 * ParticipantEditorModal — dedicated character editor for a world Participant.
 * Edits the canonical participant fields (display name, persona, photo, voice)
 * through the world bridge; no parallel character schema.
 */

import { Component, Show, createSignal } from 'solid-js';
import type { Participant } from '../../../shared/world';
import { Btn, FormField, Input, ModalForm, Textarea, VoiceSamplePicker } from '../../components/common';
import { useLocalization } from '../../context';
import { resizeProfilePhoto } from '../../utils/profilePhoto';
import './ParticipantEditorModal.css';

interface ParticipantEditorModalProps {
  participant: Participant;
  onSave: (participant: Participant) => Promise<void> | void;
  onClose: () => void;
}

export const ParticipantEditorModal: Component<ParticipantEditorModalProps> = (props) => {
  const { t } = useLocalization();
  const [displayName, setDisplayName] = createSignal(props.participant.displayName);
  const [personaText, setPersonaText] = createSignal(props.participant.personaText);
  const [profilePhoto, setProfilePhoto] = createSignal(props.participant.profilePhoto ?? '');
  const [voiceSampleId, setVoiceSampleId] = createSignal(props.participant.voiceSampleId ?? '');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  let fileInputRef: HTMLInputElement | undefined;

  const kindLabel = () => props.participant.kind === 'persistent'
    ? t('mlearn.ConversationAgent.Details.Kind.Persistent')
    : t('mlearn.ConversationAgent.Details.Kind.Temporary');

  const handlePhotoUpload = async (): Promise<void> => {
    const input = fileInputRef;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      setProfilePhoto(await resizeProfilePhoto(file));
    } finally {
      if (input) input.value = '';
    }
  };

  const save = async (): Promise<void> => {
    if (!displayName().trim() || saving()) return;
    setSaving(true);
    setError('');
    try {
      await props.onSave({
        ...props.participant,
        displayName: displayName().trim(),
        personaText: personaText(),
        profilePhoto: profilePhoto() || undefined,
        voiceSampleId: voiceSampleId() || undefined,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalForm
      isOpen={true}
      onClose={props.onClose}
      title={t('mlearn.ConversationAgent.Details.EditParticipant')}
      size="md"
      showCloseButton={true}
      closeOnOverlay={!saving()}
      closeOnEscape={!saving()}
      footer={
        <div class="participant-editor-actions">
          <Btn variant="ghost" onClick={props.onClose} disabled={saving()}>{t('mlearn.ConversationAgent.Details.Cancel')}</Btn>
          <Btn variant="primary" onClick={() => { void save(); }} disabled={saving() || !displayName().trim()}>
            {saving() ? t('mlearn.ConversationAgent.Details.Saving') : t('mlearn.ConversationAgent.Details.Save')}
          </Btn>
        </div>
      }
    >
      <div class="participant-editor">
        <Show when={error()}><p role="alert">{error()}</p></Show>
        <div class="participant-editor-identity">
          <Show when={profilePhoto()} fallback={<span class="participant-editor-avatar">{(props.participant.displayName.trim().charAt(0) || '?').toUpperCase()}</span>}>
            <img class="participant-editor-avatar" src={profilePhoto()} alt="" />
          </Show>
          <div class="participant-editor-identity-meta">
            <span class="participant-editor-kind">{kindLabel()}</span>
            <div class="participant-editor-photo-actions">
              <Btn variant="ghost" size="sm" onClick={() => fileInputRef?.click()}>{t('mlearn.ConversationAgent.Details.PhotoChange')}</Btn>
              <Show when={profilePhoto()}>
                <Btn variant="ghost" size="sm" onClick={() => setProfilePhoto('')}>{t('mlearn.ConversationAgent.Details.PhotoRemove')}</Btn>
              </Show>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              class="participant-editor-photo-input"
              onChange={() => { void handlePhotoUpload(); }}
            />
          </div>
        </div>
        <FormField label={t('mlearn.ConversationAgent.Details.NameLabel')}>
          <Input value={displayName()} onInput={(event) => setDisplayName(event.currentTarget.value)} />
        </FormField>
        <FormField label={t('mlearn.ConversationAgent.Details.PersonaLabel')}>
          <Textarea
            value={personaText()}
            onInput={(event) => setPersonaText(event.currentTarget.value)}
            rows={7}
            placeholder={t('mlearn.ConversationAgent.Details.PersonaPlaceholder')}
          />
        </FormField>
        <FormField label={t('mlearn.ConversationAgent.Details.VoiceLabel')}>
          <VoiceSamplePicker value={voiceSampleId()} onChange={(sampleId) => setVoiceSampleId(sampleId)} />
        </FormField>
      </div>
    </ModalForm>
  );
};
