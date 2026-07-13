import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { ApiClient } from "../api/client";
import type {
  AnalyticsSummary, AuditEvent, AuditPage,
  LearnerAnalytics,
  LlmAnalytics,
  TimeseriesPoint,
} from "../api/types";
import { LineChart } from "../components/LineChart";
import { MetricCard } from "../components/MetricCard";
import { PageToolbar } from "../components/PageToolbar";
import { ConsoleButton, ConsoleSelect } from "../components/console";
import { RecentActivityTable } from "../components/RecentActivityTable";
import { useGroupScope } from "../groups/GroupScopeProvider";
import { Card, Tabs } from "@heroui/react";

const api = new ApiClient();
interface DashboardData {
  summary: AnalyticsSummary;
  timeseries: TimeseriesPoint[];
  llm: LlmAnalytics;
  learners: LearnerAnalytics[];
  activity: AuditEvent[];
}

export default function Overview() {
  const scope = useGroupScope();
  const groupId =
    scope.status === "ready" ? (scope.selectedGroup?.id ?? null) : null;
  const canViewActivity = scope.status === "ready" && scope.can("group.view");
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
      canViewActivity
        ? api.get<AuditPage>(`/api/audit/events?groupId=${encodeURIComponent(groupId)}&limit=5`, { signal: controller.signal })
        : Promise.resolve<AuditPage>({ events: [], nextCursor: null }),
    ])
      .then(([summary, timeseries, llm, learners, activity]) => {
        if (!controller.signal.aborted)
          setData({ summary, timeseries, llm, learners: learners.items, activity: activity.events });
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
  }, [canViewActivity, groupId, periodDays, revision]);

  const summary = data?.summary;
  return (
    <div className="dashboard-page">
      <PageToolbar
        title="Dashboard"
        description={`Learning, policy, and AI activity for ${scope.status === "ready" ? (scope.selectedGroup?.name ?? "the selected group") : "your school"}.`}
        actions={
          <ConsoleButton className="secondary-action" onClick={retry}>
            <RefreshCw /> Refresh
          </ConsoleButton>
        }
      />
      <div className="dashboard-toolbar">
        <Tabs selectedKey={view} onSelectionChange={(key) => setView(String(key) as typeof view)}>
          <Tabs.ListContainer className="dashboard-tabs"><Tabs.List aria-label="Dashboard view">{(["overview", "usage", "security"] as const).map((name) => <Tabs.Tab id={name} key={name}>{name[0].toUpperCase() + name.slice(1)}</Tabs.Tab>)}</Tabs.List></Tabs.ListContainer>
        </Tabs>
        <div className="dashboard-period"><ConsoleSelect label="Date period" selectedKey={String(periodDays)} onSelectionChange={(value) => setPeriodDays(Number(value))} options={[{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }]} /></div>
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
      {view === "overview" && <><section className="dashboard-primary-grid" aria-label="Dashboard analysis">
        <Card className="dashboard-panel">
          <Card.Header>
            <div>
              <Card.Title>LLM usage</Card.Title>
              <Card.Description>Requests across the selected group and descendants</Card.Description>
            </div>
            <strong>
              {data?.llm.costMicros === undefined
                ? "—"
                : `${(data.llm.costMicros / 1_000_000).toFixed(2)} cost`}
            </strong>
          </Card.Header>
          <Card.Content>
          <LineChart
            title="LLM requests"
            data={(data?.timeseries ?? []).map((point) => ({
              label: new Date(point.dayStart).toLocaleDateString(),
              value: point.llmRequests,
            }))}
          />
          </Card.Content>
        </Card>
        <Card className="dashboard-panel controls-panel">
          <Card.Header>
            <div>
              <Card.Title>School controls</Card.Title>
              <Card.Description>Effective safeguards for this scope</Card.Description>
            </div>
            <ShieldCheck />
          </Card.Header>
          <Card.Content>
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
          </Card.Content>
        </Card>
      </section>
      {canViewActivity && <RecentActivityTable
        events={data?.activity ?? []}
        loading={groupId !== null && data === null && error === null}
        error={error ?? undefined}
        onRetry={retry}
      />}</>}
      {view === "usage" && <section className="dashboard-primary-grid"><Card className="dashboard-panel"><Card.Header><div><Card.Title>Token usage</Card.Title><Card.Description>Input and output tokens across the selected subtree</Card.Description></div><strong>{((data?.llm.costMicros ?? 0) / 1_000_000).toFixed(4)} cost</strong></Card.Header><Card.Content><LineChart title="Total tokens" data={(data?.timeseries ?? []).map((point) => ({ label: new Date(point.dayStart).toLocaleDateString(), value: point.totalTokens }))} /></Card.Content></Card><Card className="dashboard-panel controls-panel"><Card.Header><div><Card.Title>Usage summary</Card.Title><Card.Description>Governed provider activity</Card.Description></div></Card.Header><Card.Content><dl><div><dt>Requests</dt><dd>{data?.llm.requests ?? 0}</dd></div><div><dt>Input tokens</dt><dd>{(data?.llm.inputTokens ?? 0).toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{(data?.llm.outputTokens ?? 0).toLocaleString()}</dd></div></dl></Card.Content></Card></section>}
      {view === "security" && <section className="dashboard-primary-grid"><Card className="dashboard-panel controls-panel"><Card.Header><div><Card.Title>Policy enforcement</Card.Title><Card.Description>Requests stopped before provider execution</Card.Description></div><ShieldCheck /></Card.Header><Card.Content><dl><div><dt>Policy blocks</dt><dd>{summary?.policyBlocks ?? 0}</dd></div><div><dt>Effective scope</dt><dd>{scope.status === "ready" ? scope.selectedGroup?.name : "Loading"}</dd></div><div><dt>Conversation governance</dt><dd>Signed policy active</dd></div></dl></Card.Content></Card><Card className="dashboard-panel"><Card.Header><div><Card.Title>Security activity</Card.Title><Card.Description>Policy blocks over the selected period</Card.Description></div></Card.Header><Card.Content><LineChart title="Policy blocks" data={(data?.timeseries ?? []).map((point) => ({ label: new Date(point.dayStart).toLocaleDateString(), value: point.policyBlocks }))} /></Card.Content></Card></section>}
    </div>
  );
}
