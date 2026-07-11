import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { ApiClient } from "../api/client";
import type {
  AnalyticsSummary,
  LearnerAnalytics,
  TimeseriesPoint,
} from "../api/types";
import { LineChart } from "../components/LineChart";
import { MetricCard } from "../components/MetricCard";
import { PageToolbar } from "../components/PageToolbar";
import { useGroupScope } from "../groups/GroupScopeProvider";
const api = new ApiClient();
export default function Analytics() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [learners, setLearners] = useState<LearnerAnalytics[]>([]);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setSummary(null);
    setSeries([]);
    setLearners([]);
    if (!groupId) return;
    const controller = new AbortController();
    const query = `groupId=${encodeURIComponent(groupId)}`;
    Promise.all([
      api.get<AnalyticsSummary>(`/api/analytics/summary?${query}`, {
        signal: controller.signal,
      }),
      api.get<TimeseriesPoint[]>(`/api/analytics/timeseries?${query}`, {
        signal: controller.signal,
      }),
      api.get<{ items: LearnerAnalytics[] }>(
        `/api/analytics/learners?${query}`,
        { signal: controller.signal },
      ),
    ]).then(([s, t, l]) => {
      if (!controller.signal.aborted) {
        setSummary(s);
        setSeries(t);
        setLearners(l.items);
      }
    });
    return () => controller.abort();
  }, [groupId]);
  const exportCsv = () => {
    if (groupId)
      window.location.assign(
        `/api/analytics/export.csv?groupId=${encodeURIComponent(groupId)}&limit=200`,
      );
  };
  return (
    <div className="resource-page">
      <PageToolbar
        title="Analytics"
        description="Scoped learning, content, LLM usage, and policy outcomes."
        actions={
          scope.status === "ready" && scope.can("analytics.view") ? (
            <button
              className="secondary-action"
              onClick={() => setConfirm(true)}
            >
              <Download />
              Export CSV
            </button>
          ) : undefined
        }
      />
      <div className="detail-tabs" role="tablist">
        {["overview", "learners", "content", "llm usage", "policy blocks"].map(
          (name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ),
        )}
      </div>
      {tab === "overview" && (
        <>
          <section className="metric-grid">
            <MetricCard
              label="Active learners"
              value={summary?.activeLearners ?? "—"}
            />
            <MetricCard
              label="Content watched"
              value={`${Math.round((summary?.watchSeconds ?? 0) / 60)} min`}
            />
            <MetricCard
              label="LLM cost"
              value={((summary?.costMicros ?? 0) / 1_000_000).toFixed(2)}
            />
            <MetricCard
              label="Policy blocks"
              value={summary?.policyBlocks ?? "—"}
            />
          </section>
          <section className="dashboard-panel">
            <LineChart
              title="Learning sessions"
              data={series.map((point) => ({
                label: new Date(point.dayStart).toLocaleDateString(),
                value: point.sessions,
              }))}
            />
          </section>
        </>
      )}
      {tab === "learners" && (
        <div className="data-table-shell table-scroll">
          <table>
            <caption className="sr-only">Learner analytics</caption>
            <thead>
              <tr>
                <th>Learner</th>
                <th>Activity</th>
                <th>Completion</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Blocks</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((learner) => (
                <tr key={learner.learnerId}>
                  <th>{learner.displayName}</th>
                  <td>{learner.sessions} sessions</td>
                  <td>{learner.completions}</td>
                  <td>{learner.llmRequests}</td>
                  <td>{learner.totalTokens}</td>
                  <td>{(learner.costMicros / 1_000_000).toFixed(4)}</td>
                  <td>{learner.policyBlocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {["content", "llm usage", "policy blocks"].includes(tab) && (
        <section className="table-state">
          Select Overview or Learners for the current aggregate. Detailed {tab}{" "}
          data loads from the same authorized subtree.
        </section>
      )}
      {confirm && (
        <div className="dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            className="console-dialog"
          >
            <h2 id="export-title">Export learner analytics?</h2>
            <p>
              This export is policy-controlled and recorded in the audit log.
            </p>
            <footer>
              <button onClick={() => setConfirm(false)}>Cancel</button>
              <button onClick={exportCsv}>Confirm export</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
