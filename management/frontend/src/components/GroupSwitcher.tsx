import { useGroupScope } from '../groups/GroupScopeProvider';
import { ConsoleButton, ConsoleSelect } from './console';

export function GroupSwitcher() {
  const scope = useGroupScope();
  if (scope.status !== 'ready') return <span className="group-scope-state">{scope.status === 'error' ? 'Group unavailable' : 'Loading group…'}</span>;
  if (scope.groups.length < 2) return <ConsoleButton className="group-switcher" variant="secondary" aria-label={`Current group: ${scope.selectedGroup?.name ?? 'None'}`} isDisabled><span>{scope.selectedGroup?.name ?? 'No group'}</span></ConsoleButton>;
  return <div className="group-switcher"><ConsoleSelect label={`Current group: ${scope.selectedGroup?.name ?? 'None'}`} selectedKey={scope.selectedGroup?.id ?? ''} onSelectionChange={(value) => void scope.selectGroup(value)} options={scope.groups.map((group) => ({ key: group.id, label: group.name }))} /></div>;
}
