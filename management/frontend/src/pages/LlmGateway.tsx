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
export default function LlmGateway() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [profiles, setProfiles] = useState<PromptProfile[]>([]);
  const [usage, setUsage] = useState<UsageBucket[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
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
  return (
    <div className="resource-page">
      <PageToolbar
        title="LLM Gateway"
        description="Providers, models, prompt routing, immutable prices, health, and governed quotas."
      />
      <section className="gateway-grid">
        <article className="dashboard-panel">
          <h2>Providers</h2>
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
          <h2>Models and routes</h2>
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
          <h2>Immutable price history</h2>
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
          <h2>Prompt profiles</h2>
          {profiles.map((profile) => <div className="gateway-item" key={profile.id}><strong>{profile.name}</strong><span>{profile.status} · {profile.systemPrompt}</span></div>)}
        </article>
        <article className="dashboard-panel">
          <h2>Quota summary</h2>
          {quotaError && <p role="status">{quotaError}</p>}
          {usage.map((bucket) => <div className="gateway-item" key={`${bucket.scopeKind}-${bucket.scopeId}-${bucket.metric}`}><strong>{bucket.metric}</strong><span>{bucket.used} used · {bucket.reserved} reserved · {bucket.remaining === null ? 'No limit' : `${bucket.remaining} remaining`}</span></div>)}
        </article>
        <article className="dashboard-panel">
          <h2>API keys</h2>
          {apiKeys.map((key) => <div className="gateway-item" key={key.id}><strong>{key.name ?? 'Unnamed key'}</strong><span>{key.capabilities.join(', ') || 'No capabilities'} · {key.expiresAt ? `expires ${new Date(key.expiresAt * 1000).toLocaleDateString()}` : 'no expiry'}</span></div>)}
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
    </div>
  );
}
