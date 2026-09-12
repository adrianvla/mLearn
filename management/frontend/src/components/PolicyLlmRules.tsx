import { useEffect, useState } from 'react';
import { ApiClient } from '../api/client';
import { ConsoleNumberField, ConsoleSelect, ConsoleSwitch } from './console';
import { QuotaEditor, type DraftQuota } from './QuotaEditor';

interface LlmDraft {
  enabled?: boolean;
  allowedProviders?: string[];
  allowedModels?: string[];
  promptProfileId?: string | null;
  requestsPerMinute?: number;
  maxConcurrentStreams?: number;
  quotas?: DraftQuota[];
}
interface Choice { id: string; name?: string; modelKey?: string }
const api = new ApiClient();

export function PolicyLlmRules({ groupId, value, disabled, canConfigure, onChange }: {
  groupId: string; value: LlmDraft; disabled: boolean; canConfigure: boolean; onChange(value: LlmDraft): void;
}) {
  const [choices, setChoices] = useState<{ providers: Choice[]; models: Choice[]; profiles: Choice[] }>({ providers: [], models: [], profiles: [] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!canConfigure) return;
    const controller = new AbortController();
    Promise.all(['providers', 'models', 'prompt-profiles'].map((kind) => api.get<{ items: Choice[] }>(`/api/llm/${kind}?groupId=${encodeURIComponent(groupId)}`, { signal: controller.signal })))
      .then(([providers, models, profiles]) => { if (!controller.signal.aborted) setChoices({ providers: providers.items ?? [], models: models.items ?? [], profiles: profiles.items ?? [] }); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load LLM configuration'); });
    return () => controller.abort();
  }, [groupId, canConfigure]);
  const toggle = (field: 'allowedProviders' | 'allowedModels', id: string, selected: boolean) => {
    const current = value[field] ?? [];
    onChange({ ...value, [field]: selected ? [...current, id] : current.filter((item) => item !== id) });
  };
  return <section aria-label="Governed LLM routing">
    <p>Configure providers, models, and prices in LLM Gateway, then allow them here. Child policies inherit and may restrict ancestor routes. Add a hard quota before learners use the gateway.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!canConfigure ? <p>LLM configuration permission is required to choose local routes.</p> : <>
      <fieldset><legend>Allowed providers</legend>{choices.providers.map((item) => <ConsoleSwitch key={item.id} label={item.name ?? item.id} isSelected={value.allowedProviders?.includes(item.id) ?? false} isDisabled={disabled} onChange={(selected) => toggle('allowedProviders', item.id, selected)} />)}</fieldset>
      <fieldset><legend>Allowed models</legend>{choices.models.map((item) => <ConsoleSwitch key={item.id} label={item.modelKey ?? item.id} isSelected={value.allowedModels?.includes(item.id) ?? false} isDisabled={disabled} onChange={(selected) => toggle('allowedModels', item.id, selected)} />)}</fieldset>
      <ConsoleSelect label="Prompt profile" selectedKey={value.promptProfileId ?? 'inherit'} isDisabled={disabled} onSelectionChange={(id) => onChange({ ...value, promptProfileId: id === 'inherit' ? undefined : id })} options={[{ key: 'inherit', label: 'Inherit default' }, ...choices.profiles.map((item) => ({ key: item.id, label: item.name ?? item.id }))]} />
    </>}
    <ConsoleNumberField label="Requests per minute" min={1} value={value.requestsPerMinute ?? 60} isDisabled={disabled} onChange={(requestsPerMinute) => onChange({ ...value, requestsPerMinute })} />
    <ConsoleNumberField label="Concurrent streams" min={1} value={value.maxConcurrentStreams ?? 4} isDisabled={disabled} onChange={(maxConcurrentStreams) => onChange({ ...value, maxConcurrentStreams })} />
    <QuotaEditor quotas={value.quotas ?? []} disabled={disabled} onChange={(quotas) => onChange({ ...value, quotas })} />
  </section>;
}
