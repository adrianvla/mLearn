import type { Settings } from './types';

export type InferenceKind =
  | 'conversation'
  | 'checker'
  | 'compaction'
  | 'reformulation'
  | 'dreamer'
  | 'scenario-direction'
  | 'proactive';

export type InferencePolicyKind =
  | 'conservative-cloud'
  | 'budgeted-cloud'
  | 'unrestricted-cloud'
  | 'local';

export interface InferencePolicy {
  readonly kind: InferencePolicyKind;
  isPermitted(kind: InferenceKind, opts?: { userInitiated?: boolean }): boolean;
  prefer(mode: 'piggyback' | 'deferred' | 'immediate'): boolean;
}

const FOREGROUND_KINDS: ReadonlySet<InferenceKind> = new Set([
  'conversation',
  'checker',
  'compaction',
  'reformulation',
]);

const permitAll = (): boolean => true;
const noPreference = (): boolean => true;
const piggybackOnly = (mode: 'piggyback' | 'deferred' | 'immediate'): boolean => mode === 'piggyback';
const piggybackOrDeferred = (mode: 'piggyback' | 'deferred' | 'immediate'): boolean => mode !== 'immediate';

const conservativeCloud: InferencePolicy = {
  kind: 'conservative-cloud',
  isPermitted: (kind, opts) =>
    FOREGROUND_KINDS.has(kind) ||
    (kind === 'scenario-direction' && opts?.userInitiated === true),
  prefer: piggybackOnly,
};

const budgetedCloud: InferencePolicy = {
  kind: 'budgeted-cloud',
  isPermitted: permitAll,
  prefer: piggybackOrDeferred,
};

const unrestrictedCloud: InferencePolicy = {
  kind: 'unrestricted-cloud',
  isPermitted: permitAll,
  prefer: noPreference,
};

const local: InferencePolicy = {
  kind: 'local',
  isPermitted: permitAll,
  prefer: noPreference,
};

/** 'builtin' and 'ollama' are local providers; 'cloud' is remote. */
function isLocalProvider(provider: Settings['llmProvider']): boolean {
  return provider === 'builtin' || provider === 'ollama';
}

export function getInferencePolicy(settings: Settings): InferencePolicy {
  if (isLocalProvider(settings.llmProvider)) {
    return local;
  }
  if (settings.inferenceCloudTier === 'budgeted') {
    return budgetedCloud;
  }
  if (settings.inferenceCloudTier === 'unrestricted') {
    return unrestrictedCloud;
  }
  return conservativeCloud;
}
