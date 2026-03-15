/**
 * AgentListPanel
 * Displays the list of agents with create, edit, delete, and selection controls.
 * Each agent card shows profile photo, personality, per-agent memories, and actions.
 */

import { Component, For, Show, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import {
  EmptyState,
  Btn,
  IconBtn,
  Modal,
  Input,
  Card,
  EditIcon,
  TrashIcon,
  BotIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '../../components/common';
import type { AgentConfig, AgentMemoryEntry } from '../../../shared/types';
import './AgentListPanel.css';

interface AgentListPanelProps {
  agents: AgentConfig[];
  activeAgentId: string | null;
  memories: AgentMemoryEntry[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (agent: AgentConfig) => void;
  onDelete: (id: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearAgentMemories: (agentId: string) => void;
  onDeleteAll: () => void;
}

export const AgentListPanel: Component<AgentListPanelProps> = (props) => {
  const { t } = useLocalization();
  const [deleteAgent, setDeleteAgent] = createSignal<AgentConfig | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = createSignal('');
  const [showDeleteAll, setShowDeleteAll] = createSignal(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = createSignal('');
  const [expandedMemories, setExpandedMemories] = createSignal<Set<string>>(new Set());

  const getDisplayName = (agent: AgentConfig): string => {
    if (agent.personality === 'roleplay' && agent.roleplayName) {
      return agent.roleplayName;
    }
    return agent.agentName || t('mlearn.ConversationAgent.Agents.Unnamed');
  };

  const getPersonalityLabel = (agent: AgentConfig): string => {
    const base = t(`mlearn.ConversationAgent.Personality.${agent.personality.charAt(0).toUpperCase() + agent.personality.slice(1)}`);
    if (agent.personality === 'roleplay' && agent.roleplayFormality) {
      const formality = t(`mlearn.ConversationAgent.Personality.${agent.roleplayFormality.charAt(0).toUpperCase() + agent.roleplayFormality.slice(1)}`);
      return `${base} (${formality})`;
    }
    return base;
  };

  const getAgentMemories = (agentId: string): AgentMemoryEntry[] => {
    return props.memories.filter((m) => m.agentId === agentId);
  };

  const toggleMemories = (agentId: string) => {
    setExpandedMemories((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDeleteClick = (e: MouseEvent, agent: AgentConfig) => {
    e.stopPropagation();
    setDeleteAgent(agent);
    setDeleteConfirmName('');
  };

  const handleDeleteConfirm = () => {
    const agent = deleteAgent();
    if (!agent) return;
    props.onDelete(agent.id);
    setDeleteAgent(null);
    setDeleteConfirmName('');
  };

  const canDelete = (): boolean => {
    const agent = deleteAgent();
    if (!agent) return false;
    return deleteConfirmName().trim().toLowerCase() === getDisplayName(agent).trim().toLowerCase();
  };

  return (
    <div class="agent-list-panel">
      <div class="agent-list-header">
        <Btn variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={props.onCreate}>
          {t('mlearn.ConversationAgent.Agents.Create')}
        </Btn>
      </div>

      <Show
        when={props.agents.length > 0}
        fallback={
          <EmptyState
            icon={<BotIcon size={32} />}
            title={t('mlearn.ConversationAgent.Agents.Title')}
            description={t('mlearn.ConversationAgent.Agents.Empty')}
          />
        }
      >
        <div class="agent-list-items">
          <For each={props.agents}>
            {(agent) => {
              const isActive = () => agent.id === props.activeAgentId;
              const agentMems = () => getAgentMemories(agent.id);
              const isExpanded = () => expandedMemories().has(agent.id);

              return (
                <Card
                  class={`agent-card ${isActive() ? 'agent-card--active' : ''}`}
                  onClick={() => props.onSelect(agent.id)}
                >
                  <div class="agent-card-main">
                    <div class="agent-card-avatar">
                      <Show
                        when={agent.profilePhoto}
                        fallback={
                          <div class="agent-card-avatar-placeholder">
                            <BotIcon size={20} />
                          </div>
                        }
                      >
                        <img
                          class="agent-card-avatar-img"
                          src={agent.profilePhoto}
                          alt={getDisplayName(agent)}
                        />
                      </Show>

                    </div>

                    <div class="agent-card-info">
                      <span class="agent-card-name">{getDisplayName(agent)}</span>
                      <span class="agent-card-personality">{getPersonalityLabel(agent)}</span>
                    </div>

                    <div class="agent-card-actions">
                      <IconBtn
                        variant="ghost"
                        size="sm"
                        icon={<EditIcon size={14} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onEdit(agent);
                        }}
                        aria-label={t('mlearn.ConversationAgent.Agents.Edit')}
                      />
                      <IconBtn
                        variant="ghost"
                        size="sm"
                        icon={<TrashIcon size={14} />}
                        onClick={(e) => handleDeleteClick(e, agent)}
                        aria-label={t('mlearn.ConversationAgent.Agents.Delete')}
                      />
                    </div>
                  </div>

                  {/* Per-agent memories section */}
                  <Show when={agentMems().length > 0}>
                    <div class="agent-card-memories-toggle" onClick={(e) => { e.stopPropagation(); toggleMemories(agent.id); }}>
                      <span class="agent-card-memories-label">
                        {t('mlearn.ConversationAgent.Agents.Memories')} ({agentMems().length})
                      </span>
                      <Show when={isExpanded()} fallback={<ChevronDownIcon size={14} />}>
                        <ChevronUpIcon size={14} />
                      </Show>
                    </div>
                    <Show when={isExpanded()}>
                      <div class="agent-card-memories" onClick={(e) => e.stopPropagation()}>
                        <For each={agentMems()}>
                          {(memory) => (
                            <div class="agent-card-memory-item">
                              <div class="agent-card-memory-content">
                                <p class="agent-card-memory-text">{memory.content}</p>
                                <span class="agent-card-memory-date">{formatDate(memory.timestamp)}</span>
                              </div>
                              <IconBtn
                                variant="ghost"
                                size="sm"
                                icon={<TrashIcon size={12} />}
                                onClick={() => props.onDeleteMemory(memory.id)}
                                aria-label={t('mlearn.ConversationAgent.Memory.Delete')}
                              />
                            </div>
                          )}
                        </For>
                        <Btn
                          variant="danger"
                          size="sm"
                          onClick={() => props.onClearAgentMemories(agent.id)}
                        >
                          {t('mlearn.ConversationAgent.Memory.ClearAll')}
                        </Btn>
                      </div>
                    </Show>
                  </Show>
                  <Show when={agentMems().length === 0}>
                    <div class="agent-card-no-memories">
                      {t('mlearn.ConversationAgent.Agents.NoMemories')}
                    </div>
                  </Show>
                </Card>
              );
            }}
          </For>
        </div>

        {/* Delete all section at bottom */}
        <div class="agent-list-danger-zone">
          <Btn
            variant="danger"
            size="sm"
            icon={<TrashIcon size={14} />}
            onClick={() => { setShowDeleteAll(true); setDeleteAllConfirmText(''); }}
          >
            {t('mlearn.ConversationAgent.Agents.DeleteAll')}
          </Btn>
        </div>
      </Show>

      {/* Delete single agent confirmation modal */}
      <Modal
        isOpen={!!deleteAgent()}
        onClose={() => setDeleteAgent(null)}
        title={t('mlearn.ConversationAgent.Agents.DeleteConfirmTitle')}
        size="sm"
        footer={
          <div class="agent-delete-modal-footer">
            <Btn variant="ghost" onClick={() => setDeleteAgent(null)}>
              {t('mlearn.ConversationAgent.Setup.Cancel')}
            </Btn>
            <Btn variant="danger" onClick={handleDeleteConfirm} disabled={!canDelete()}>
              {t('mlearn.ConversationAgent.Agents.Delete')}
            </Btn>
          </div>
        }
      >
        <div class="agent-delete-modal-body">
          <p class="agent-delete-modal-message">
            {t('mlearn.ConversationAgent.Agents.DeleteConfirm')}
          </p>
          <Show when={deleteAgent()}>
            <p class="agent-delete-modal-name">{getDisplayName(deleteAgent()!)}</p>
          </Show>
          <Input
            value={deleteConfirmName()}
            onInput={(e) => setDeleteConfirmName(e.currentTarget.value)}
            placeholder={t('mlearn.ConversationAgent.Agents.DeleteConfirmPlaceholder')}
            size="md"
          />
        </div>
      </Modal>

      {/* Delete all agents confirmation modal */}
      <Modal
        isOpen={showDeleteAll()}
        onClose={() => setShowDeleteAll(false)}
        title={t('mlearn.ConversationAgent.Agents.DeleteAllTitle')}
        size="sm"
        footer={
          <div class="agent-delete-modal-footer">
            <Btn variant="ghost" onClick={() => setShowDeleteAll(false)}>
              {t('mlearn.ConversationAgent.Setup.Cancel')}
            </Btn>
            <Btn
              variant="danger"
              onClick={() => {
                props.onDeleteAll();
                setShowDeleteAll(false);
              }}
              disabled={deleteAllConfirmText().trim().toLowerCase() !== t('mlearn.ConversationAgent.Agents.DeleteAllConfirmWord').toLowerCase()}
            >
              {t('mlearn.ConversationAgent.Agents.DeleteAll')}
            </Btn>
          </div>
        }
      >
        <div class="agent-delete-modal-body">
          <p class="agent-delete-modal-message">
            {t('mlearn.ConversationAgent.Agents.DeleteAllConfirm')}
          </p>
          <p class="agent-delete-modal-name">{t('mlearn.ConversationAgent.Agents.DeleteAllConfirmWord')}</p>
          <Input
            value={deleteAllConfirmText()}
            onInput={(e) => setDeleteAllConfirmText(e.currentTarget.value)}
            placeholder={t('mlearn.ConversationAgent.Agents.DeleteAllConfirmPlaceholder')}
            size="md"
          />
        </div>
      </Modal>
    </div>
  );
};
