import { For, createSignal, Show, type Component } from 'solid-js';
import type { Participant, Room } from '../../../shared/world';
import { Avatar, Button, ConfirmDialog, HintText, ListRow, Modal, ToggleSwitch } from '../../components/common';
import { useLocalization } from '../../context';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import './ContactProfileModal.css';

export const ContactProfileModal: Component<{
  person: Participant;
  onClose: () => void;
  onMessage: (person: Participant) => Promise<void>;
  onSave: (person: Participant) => Promise<void>;
  onRemove: (person: Participant) => Promise<void>;
  rooms?: Room[];
  onOpenRoom?: (roomId: string) => void;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
}> = (props) => {
  const { t } = useLocalization();
  const [editing, setEditing] = createSignal(false);
  const [removing, setRemoving] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const message = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true); setError('');
    try { await props.onMessage(props.person); props.onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const remove = async (): Promise<void> => {
    setError('');
    try { await props.onRemove(props.person); props.onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const restore = async (): Promise<void> => {
    setBusy(true); setError('');
    try { await props.onSave({ ...props.person, archivedAt: undefined }); props.onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Show when={!editing()} fallback={<ParticipantEditorModal participant={props.person}
    onClose={() => setEditing(false)} onSave={async person => { await props.onSave(person); setEditing(false); }} />}>
    <Modal isOpen onClose={props.onClose} size="sm" title={t('mlearn.ConversationAgent.Contacts.Profile')}
      closeOnEscape={!busy()} closeOnOverlay={!busy()} showCloseButton={!busy()}>
      <div class="contact-profile">
        <Avatar name={props.person.displayName} src={props.person.profilePhoto} size="lg" />
        <h2>{props.person.displayName}</h2>
        <HintText>{t(props.person.archivedAt ? 'mlearn.ConversationAgent.Contacts.Archived' : props.person.kind === 'persistent' ? 'mlearn.ConversationAgent.Contacts.InWorld' : 'mlearn.ConversationAgent.Contacts.PracticeOnly')}</HintText>
        <div class="contact-profile-actions">
          <Show when={!props.person.archivedAt} fallback={<Button variant="primary" loading={busy()} onClick={() => { void restore(); }}>{t('mlearn.ConversationAgent.Contacts.Restore')}</Button>}>
            <Button variant="primary" loading={busy()} onClick={() => { void message(); }}>{t('mlearn.ConversationAgent.Contacts.Message')}</Button>
            <Button variant="secondary" disabled={busy()} onClick={() => setEditing(true)}>{t('mlearn.ConversationAgent.Details.Edit')}</Button>
          </Show>
        </div>
        <Show when={error()}><p class="contact-profile-error" role="alert">{error()}</p></Show>
        <Show when={!props.person.archivedAt && props.onMutedChange}>
          <ToggleSwitch label={t('mlearn.ConversationAgent.Contacts.Notifications')} checked={!props.muted} onChange={enabled => props.onMutedChange?.(!enabled)} />
        </Show>
        <Show when={(props.rooms?.length ?? 0) > 0}>
          <h3>{t('mlearn.ConversationAgent.Contacts.SharedChats')}</h3>
          <div class="contact-profile-rooms">
            <For each={props.rooms}>{room => <ListRow headline={room.title} onClick={() => { props.onOpenRoom?.(room.id); props.onClose(); }} />}</For>
          </div>
        </Show>
        <Show when={!props.person.archivedAt}><Button variant="ghost" size="sm" disabled={busy()} onClick={() => setRemoving(true)}>{t('mlearn.ConversationAgent.Contacts.Archive')}</Button></Show>
      </div>
    </Modal>
    <Show when={removing()}><ConfirmDialog isOpen showLoading onClose={() => setRemoving(false)} onConfirm={remove}
      title={t('mlearn.ConversationAgent.Contacts.Archive')} message={t('mlearn.ConversationAgent.Contacts.ArchiveHint')}
      confirmText={t('mlearn.ConversationAgent.Contacts.Archive')} variant="danger" /></Show>
  </Show>;
};
