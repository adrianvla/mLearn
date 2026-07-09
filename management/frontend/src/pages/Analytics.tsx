import { Card, CardContent, CardHeader, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
import { CheckCircle2, Activity, BarChart3 } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow, StatCard } from '../components/shared';
import type { AnalyticsDto, AnalyticsEvent } from '../api/types';

const severityToColor = (severity: AnalyticsEvent['severity']): 'default' | 'warning' | 'danger' => {
  if (severity === 'warning') return 'warning';
  if (severity === 'error') return 'danger';
  return 'default';
};

export default function Analytics() {
  const { data, loading, error } = useApi(() => api.getAnalytics());

  return (
    <PageContainer>
      <PageHeader title="Analytics" subtitle="Usage metrics, opt-in telemetry, events, and log streams" />
      {loading && !data && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {data && <AnalyticsContent data={data} />}
    </PageContainer>
  );
}

function AnalyticsContent({ data }: { data: AnalyticsDto }) {
  const summary = data.llm_summary;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requests Today" value={summary.requests_today} color="accent" />
        <StatCard label="Est. Tokens Today" value={summary.estimated_tokens_today} />
        <StatCard label="Blocked by Policy" value={summary.blocked_by_policy} color="danger" />
        <StatCard label="Avg Latency (ms)" value={summary.average_latency_ms} />
      </div>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <CheckCircle2 className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Opt-In Settings</h2>
        </CardHeader>
        <CardContent>
          <InfoRow label="Enabled">
            <Chip color={data.opt_in.enabled ? 'success' : 'default'} variant="flat" size="sm">
              {data.opt_in.enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Retention Days">{data.opt_in.retention_days}</InfoRow>
          <InfoRow label="Redact Prompts">
            <Chip color={data.opt_in.redact_prompts ? 'success' : 'default'} variant="flat" size="sm">
              {data.opt_in.redact_prompts ? 'Yes' : 'No'}
            </Chip>
          </InfoRow>
          <InfoRow label="Collect Client Events">
            <Chip color={data.opt_in.collect_client_events ? 'success' : 'default'} variant="flat" size="sm">
              {data.opt_in.collect_client_events ? 'Yes' : 'No'}
            </Chip>
          </InfoRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Activity className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Recent Events</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Recent analytics events" removeWrapper>
            <TableHeader>
              <TableColumn>Time</TableColumn>
              <TableColumn>Category</TableColumn>
              <TableColumn>Summary</TableColumn>
              <TableColumn>Severity</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No recent events">
              {data.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="tabular-nums">{event.time}</TableCell>
                  <TableCell>{event.category}</TableCell>
                  <TableCell>{event.summary}</TableCell>
                  <TableCell>
                    <Chip color={severityToColor(event.severity)} variant="flat" size="sm">
                      {event.severity}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <BarChart3 className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Log Streams</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Log streams" removeWrapper>
            <TableHeader>
              <TableColumn>Label</TableColumn>
              <TableColumn>Enabled</TableColumn>
              <TableColumn>Destination</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No log streams">
              {data.log_streams.map((stream) => (
                <TableRow key={stream.id}>
                  <TableCell>{stream.label}</TableCell>
                  <TableCell>
                    <Chip color={stream.enabled ? 'success' : 'default'} variant="flat" size="sm">
                      {stream.enabled ? 'Yes' : 'No'}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{stream.destination}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
