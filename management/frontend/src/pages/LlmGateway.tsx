import { Card, CardContent, CardHeader, Chip, TableCell } from '@heroui/react';
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
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Kind</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Models</th>
            </thead>
            <tbody>
              {data.providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}</td>
                  <td>
                    <Chip color={kindToColor(provider.kind)} variant="flat" size="sm">
                      {provider.kind}
                    </Chip>
                  </td>
                  <td>
                    <Chip color={statusToColor(provider.status)} variant="flat" size="sm">
                      {provider.status}
                    </Chip>
                  </td>
                  <td>{provider.models.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Activity className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Routing Rules</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Label</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Match</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Provider</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Fallback</th>
            </thead>
            <tbody>
              {data.routing_rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.label}</td>
                  <td>
                    <span className="font-mono text-xs">{rule.match}</span>
                  </td>
                  <td>{rule.provider}</td>
                  <td>{rule.fallback ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Network className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Language Profiles</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Language</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Locale</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Route</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Notes</th>
            </thead>
            <tbody>
              {data.language_profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>{profile.language}</td>
                  <td>{profile.locale}</td>
                  <td>{profile.route}</td>
                  <td>{profile.notes.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Database className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Budget Controls</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Label</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Limit</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Scope</th>
            </thead>
            <tbody>
              {data.budget_controls.map((control) => (
                <tr key={control.id}>
                  <td>{control.label}</td>
                  <td className="tabular-nums">{control.limit}</td>
                  <td>{control.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
