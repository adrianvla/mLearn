import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { ApiClient } from "../api/client";
import type {
  AnalyticsSummary,
  LearnerAnalytics,
  LlmAnalytics,
  TimeseriesPoint,
} from "../api/types";
import { LineChart } from "../components/LineChart";
import { MetricCard } from "../components/MetricCard";
import { PageToolbar } from "../components/PageToolbar";
import { RecentActivityTable } from "../components/RecentActivityTable";
import { useGroupScope } from "../groups/GroupScopeProvider";

const api = new ApiClient();
interface DashboardData {
  summary: AnalyticsSummary;
  timeseries: TimeseriesPoint[];
  llm: LlmAnalytics;
  learners: LearnerAnalytics[];
}

export default function Overview() {
  const scope = useGroupScope();
  const groupId =
    scope.status === "ready" ? (scope.selectedGroup?.id ?? null) : null;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<"overview" | "usage" | "security">("overview");
  const [periodDays, setPeriodDays] = useState(30);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    setData(null);
    setError(null);
    if (groupId === null) return;
    const controller = new AbortController();
    const to = Date.now();
    const from = to - periodDays * 86_400_000;
    const query = `groupId=${encodeURIComponent(groupId)}&from=${from}&to=${to}`;
    Promise.all([
      api.get<AnalyticsSummary>(`/api/analytics/summary?${query}`, {
        signal: controller.signal,
      }),
      api.get<TimeseriesPoint[]>(`/api/analytics/timeseries?${query}`, {
        signal: controller.signal,
      }),
      api.get<LlmAnalytics>(`/api/analytics/llm?${query}`, {
        signal: controller.signal,
      }),
      api.get<{ items: LearnerAnalytics[] }>(
        `/api/analytics/learners?${query}&limit=8`,
        { signal: controller.signal },
      ),
    ])
      .then(([summary, timeseries, llm, learners]) => {
        if (!controller.signal.aborted)
          setData({ summary, timeseries, llm, learners: learners.items });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Dashboard could not be loaded",
          );
      });
    return () => controller.abort();
  }, [groupId, periodDays, revision]);

  const summary = data?.summary;
  return (
    <div className="dashboard-page">
      <PageToolbar
        title="Dashboard"
        description={`Learning, policy, and AI activity for ${scope.status === "ready" ? (scope.selectedGroup?.name ?? "the selected group") : "your school"}.`}
        actions={
          <button className="secondary-action" onClick={retry}>
            <RefreshCw /> Refresh
          </button>
        }
      />
      <div className="dashboard-tabs" aria-label="Dashboard view">
        <button className={view === "overview" ? "active" : undefined} onClick={() => setView("overview")}>Overview</button>
        <button className={view === "usage" ? "active" : undefined} onClick={() => setView("usage")}>Usage</button>
        <button className={view === "security" ? "active" : undefined} onClick={() => setView("security")}>Security</button>
        <select aria-label="Date period" value={periodDays} onChange={(event) => setPeriodDays(Number(event.currentTarget.value))}>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </div>
      <section className="metric-grid" aria-label="School metrics">
        <MetricCard
          label="Managed users"
          value={data?.learners.length ?? "—"}
          detail="Learners active in this scope"
        />
        <MetricCard
          label="Active learners"
          value={summary?.activeLearners ?? "—"}
          detail={`${summary?.sessions ?? 0} learning sessions`}
        />
        <MetricCard
          label="LLM requests"
          value={summary?.llmRequests ?? "—"}
          detail={`${(summary?.totalTokens ?? 0).toLocaleString()} tokens`}
        />
        <MetricCard
          label="Policy blocks"
          value={summary?.policyBlocks ?? "—"}
          detail="Requests stopped by policy"
        />
      </section>
      {view === "overview" && <><section className="dashboard-primary-grid">
        <article className="dashboard-panel">
          <header>
            <div>
              <h2>LLM usage</h2>
              <p>Requests across the selected group and descendants</p>
            </div>
            <strong>
              {data?.llm.costMicros === undefined
                ? "—"
                : `${(data.llm.costMicros / 1_000_000).toFixed(2)} cost`}
            </strong>
          </header>
          <LineChart
            title="LLM requests"
            data={(data?.timeseries ?? []).map((point) => ({
              label: new Date(point.dayStart).toLocaleDateString(),
              value: point.llmRequests,
            }))}
          />
        </article>
        <article className="dashboard-panel controls-panel">
          <header>
            <div>
              <h2>School controls</h2>
              <p>Effective safeguards for this scope</p>
            </div>
            <ShieldCheck />
          </header>
          <dl>
            <div>
              <dt>Group scope</dt>
              <dd>
                {scope.status === "ready"
                  ? scope.selectedGroup?.name
                  : "Loading"}
              </dd>
            </div>
            <div>
              <dt>Quota consumed</dt>
              <dd>{(data?.llm.totalTokens ?? 0).toLocaleString()} tokens</dd>
            </div>
            <div>
              <dt>Policy enforcement</dt>
              <dd>
                {summary?.policyBlocks === 0
                  ? "No recent blocks"
                  : `${summary?.policyBlocks ?? 0} recent blocks`}
              </dd>
            </div>
          </dl>
        </article>
      </section>
      <RecentActivityTable
        learners={data?.learners ?? []}
        loading={groupId !== null && data === null && error === null}
        error={error ?? undefined}
        onRetry={retry}
      /></>}
      {view === "usage" && <section className="dashboard-primary-grid"><article className="dashboard-panel"><header><div><h2>Token usage</h2><p>Input and output tokens across the selected subtree</p></div><strong>{((data?.llm.costMicros ?? 0) / 1_000_000).toFixed(4)} cost</strong></header><LineChart title="Total tokens" data={(data?.timeseries ?? []).map((point) => ({ label: new Date(point.dayStart).toLocaleDateString(), value: point.totalTokens }))} /></article><article className="dashboard-panel controls-panel"><header><div><h2>Usage summary</h2><p>Governed provider activity</p></div></header><dl><div><dt>Requests</dt><dd>{data?.llm.requests ?? 0}</dd></div><div><dt>Input tokens</dt><dd>{(data?.llm.inputTokens ?? 0).toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{(data?.llm.outputTokens ?? 0).toLocaleString()}</dd></div></dl></article></section>}
      {view === "security" && <section className="dashboard-primary-grid"><article className="dashboard-panel controls-panel"><header><div><h2>Policy enforcement</h2><p>Requests stopped before provider execution</p></div><ShieldCheck /></header><dl><div><dt>Policy blocks</dt><dd>{summary?.policyBlocks ?? 0}</dd></div><div><dt>Effective scope</dt><dd>{scope.status === "ready" ? scope.selectedGroup?.name : "Loading"}</dd></div><div><dt>Conversation governance</dt><dd>Signed policy active</dd></div></dl></article><article className="dashboard-panel"><header><div><h2>Security activity</h2><p>Policy blocks over the selected period</p></div></header><LineChart title="Policy blocks" data={(data?.timeseries ?? []).map((point) => ({ label: new Date(point.dayStart).toLocaleDateString(), value: point.policyBlocks }))} /></article></section>}
    </div>
  );
}
