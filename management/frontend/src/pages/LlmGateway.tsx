import { Card, CardContent, CardHeader, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
import { Server, Activity, Network, Database } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow, statusToColor } from '../components/shared';
import type { LlmGatewayDto, LlmProvider } from '../api/types';

const kindToColor = (kind: LlmProvider['kind']): 'primary' | 'warning' | 'secondary' => {
  if (kind === 'local') return 'primary';
  if (kind === 'cloud') return 'warning';
  return 'secondary';
};

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
        <CardHeader className="flex items-center gap-2 pb-0">
          <Server className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Gateway Status</h2>
        </CardHeader>
        <CardContent>
          <InfoRow label="Gateway Enabled">
            <Chip color={data.gateway_enabled ? 'success' : 'default'} variant="flat" size="sm">
              {data.gateway_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Server-Side Logging">
            <Chip color={data.server_side_logging ? 'success' : 'default'} variant="flat" size="sm">
              {data.server_side_logging ? 'On' : 'Off'}
            </Chip>
          </InfoRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Server className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Providers</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="LLM providers" removeWrapper>
            <TableHeader>
              <TableColumn>Name</TableColumn>
              <TableColumn>Kind</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn>Models</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No providers configured">
              {data.providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell>{provider.name}</TableCell>
                  <TableCell>
                    <Chip color={kindToColor(provider.kind)} variant="flat" size="sm">
                      {provider.kind}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Chip color={statusToColor(provider.status)} variant="flat" size="sm">
                      {provider.status}
                    </Chip>
                  </TableCell>
                  <TableCell>{provider.models.join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Activity className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Routing Rules</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Routing rules" removeWrapper>
            <TableHeader>
              <TableColumn>Label</TableColumn>
              <TableColumn>Match</TableColumn>
              <TableColumn>Provider</TableColumn>
              <TableColumn>Fallback</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No routing rules">
              {data.routing_rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.label}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{rule.match}</span>
                  </TableCell>
                  <TableCell>{rule.provider}</TableCell>
                  <TableCell>{rule.fallback ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Network className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Language Profiles</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Language profiles" removeWrapper>
            <TableHeader>
              <TableColumn>Language</TableColumn>
              <TableColumn>Locale</TableColumn>
              <TableColumn>Route</TableColumn>
              <TableColumn>Notes</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No language profiles">
              {data.language_profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell>{profile.language}</TableCell>
                  <TableCell>{profile.locale}</TableCell>
                  <TableCell>{profile.route}</TableCell>
                  <TableCell>{profile.notes.join('; ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Database className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Budget Controls</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Budget controls" removeWrapper>
            <TableHeader>
              <TableColumn>Label</TableColumn>
              <TableColumn>Limit</TableColumn>
              <TableColumn>Scope</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No budget controls">
              {data.budget_controls.map((control) => (
                <TableRow key={control.id}>
                  <TableCell>{control.label}</TableCell>
                  <TableCell className="tabular-nums">{control.limit}</TableCell>
                  <TableCell>{control.scope}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
