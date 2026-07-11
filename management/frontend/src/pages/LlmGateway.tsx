import { useEffect, useState } from "react";
import { ApiClient } from "../api/client";
import { PageToolbar } from "../components/PageToolbar";
import { useGroupScope } from "../groups/GroupScopeProvider";
const api = new ApiClient();
interface Provider {
  id: string;
  name: string;
  providerKind: string;
  baseUrl: string;
  status: string;
  hasSecret: boolean;
}
interface Model {
  id: string;
  providerId: string;
  modelKey: string;
  upstreamModel: string;
  status: string;
}
interface Price {
  id: string;
  providerId: string;
  modelId: string | null;
  currency: string;
  unit: string;
  inputCostMicros: number;
  outputCostMicros: number;
  createdAt: number;
}
interface PromptProfile { id: string; name: string; systemPrompt: string; status: string }
interface UsageBucket { scopeKind: string; scopeId: string; metric: string; used: number; reserved: number; limit: number | null; remaining: number | null; warning: boolean }
interface ApiKeySummary { id: string; name: string | null; capabilities: string[]; expiresAt: number | null }
interface CreatedApiKey extends ApiKeySummary { secret: string }
interface CurrentReservation { id: string; learnerUserId: string; directGroupId: string; providerId: string; modelId: string; status: string; expiresAt: number; createdAt: number }
export default function LlmGateway() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [profiles, setProfiles] = useState<PromptProfile[]>([]);
  const [usage, setUsage] = useState<UsageBucket[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [reservations, setReservations] = useState<CurrentReservation[]>([]);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [providerEditor, setProviderEditor] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [providerKind, setProviderKind] = useState('openaiCompatible');
  const [providerEndpoint, setProviderEndpoint] = useState('');
  const [providerSecret, setProviderSecret] = useState('');
  const [configurationEditor, setConfigurationEditor] = useState<'model' | 'profile' | 'price' | 'apiKey' | null>(null);
  const [configurationName, setConfigurationName] = useState('');
  const [upstreamModel, setUpstreamModel] = useState('');
  const [configurationProvider, setConfigurationProvider] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [inputPrice, setInputPrice] = useState('0');
  const [outputPrice, setOutputPrice] = useState('0');
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  useEffect(() => {
    if (!groupId) return;
    const controller = new AbortController();
    const q = `groupId=${encodeURIComponent(groupId)}`;
    setQuotaError(null);
    Promise.all([
      api.get<{ items: Provider[] }>(`/api/llm/providers?${q}`, {
        signal: controller.signal,
      }),
      api.get<{ items: Model[] }>(`/api/llm/models?${q}`, {
        signal: controller.signal,
      }),
      api.get<{ items: Price[] }>(`/api/llm/prices?${q}`, {
        signal: controller.signal,
      }),
      api.get<{ items: PromptProfile[] }>(`/api/llm/prompt-profiles?${q}`, { signal: controller.signal }),
    ]).then(([p, m, r, nextProfiles]) => {
      if (!controller.signal.aborted) {
        setProviders(p.items);
        setModels(m.items);
        setPrices(r.items);
        setProfiles(nextProfiles.items);
      }
    });
    api.get<{ buckets: UsageBucket[] }>(`/api/llm/usage?${q}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setUsage(result.buckets); }).catch(() => { if (!controller.signal.aborted) { setUsage([]); setQuotaError('Quota summary unavailable until the school quota calendar is configured.'); } });
    api.get<{ apiKeys: ApiKeySummary[] }>(`/api/groups/${encodeURIComponent(groupId)}/api-keys`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setApiKeys(result.apiKeys); }).catch(() => { if (!controller.signal.aborted) setApiKeys([]); });
    api.get<{ items: CurrentReservation[] }>(`/api/llm/reservations?${q}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setReservations(result.items); }).catch(() => { if (!controller.signal.aborted) setReservations([]); });
    return () => controller.abort();
  }, [groupId]);
  const replace = async () => {
    if (!selected) return;
    await api.get(`/api/llm/providers/${selected}/secret`, {
      method: "PUT",
      body: JSON.stringify({ secret, idempotencyKey: crypto.randomUUID() }),
    });
    setSecret("");
    setProviders((items) =>
      items.map((item) =>
        item.id === selected ? { ...item, hasSecret: true } : item,
      ),
    );
  };
  const test = async (id: string) => {
    try {
      const result = await api.get<{
        configurationValid: boolean;
        networkCheckPerformed: boolean;
      }>(`/api/llm/providers/${id}/health`, { method: "POST" });
      setHealth(
        result.configurationValid
          ? "Configuration valid"
          : "Configuration incomplete",
      );
    } catch {
      setHealth("Provider test failed safely");
    }
  };
  const createProvider = async () => {
    if (!groupId) return;
    const created = await api.get<Provider>('/api/llm/providers', {
      method: 'POST',
      body: JSON.stringify({ groupId, name: providerName, providerKind, baseUrl: providerEndpoint, secret: providerSecret || null, idempotencyKey: crypto.randomUUID() }),
    });
    setProviders((items) => [...items, created]);
    setProviderName(''); setProviderEndpoint(''); setProviderSecret(''); setProviderEditor(false);
  };
  const openConfiguration = (kind: 'model' | 'profile' | 'price' | 'apiKey') => {
    setConfigurationEditor(kind); setConfigurationName(''); setUpstreamModel('');
    setConfigurationProvider(providers[0]?.id ?? ''); setSystemPrompt(''); setInputPrice('0'); setOutputPrice('0'); setOneTimeKey(null);
  };
  const createConfiguration = async () => {
    if (!groupId || !configurationEditor) return;
    const idempotencyKey = crypto.randomUUID();
    if (configurationEditor === 'model') {
      const created = await api.get<Model>('/api/llm/models', { method: 'POST', body: JSON.stringify({ groupId, providerId: configurationProvider, modelKey: configurationName, upstreamModel, idempotencyKey }) });
      setModels((items) => [...items, created]);
    } else if (configurationEditor === 'profile') {
      const created = await api.get<PromptProfile>('/api/llm/prompt-profiles', { method: 'POST', body: JSON.stringify({ groupId, name: configurationName, systemPrompt, idempotencyKey }) });
      setProfiles((items) => [...items, created]);
    } else if (configurationEditor === 'price') {
      const created = await api.get<Price>('/api/llm/prices', { method: 'POST', body: JSON.stringify({ groupId, providerId: configurationProvider, modelId: null, currency: 'USD', unit: 'perMillionTokens', inputCostMicros: Number(inputPrice), outputCostMicros: Number(outputPrice), idempotencyKey }) });
      setPrices((items) => [created, ...items]);
    } else {
      const created = await api.get<CreatedApiKey>(`/api/groups/${encodeURIComponent(groupId)}/api-keys`, { method: 'POST', body: JSON.stringify({ capabilities: ['analytics.view'], expiresAt: null }) });
      setApiKeys((items) => [{ ...created }, ...items]); setOneTimeKey(created.secret); return;
    }
    setConfigurationEditor(null);
  };
  const revokeApiKey = async (id: string) => {
    if (!groupId) return;
    await api.get(`/api/groups/${encodeURIComponent(groupId)}/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setApiKeys((items) => items.filter((item) => item.id !== id));
  };
  return (
    <div className="resource-page">
      <PageToolbar
        title="LLM Gateway"
        description="Providers, models, prompt routing, immutable prices, health, and governed quotas."
      />
      <section className="gateway-grid">
        <article className="dashboard-panel">
          <header className="panel-heading"><h2>Providers</h2>{scope.status === 'ready' && scope.can('llm.configure') ? <button className="table-link" onClick={() => setProviderEditor(true)}>Add provider</button> : null}</header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Endpoint</th>
                  <th>Secret</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.id}>
                    <th>
                      {provider.name}
                      <small>{provider.providerKind}</small>
                    </th>
                    <td>{provider.baseUrl}</td>
                    <td>
                      {provider.hasSecret ? "Configured" : "Not configured"}
                    </td>
                    <td>{provider.status}</td>
                    <td>
                      <button
                        onClick={() => {
                          setSelected(provider.id);
                          setSecret("");
                        }}
                      >
                        Replace secret
                      </button>
                      <button onClick={() => void test(provider.id)}>
                        Test
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {health && <p role="status">{health}</p>}
        </article>
        <article className="dashboard-panel">
          <header className="panel-heading"><h2>Models and routes</h2>{scope.status === 'ready' && scope.can('llm.configure') ? <button className="table-link" onClick={() => openConfiguration('model')}>Add model</button> : null}</header>
          {models.map((model) => (
            <div className="gateway-item" key={model.id}>
              <strong>{model.modelKey}</strong>
              <span>
                {model.upstreamModel} · {model.status}
              </span>
            </div>
          ))}
        </article>
        <article className="dashboard-panel">
          <header className="panel-heading"><h2>Immutable price history</h2>{scope.status === 'ready' && scope.can('llm.configure') ? <button className="table-link" onClick={() => openConfiguration('price')}>Add price version</button> : null}</header>
          {prices.map((price) => (
            <div className="gateway-item" key={price.id}>
              <strong>
                {price.currency} / {price.unit}
              </strong>
              <span>
                Input {price.inputCostMicros} · Output {price.outputCostMicros}{" "}
                · {new Date(price.createdAt * 1000).toLocaleDateString()}
              </span>
            </div>
          ))}
        </article>
        <article className="dashboard-panel">
          <header className="panel-heading"><h2>Prompt profiles</h2>{scope.status === 'ready' && scope.can('llm.configure') ? <button className="table-link" onClick={() => openConfiguration('profile')}>Add prompt profile</button> : null}</header>
          {profiles.map((profile) => <div className="gateway-item" key={profile.id}><strong>{profile.name}</strong><span>{profile.status} · {profile.systemPrompt}</span></div>)}
        </article>
        <article className="dashboard-panel">
          <h2>Quota summary</h2>
          {quotaError && <p role="status">{quotaError}</p>}
          {usage.map((bucket) => <div className="gateway-item" key={`${bucket.scopeKind}-${bucket.scopeId}-${bucket.metric}`}><strong>{bucket.metric}</strong><span>{bucket.used} used · {bucket.reserved} reserved · {bucket.remaining === null ? 'No limit' : `${bucket.remaining} remaining`}</span></div>)}
        </article>
        <article className="dashboard-panel">
          <header className="panel-heading"><h2>API keys</h2>{scope.status === 'ready' && scope.can('api_keys.manage') ? <button className="table-link" onClick={() => openConfiguration('apiKey')}>Create API key</button> : null}</header>
          {apiKeys.map((key) => <div className="gateway-item" key={key.id}><strong>{key.name ?? 'Unnamed key'}</strong><span>{key.capabilities.join(', ') || 'No capabilities'} · {key.expiresAt ? `expires ${new Date(key.expiresAt * 1000).toLocaleDateString()}` : 'no expiry'}</span>{scope.status === 'ready' && scope.can('api_keys.manage') ? <button className="table-link" onClick={() => void revokeApiKey(key.id)}>Revoke</button> : null}</div>)}
        </article>
        <article className="dashboard-panel">
          <h2>Current reservations</h2>
          {reservations.length === 0 ? <p>No active reservations.</p> : reservations.map((reservation) => <div className="gateway-item" key={reservation.id}><strong>{reservation.learnerUserId}</strong><span>{reservation.providerId} / {reservation.modelId} · {reservation.directGroupId} · expires {new Date(reservation.expiresAt * 1000).toLocaleTimeString()}</span></div>)}
        </article>
      </section>
      {selected && (
        <div className="dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Replace provider secret"
            className="console-dialog"
          >
            <h2>Replace provider secret</h2>
            <p>
              Stored plaintext is never returned. Enter a replacement value.
            </p>
            <input
              aria-label="New provider secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
            <footer>
              <button onClick={() => setSelected(null)}>Cancel</button>
              <button disabled={!secret} onClick={() => void replace()}>
                Save replacement
              </button>
            </footer>
          </section>
        </div>
      )}
      {providerEditor && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="provider-editor-title" className="console-dialog"><h2 id="provider-editor-title">Add provider</h2><p>The secret is encrypted at rest and never returned by the API.</p><label>Provider name<input aria-label="Provider name" value={providerName} onChange={(event) => setProviderName(event.currentTarget.value)} /></label><label>Provider kind<select aria-label="Provider kind" value={providerKind} onChange={(event) => setProviderKind(event.currentTarget.value)}><option value="openaiCompatible">OpenAI-compatible</option><option value="ollama">Ollama</option></select></label><label>Endpoint<input aria-label="Provider endpoint" type="url" value={providerEndpoint} onChange={(event) => setProviderEndpoint(event.currentTarget.value)} /></label><label>Secret<input aria-label="Provider secret" type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.currentTarget.value)} /></label><footer><button onClick={() => { setProviderEditor(false); setProviderSecret(''); }}>Cancel</button><button disabled={!providerName.trim() || !providerEndpoint.trim()} onClick={() => void createProvider()}>Create provider</button></footer></section></div>}
      {configurationEditor && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="configuration-editor-title" className="console-dialog"><h2 id="configuration-editor-title">{configurationEditor === 'model' ? 'Add model route' : configurationEditor === 'profile' ? 'Add prompt profile' : configurationEditor === 'price' ? 'Add immutable price version' : 'Create API key'}</h2>{oneTimeKey ? <><p>Copy this API key now. It will not be shown again.</p><code>{oneTimeKey}</code><footer><button onClick={() => setConfigurationEditor(null)}>Done</button></footer></> : <>{configurationEditor === 'model' && <><label>Provider<select aria-label="Model provider" value={configurationProvider} onChange={(event) => setConfigurationProvider(event.currentTarget.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>Route key<input aria-label="Model route key" value={configurationName} onChange={(event) => setConfigurationName(event.currentTarget.value)} /></label><label>Upstream model<input aria-label="Upstream model" value={upstreamModel} onChange={(event) => setUpstreamModel(event.currentTarget.value)} /></label></>}{configurationEditor === 'profile' && <><label>Profile name<input aria-label="Profile name" value={configurationName} onChange={(event) => setConfigurationName(event.currentTarget.value)} /></label><label>System prompt<textarea aria-label="System prompt" value={systemPrompt} onChange={(event) => setSystemPrompt(event.currentTarget.value)} /></label></>}{configurationEditor === 'price' && <><label>Provider<select aria-label="Price provider" value={configurationProvider} onChange={(event) => setConfigurationProvider(event.currentTarget.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>Input cost micros per million tokens<input aria-label="Input cost micros" type="number" min="0" value={inputPrice} onChange={(event) => setInputPrice(event.currentTarget.value)} /></label><label>Output cost micros per million tokens<input aria-label="Output cost micros" type="number" min="0" value={outputPrice} onChange={(event) => setOutputPrice(event.currentTarget.value)} /></label></>}{configurationEditor === 'apiKey' && <p>The key will have read-only analytics access for this group. Its plaintext secret is shown once.</p>}<footer><button onClick={() => setConfigurationEditor(null)}>Cancel</button><button disabled={(configurationEditor === 'model' && (!configurationProvider || !configurationName || !upstreamModel)) || (configurationEditor === 'profile' && (!configurationName || !systemPrompt)) || (configurationEditor === 'price' && !configurationProvider)} onClick={() => void createConfiguration()}>{configurationEditor === 'apiKey' ? 'Create key' : 'Save'}</button></footer></>}</section></div>}
    </div>
  );
}
