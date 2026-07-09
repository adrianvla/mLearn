import { Card, Chip, Table } from '@heroui/react';
import { Server, Activity, Network, Database } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow, statusToColor, llmKindColor } from '../components/shared';
import type { LlmGatewayDto } from '../api/types';

export default function LlmGateway() {
  const { data, loading, error } = useApi(() => api.getLlmGateway());

  return (
    <PageContainer>
      <PageHeader title="LLM Gateway" subtitle="Providers, routing rules, language profiles, and budget controls" />
      {loading && !data && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {data && <GatewayContent data={data} />}
    </PageContainer>
  );
}

function GatewayContent({ data }: { data: LlmGatewayDto }) {
  return (
    <div className="grid gap-4">
      <Card>
        <Card.Header className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted" />
          <Card.Title>Gateway Status</Card.Title>
        </Card.Header>
        <Card.Content>
          <InfoRow label="Gateway Enabled">
            <Chip color={data.gateway_enabled ? 'success' : 'default'} variant="soft" size="sm">
              {data.gateway_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Server-Side Logging">
            <Chip color={data.server_side_logging ? 'success' : 'default'} variant="soft" size="sm">
              {data.server_side_logging ? 'On' : 'Off'}
            </Chip>
          </InfoRow>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted" />
          <Card.Title>Providers</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Providers" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Name</Table.Column>
                  <Table.Column>Kind</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Models</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.providers.map((provider) => (
                    <Table.Row key={provider.id}>
                      <Table.Cell>{provider.name}</Table.Cell>
                      <Table.Cell>
                        <Chip color={llmKindColor(provider.kind)} variant="soft" size="sm">
                          {provider.kind}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip color={statusToColor(provider.status)} variant="soft" size="sm">
                          {provider.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>{provider.models.join(', ')}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted" />
          <Card.Title>Routing Rules</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Routing rules" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Label</Table.Column>
                  <Table.Column>Match</Table.Column>
                  <Table.Column>Provider</Table.Column>
                  <Table.Column>Fallback</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.routing_rules.map((rule) => (
                    <Table.Row key={rule.id}>
                      <Table.Cell>{rule.label}</Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs">{rule.match}</span>
                      </Table.Cell>
                      <Table.Cell>{rule.provider}</Table.Cell>
                      <Table.Cell>{rule.fallback ?? '—'}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="flex items-center gap-2">
          <Network className="h-5 w-5 text-muted" />
          <Card.Title>Language Profiles</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Language profiles" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Language</Table.Column>
                  <Table.Column>Locale</Table.Column>
                  <Table.Column>Route</Table.Column>
                  <Table.Column>Notes</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.language_profiles.map((profile) => (
                    <Table.Row key={profile.id}>
                      <Table.Cell>{profile.language}</Table.Cell>
                      <Table.Cell>{profile.locale}</Table.Cell>
                      <Table.Cell>{profile.route}</Table.Cell>
                      <Table.Cell>{profile.notes.join('; ')}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted" />
          <Card.Title>Budget Controls</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Budget controls" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Label</Table.Column>
                  <Table.Column>Limit</Table.Column>
                  <Table.Column>Scope</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.budget_controls.map((control) => (
                    <Table.Row key={control.id}>
                      <Table.Cell>{control.label}</Table.Cell>
                      <Table.Cell className="tabular-nums">{control.limit}</Table.Cell>
                      <Table.Cell>{control.scope}</Table.Cell>
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
