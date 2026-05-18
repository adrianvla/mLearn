import { Component, createSignal, Show, For, createMemo } from 'solid-js';
import { useLocalization } from '../../context';
import { Btn, IconBtn, Modal, Input, EmptyState } from '../../components/common';
import { TrashIcon, ClockIcon, PlusIcon } from '../../components/common/Misc/Icons';
import type { ConversationSession } from '../../../shared/types';
import './ConversationHistoryPanel.css';

interface ConversationHistoryPanelProps {
  sessions: ConversationSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onNewSession: () => void;
}

export const ConversationHistoryPanel: Component<ConversationHistoryPanelProps> = (props) => {
  const { t, locale } = useLocalization();
  const [deleteSession, setDeleteSession] = createSignal<ConversationSession | null>(null);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = createSignal('');
  const [showDeleteAll, setShowDeleteAll] = createSignal(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = createSignal('');

  const sortedSessions = createMemo(() => {
    return [...props.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const handleDeleteClick = (e: MouseEvent, session: ConversationSession) => {
    e.stopPropagation();
    setDeleteSession(session);
    setDeleteConfirmTitle('');
  };

  const handleDeleteConfirm = () => {
    const session = deleteSession();
    if (!session) return;
    props.onDelete(session.id);
    setDeleteSession(null);
    setDeleteConfirmTitle('');
  };

  const canDelete = (): boolean => {
    const session = deleteSession();
    if (!session) return false;
    return deleteConfirmTitle().trim().toLowerCase() === session.title.trim().toLowerCase();
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(locale(), { dateStyle: 'short' });
  };

  return (
    <div class="conversation-history-panel">
      <div class="conversation-history-header">
        <h3 class="conversation-history-title">{t('mlearn.ConversationAgent.History.Title')}</h3>
        <Btn variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={props.onNewSession}>
          {t('mlearn.ConversationAgent.History.NewSession')}
        </Btn>
      </div>

      <Show
        when={sortedSessions().length > 0}
        fallback={
          <EmptyState
            icon={<ClockIcon size={32} />}
            title={t('mlearn.ConversationAgent.History.Title')}
            description={t('mlearn.ConversationAgent.History.Empty')}
          />
        }
      >
        <div class="conversation-history-items">
          <For each={sortedSessions()}>
            {(session) => {
              const isActive = () => session.id === props.activeSessionId;

              return (
                <button
                  type="button"
                  class={`history-item ${isActive() ? 'history-item--active' : ''}`}
                  onClick={() => props.onSelect(session.id)}
                >
                  <div class="history-item-info">
                    <span class="history-item-title">{session.title}</span>
                    <span class="history-item-date">{formatDate(session.updatedAt)}</span>
                  </div>
                  <div class="history-item-actions">
                    <IconBtn
                      variant="ghost"
                      size="sm"
                      icon={<TrashIcon size={14} />}
                      onClick={(e) => handleDeleteClick(e, session)}
                      aria-label={t('mlearn.ConversationAgent.History.Delete')}
                    />
                  </div>
                </button>
              );
            }}
          </For>
        </div>

        <div class="conversation-history-danger-zone">
          <Btn
            variant="danger"
            size="sm"
            icon={<TrashIcon size={14} />}
            onClick={() => { setShowDeleteAll(true); setDeleteAllConfirmText(''); }}
          >
            {t('mlearn.ConversationAgent.History.DeleteAll')}
          </Btn>
        </div>
      </Show>

      <Modal
        isOpen={!!deleteSession()}
        onClose={() => setDeleteSession(null)}
        title={t('mlearn.ConversationAgent.History.DeleteConfirmTitle')}
        size="sm"
        footer={
          <div class="history-delete-modal-footer">
            <Btn variant="ghost" onClick={() => setDeleteSession(null)}>
              {t('mlearn.ConversationAgent.Setup.Cancel')}
            </Btn>
            <Btn variant="danger" onClick={handleDeleteConfirm} disabled={!canDelete()}>
              {t('mlearn.ConversationAgent.History.Delete')}
            </Btn>
          </div>
        }
      >
        <div class="history-delete-modal-body">
          <p class="history-delete-modal-message">
            {t('mlearn.ConversationAgent.History.DeleteConfirm')}
          </p>
          <Show when={deleteSession()}>
            <p class="history-delete-modal-name">{deleteSession()!.title}</p>
          </Show>
          <Input
            value={deleteConfirmTitle()}
            onInput={(e) => setDeleteConfirmTitle(e.currentTarget.value)}
            placeholder={t('mlearn.ConversationAgent.History.DeleteConfirmPlaceholder')}
            size="md"
          />
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteAll()}
        onClose={() => setShowDeleteAll(false)}
        title={t('mlearn.ConversationAgent.History.DeleteAllTitle')}
        size="sm"
        footer={
          <div class="history-delete-modal-footer">
            <Btn variant="ghost" onClick={() => setShowDeleteAll(false)}>
              {t('mlearn.ConversationAgent.Setup.Cancel')}
            </Btn>
            <Btn
              variant="danger"
              onClick={() => {
                props.onDeleteAll();
                setShowDeleteAll(false);
              }}
              disabled={deleteAllConfirmText().trim().toLowerCase() !== t('mlearn.ConversationAgent.History.DeleteAllConfirmWord').toLowerCase()}
            >
              {t('mlearn.ConversationAgent.History.DeleteAll')}
            </Btn>
          </div>
        }
      >
        <div class="history-delete-modal-body">
          <p class="history-delete-modal-message">
            {t('mlearn.ConversationAgent.History.DeleteAllConfirm')}
          </p>
          <p class="history-delete-modal-name">{t('mlearn.ConversationAgent.History.DeleteAllConfirmWord')}</p>
          <Input
            value={deleteAllConfirmText()}
            onInput={(e) => setDeleteAllConfirmText(e.currentTarget.value)}
            placeholder={t('mlearn.ConversationAgent.History.DeleteAllConfirmPlaceholder')}
            size="md"
          />
        </div>
      </Modal>
    </div>
  );
};
