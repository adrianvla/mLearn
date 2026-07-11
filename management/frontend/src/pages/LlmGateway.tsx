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
export default function LlmGateway() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  useEffect(() => {
    if (!groupId) return;
    const controller = new AbortController();
    const q = `groupId=${encodeURIComponent(groupId)}`;
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
    ]).then(([p, m, r]) => {
      if (!controller.signal.aborted) {
        setProviders(p.items);
        setModels(m.items);
        setPrices(r.items);
      }
    });
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
