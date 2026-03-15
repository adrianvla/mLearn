/**
 * ConversationPlan — Collapsible topic plan strip for the conversation agent.
 * Shows AI-generated topics with progress tracking and difficulty adjustment.
 */

import { Component, Show, Index, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import { Badge, IconBtn, CheckIcon, ChevronDownIcon } from '../../components/common';
import type { ConversationPlanItem } from '../../../shared/types';
import type { PlanDifficulty } from '../../services/conversationAgent';

import './ConversationPlan.css';

interface ConversationPlanProps {
  plan: ConversationPlanItem[];
  onAdjustDifficulty?: (direction: PlanDifficulty) => void;
}

const DifficultyUpIcon: Component<{ size?: number }> = (props) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const DifficultyDownIcon: Component<{ size?: number }> = (props) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const ConversationPlan: Component<ConversationPlanProps> = (props) => {
  const { t } = useLocalization();
  const [collapsed, setCollapsed] = createSignal(false);

  const doneCount = () => props.plan.filter((item) => item.done).length;
  const totalCount = () => props.plan.length;

  return (
    <div class="ca-plan">
      <div class="ca-plan-header" onClick={() => setCollapsed((prev) => !prev)}>
        <div class="ca-plan-header-left">
          <ChevronDownIcon size={14} class={collapsed() ? '' : 'expanded'} />
          {t('mlearn.ConversationAgent.Topics.Title')}
        </div>
        <div class="ca-plan-header-right">
          <Show when={props.onAdjustDifficulty}>
            <div class="ca-plan-difficulty" onClick={(e) => e.stopPropagation()}>
              <IconBtn
                variant="ghost"
                size="sm"
                icon={<DifficultyDownIcon size={14} />}
                onClick={() => props.onAdjustDifficulty?.('down')}
                aria-label={t('mlearn.ConversationAgent.Topics.Easier')}
                title={t('mlearn.ConversationAgent.Topics.Easier')}
              />
              <IconBtn
                variant="ghost"
                size="sm"
                icon={<DifficultyUpIcon size={14} />}
                onClick={() => props.onAdjustDifficulty?.('up')}
                aria-label={t('mlearn.ConversationAgent.Topics.Harder')}
                title={t('mlearn.ConversationAgent.Topics.Harder')}
              />
            </div>
          </Show>
          <Badge variant={doneCount() === totalCount() ? 'green' : 'gray'} size="xs">
            {doneCount()}/{totalCount()}
          </Badge>
        </div>
      </div>
      <Show when={!collapsed()}>
        <ul class="ca-plan-items">
          <Index each={props.plan}>
            {(item) => (
              <li class={`ca-plan-item${item().done ? ' done' : ''}`}>
                <span class="ca-plan-item-indicator">
                  <Show when={item().done} fallback={<span class="ca-plan-item-bullet" />}>
                    <CheckIcon size={14} class="ca-plan-item-check" />
                  </Show>
                </span>
                <span class="ca-plan-item-text">{item().text}</span>
              </li>
            )}
          </Index>
        </ul>
      </Show>
    </div>
  );
};
