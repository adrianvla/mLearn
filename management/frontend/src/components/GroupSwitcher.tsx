import { ChevronDown } from 'lucide-react';
import { useGroupScope } from '../groups/GroupScopeProvider';

export function GroupSwitcher() {
  const scope = useGroupScope();
  if (scope.status !== 'ready') return <span className="group-scope-state">{scope.status === 'error' ? 'Group unavailable' : 'Loading group…'}</span>;
  if (scope.groups.length < 2) return <button className="group-switcher" aria-label={`Current group: ${scope.selectedGroup?.name ?? 'None'}`} disabled><span>{scope.selectedGroup?.name ?? 'No group'}</span></button>;
  return <label className="group-switcher"><span className="sr-only">Current group</span><select aria-label={`Current group: ${scope.selectedGroup?.name ?? 'None'}`} value={scope.selectedGroup?.id ?? ''} onChange={(event) => void scope.selectGroup(event.currentTarget.value)}>{scope.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronDown /></label>;
}
