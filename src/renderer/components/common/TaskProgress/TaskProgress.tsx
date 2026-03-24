/**
 * TaskProgress Component
 * Reusable task progress display showing a list of tasks with status indicators.
 * Used in toasts for flashcard generation, TTS regeneration, etc.
 *
 * These components use .map() instead of <For> because they are rendered
 * inside toast content created from event handlers / async callbacks (outside
 * a SolidJS reactive root). The toast system re-creates the content on every
 * update (via updateToast), so internal reactivity is not needed.
 */

import { JSX, untrack } from 'solid-js';
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

/** Renders a status icon using plain conditionals and CSS-only spinner to avoid
 *  creating SolidJS computations (this runs outside reactive roots in toast content). */
function renderStatusIcon(status: TaskStatus): JSX.Element {
  switch (status) {
    case 'running':
      return <span class="task-progress-spinner" />;
    case 'done':
      return <span class="task-progress-check"><TaskCheckIcon /></span>;
    case 'error':
      return <span class="task-progress-error"><TaskErrorIcon /></span>;
    default:
      return <span class="task-progress-pending" />;
  }
}

/** Flat task list (no grouping) — static render, no reactive tracking */
export function TaskProgressContent(props: { tasks: () => TaskState[] }): JSX.Element {
  const tasks = untrack(props.tasks);
  return (
    <div class="task-progress">
      {tasks.map(task => (
        <div class="task-progress-row">
          <span class="task-progress-status">{renderStatusIcon(task.status)}</span>
          <span class="task-progress-label">{task.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Grouped task list (multiple cards, each with sub-tasks) — static render, no reactive tracking */
export function GroupedTaskProgressContent(props: { groups: () => TaskGroup[] }): JSX.Element {
  const groups = untrack(props.groups);
  return (
    <div class="task-progress">
      {groups.map(group => (
        <div class="task-progress-group">
          <div class="task-progress-group-label">{group.label}</div>
          {group.tasks.map(task => (
            <div class="task-progress-row task-progress-row--indented">
              <span class="task-progress-status">{renderStatusIcon(task.status)}</span>
              <span class="task-progress-label">{task.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
