import { Card, Chip, Table } from '@heroui/react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow, StatCard, severityColor } from '../components/shared';
import type { AnalyticsDto } from '../api/types';

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
        <Card.Header>
          <Card.Title>Opt-In Settings</Card.Title>
        </Card.Header>
        <Card.Content>
          <InfoRow label="Enabled">
            <Chip color={data.opt_in.enabled ? 'success' : 'default'} variant="soft" size="sm">
              {data.opt_in.enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Retention Days">{data.opt_in.retention_days}</InfoRow>
          <InfoRow label="Redact Prompts">
            <Chip color={data.opt_in.redact_prompts ? 'success' : 'default'} variant="soft" size="sm">
              {data.opt_in.redact_prompts ? 'Yes' : 'No'}
            </Chip>
          </InfoRow>
          <InfoRow label="Collect Client Events">
            <Chip color={data.opt_in.collect_client_events ? 'success' : 'default'} variant="soft" size="sm">
              {data.opt_in.collect_client_events ? 'Yes' : 'No'}
            </Chip>
          </InfoRow>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Recent Events</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Recent analytics events" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Time</Table.Column>
                  <Table.Column>Category</Table.Column>
                  <Table.Column>Summary</Table.Column>
                  <Table.Column>Severity</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.events.map((event) => (
                    <Table.Row key={event.id}>
                      <Table.Cell className="tabular-nums">{event.time}</Table.Cell>
                      <Table.Cell>{event.category}</Table.Cell>
                      <Table.Cell>{event.summary}</Table.Cell>
                      <Table.Cell>
                        <Chip color={severityColor(event.severity)} variant="soft" size="sm">
                          {event.severity}
                        </Chip>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Log Streams</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Log streams" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Label</Table.Column>
                  <Table.Column>Enabled</Table.Column>
                  <Table.Column>Destination</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.log_streams.map((stream) => (
                    <Table.Row key={stream.id}>
                      <Table.Cell>{stream.label}</Table.Cell>
                      <Table.Cell>
                        <Chip color={stream.enabled ? 'success' : 'default'} variant="soft" size="sm">
                          {stream.enabled ? 'Yes' : 'No'}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs">{stream.destination}</span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>
    </div>
  );
}
