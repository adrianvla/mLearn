/**
 * TaskProgress Component
 * Reusable task progress display showing a list of tasks with status indicators.
 * Used in toasts for flashcard generation, TTS regeneration, etc.
 */

import { For, JSX } from 'solid-js';
import { Spinner } from '../Loader/Loader';
import './TaskProgress.css';

export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface TaskState {
  key: string;
  label: string;
  status: TaskStatus;
}

export interface TaskGroup {
  label: string;
  tasks: TaskState[];
}

const TaskCheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <polyline points="3 8 7 12 13 4" />
  </svg>
);

const TaskErrorIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <line x1="4" y1="4" x2="12" y2="12" />
    <line x1="12" y1="4" x2="4" y2="12" />
  </svg>
);

function TaskStatusIcon(props: { status: TaskStatus }): JSX.Element {
  return (
    <span class="task-progress-status">
      {props.status === 'running' && <Spinner size={14} />}
      {props.status === 'done' && <span class="task-progress-check"><TaskCheckIcon /></span>}
      {props.status === 'error' && <span class="task-progress-error"><TaskErrorIcon /></span>}
      {props.status === 'pending' && <span class="task-progress-pending" />}
    </span>
  );
}

/** Flat task list (no grouping) */
export function TaskProgressContent(props: { tasks: () => TaskState[] }): JSX.Element {
  return (
    <div class="task-progress">
      <For each={props.tasks()}>
        {(task) => (
          <div class="task-progress-row">
            <TaskStatusIcon status={task.status} />
            <span class="task-progress-label">{task.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}

/** Grouped task list (multiple cards, each with sub-tasks) */
export function GroupedTaskProgressContent(props: { groups: () => TaskGroup[] }): JSX.Element {
  return (
    <div class="task-progress">
      <For each={props.groups()}>
        {(group) => (
          <div class="task-progress-group">
            <div class="task-progress-group-label">{group.label}</div>
            <For each={group.tasks}>
              {(task) => (
                <div class="task-progress-row task-progress-row--indented">
                  <TaskStatusIcon status={task.status} />
                  <span class="task-progress-label">{task.label}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
