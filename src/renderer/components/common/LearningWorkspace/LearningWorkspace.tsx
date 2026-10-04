import { createContext, useContext, onMount, onCleanup, type ParentComponent } from 'solid-js';
import { isRatingKeyIgnored } from '../../../utils/ratingShortcuts';
import './LearningWorkspace.css';

type InputRole = 'surface' | 'encounter' | 'rating';
type InputHandler = (event: KeyboardEvent) => void;
const LearningInputContext = createContext<{ register: (role: InputRole, handler: InputHandler) => () => void }>();

/** One foreground listener; task owners keep their actions and the real matrix keeps its chord parser. */
export const LearningWorkspace: ParentComponent = props => {
  const handlers = new Map<InputRole, InputHandler[]>();
  const register = (role: InputRole, handler: InputHandler) => {
    const owners = handlers.get(role) ?? [];
    handlers.set(role, [...owners, handler]);
    return () => handlers.set(role, (handlers.get(role) ?? []).filter(owner => owner !== handler));
  };
  const input = (event: KeyboardEvent) => {
    if (isRatingKeyIgnored(event)) return;
    for (const role of ['surface', 'encounter', 'rating'] as const) {
      handlers.get(role)?.at(-1)?.(event);
      if (event.defaultPrevented) return;
    }
  };
  onMount(() => {
    window.addEventListener('keydown', input);
    onCleanup(() => window.removeEventListener('keydown', input));
  });
  return <LearningInputContext.Provider value={{ register }}><div class="learning-workspace">{props.children}</div></LearningInputContext.Provider>;
};

/** Native/standalone hosts retain their existing event boundary; routed hosts compose under one owner. */
export function useLearningInput(role: InputRole, handler: InputHandler, standalone: 'window' | 'document' = 'window'): void {
  const workspace = useContext(LearningInputContext);
  onMount(() => {
    if (workspace) { onCleanup(workspace.register(role, handler)); return; }
    const target = standalone === 'document' ? document : window;
    target.addEventListener('keydown', handler as EventListener);
    onCleanup(() => target.removeEventListener('keydown', handler as EventListener));
  });
}
