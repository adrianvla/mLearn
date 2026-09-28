import { createSignal, Show, type Component } from 'solid-js';
import type { Participant } from '../../../shared/world';
import { Avatar, Btn, ConfirmDialog, Disclosure, HintText, Modal } from '../../components/common';
import { useLocalization } from '../../context';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import './ContactProfileModal.css';

export const ContactProfileModal: Component<{
  person: Participant;
  onClose: () => void;
  onMessage: (person: Participant) => Promise<void>;
  onSave: (person: Participant) => Promise<void>;
  onRemove: (person: Participant) => Promise<void>;
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
  return <Show when={!editing()} fallback={<ParticipantEditorModal participant={props.person}
    onClose={() => setEditing(false)} onSave={async person => { await props.onSave(person); setEditing(false); }} />}>
    <Modal isOpen onClose={props.onClose} size="sm" title={t('mlearn.ConversationAgent.Contacts.Profile')}
      closeOnEscape={!busy()} closeOnOverlay={!busy()} showCloseButton={!busy()}>
      <div class="contact-profile">
        <Avatar name={props.person.displayName} src={props.person.profilePhoto} size="lg" />
        <h2>{props.person.displayName}</h2>
        <HintText>{t(props.person.kind === 'persistent' ? 'mlearn.ConversationAgent.Contacts.InWorld' : 'mlearn.ConversationAgent.Contacts.PracticeOnly')}</HintText>
        <div class="contact-profile-actions">
          <Btn variant="primary" loading={busy()} onClick={() => { void message(); }}>{t('mlearn.ConversationAgent.Contacts.Message')}</Btn>
          <Btn variant="secondary" disabled={busy()} onClick={() => setEditing(true)}>{t('mlearn.ConversationAgent.Details.Edit')}</Btn>
        </div>
        <Show when={error()}><p class="contact-profile-error" role="alert">{error()}</p></Show>
        <Show when={props.person.personaText.trim()}><Disclosure title={t('mlearn.ConversationAgent.Contacts.About')} class="contact-profile-about">
          <p>{props.person.personaText}</p>
        </Disclosure></Show>
        <Btn variant="ghost" size="sm" disabled={busy()} onClick={() => setRemoving(true)}>{t('mlearn.ConversationAgent.Contacts.Remove')}</Btn>
      </div>
    </Modal>
    <Show when={removing()}><ConfirmDialog isOpen showLoading onClose={() => setRemoving(false)} onConfirm={remove}
      title={t('mlearn.ConversationAgent.Contacts.Remove')} message={t('mlearn.ConversationAgent.Contacts.RemoveHint')}
      confirmText={t('mlearn.ConversationAgent.Contacts.Remove')} variant="danger" /></Show>
  </Show>;
};
