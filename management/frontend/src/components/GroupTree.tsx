import type React from 'react';
import type { GroupNode } from '../api/types';
import { ConsoleButton } from './console';

export function GroupTree({ groups, selectedId, onSelect }: { groups: GroupNode[]; selectedId: string | null; onSelect(id: string): void }) {
  const ids = new Set(groups.map((group) => group.id));
  const roots = groups.filter((group) => group.parentId === null || !ids.has(group.parentId));
  const render = (group: GroupNode): React.ReactNode => <li key={group.id}><ConsoleButton variant={selectedId === group.id ? 'primary' : 'ghost'} onClick={() => onSelect(group.id)}>{group.name}<small>{group.status}</small></ConsoleButton>{groups.some((child) => child.parentId === group.id) && <ul>{groups.filter((child) => child.parentId === group.id).map(render)}</ul>}</li>;
  return <nav className="group-tree" aria-label="Authorized groups"><ul>{roots.map(render)}</ul></nav>;
}
