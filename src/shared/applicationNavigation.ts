/** Product destinations shared by native aliases and mobile routing. No learner state lives here. */
export interface ApplicationDestination {
  path: string;
  context: Record<string, unknown>;
}

export function resolveApplicationDestination(type: string, context: Record<string, unknown> = {}): ApplicationDestination | null {
  let path: string;
  switch (type) {
    case 'main': case 'study': case 'my-learning':
      path = typeof context.applicationPath === 'string' && isApplicationPath(context.applicationPath)
        ? context.applicationPath : type === 'study' ? '/practise' : type === 'my-learning' ? '/plan' : '/';
      break;
    case 'flashcards': path = context.tab === 'stats' ? '/progress' : context.tab && context.tab !== 'review' ? '/knowledge/material' : '/practise'; break;
    case 'word-sync': path = context.activity === 'practice' || context.activity === 'reinforce' ? '/practise/words' : '/evaluate/words'; break;
    case 'level-study':
      path = context.activity === 'assessment' ? '/evaluate/words'
        : context.activity === 'grammar' ? context.purpose === 'evaluate' ? '/evaluate/grammar' : '/practise/grammar'
        : context.activity === 'practice' || context.activity === 'reinforce' ? '/practise/words' : '/plan';
      break;
    case 'conversation-agent': path = '/messenger'; break;
    case 'memory-browser': path = '/messenger/memory'; break;
    case 'word-db-editor': path = '/knowledge'; break;
    case 'character-grid': path = '/knowledge/characters'; break;
    case 'statistics': path = '/progress'; break;
    case 'settings': path = '/settings'; break;
    case 'connect-qr': return { path: '/settings', context: { ...context, section: 'connection' } };
    default: return null;
  }
  return { path, context: { ...context } };
}

/** Explicit route intent. Context stays out of URLs and remains owned by the existing task protocol. */
export interface ApplicationNavigation {
  applicationNavigation: { path: string; requestId: string; context?: Record<string, unknown> };
}
export function isApplicationNavigation(value: unknown): value is ApplicationNavigation {
  if (!value || typeof value !== 'object') return false;
  const request = (value as ApplicationNavigation).applicationNavigation;
  return !!request && typeof request.path === 'string' && isApplicationPath(request.path)
    && typeof request.requestId === 'string';
}

/** Native families are hosts, never learning-attempt identities. */
export type ApplicationHost = 'main' | 'study' | 'my-learning' | 'settings';
export function applicationHostForPath(path: string): ApplicationHost {
  if (/^\/(practise|evaluate)(?:\/|$)/.test(path)) return 'study';
  if (/^\/(plan|knowledge|progress)(?:\/|$)/.test(path)) return 'my-learning';
  if (/^\/settings(?:\/|$)/.test(path)) return 'settings';
  return 'main';
}
export function isApplicationPath(path: string): boolean {
  return /^\/(?:$|(?:reader|video|practise|evaluate|plan|knowledge|progress|messenger|settings)(?:\/|$))/.test(path);
}
