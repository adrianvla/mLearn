import { Avatar, Card, Chip } from '@heroui/react';
import { Cloud, Cpu, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  InfoRow,
  statusToColor,
} from '../components/shared';
import type { AiStatusDto } from '../api/types';

export default function AiStatus() {
  const { data, loading, error } = useApi<AiStatusDto>(() => api.getAiStatus());

  const ageGateMessage =
    data?.cloud_ai.school_mode_warning ??
    'Cloud AI is enabled. Enforce age-gating, parental consent, and content filters for all learner accounts before allowing access.';

  return (
    <PageContainer>
      <PageHeader title="AI Status" subtitle="Local and cloud AI provider posture" />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <Card.Header className="flex items-center gap-3 pb-0">
                <Avatar size="sm" color="accent">
                  <Avatar.Fallback><Cpu className="h-5 w-5" /></Avatar.Fallback>
                </Avatar>
                <div className="flex-1">
                  <Card.Title>Local AI</Card.Title>
                  <Card.Description>On-device inference</Card.Description>
                </div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.local_ai.enabled ? 'success' : 'default'}
                >
                  {data.local_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </Card.Header>
              <Card.Content className="pt-4">
                <InfoRow label="Provider">{data.local_ai.provider_name ?? '—'}</InfoRow>
                {data.local_ai.service_status && (
                  <InfoRow label="Service status">
                    <Chip
                      size="sm"
                      variant="soft"
                      color={statusToColor(data.local_ai.service_status)}
                    >
                      {data.local_ai.service_status}
                    </Chip>
                  </InfoRow>
                )}
              </Card.Content>
            </Card>

            <Card>
              <Card.Header className="flex items-center gap-3 pb-0">
                <Avatar size="sm" color="accent">
                  <Avatar.Fallback><Cloud className="h-5 w-5" /></Avatar.Fallback>
                </Avatar>
                <div className="flex-1">
                  <Card.Title>Cloud AI</Card.Title>
                  <Card.Description>Remote LLM providers</Card.Description>
                </div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.cloud_ai.enabled ? 'success' : 'default'}
                >
                  {data.cloud_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </Card.Header>
              <Card.Content className="pt-4">
                <div>
                  <p className="mb-2 text-sm text-muted">Providers</p>
                  {data.cloud_ai.provider_names.length === 0 ? (
                    <span className="text-sm text-muted">No cloud providers configured</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.cloud_ai.provider_names.map((name) => (
                        <Chip key={name} size="sm" variant="soft" color="accent">
                          {name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </Card.Content>
            </Card>
          </div>

          {data.cloud_ai.enabled && (
            <Card>
              <Card.Content>
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-semibold text-warning">Age-gating required</p>
                    <p className="mt-1 text-sm text-foreground">{ageGateMessage}</p>
                  </div>
                </div>
              </Card.Content>
            </Card>
          )}

          <Card>
            <Card.Header className="flex items-center gap-3 pb-0">
              <Avatar size="sm" color="warning">
                <Avatar.Fallback><AlertTriangle className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Warnings</Card.Title>
                <Card.Description>Issues detected by the AI subsystem</Card.Description>
              </div>
              <Chip size="sm" variant="soft" color={data.warnings.length === 0 ? 'success' : 'warning'}>
                {data.warnings.length}
              </Chip>
            </Card.Header>
            <Card.Content className="pt-4">
              {data.warnings.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg bg-surface-secondary px-4 py-3 text-success">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">No warnings — everything looks healthy.</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.warnings.map((w) => (
                    <li
                      key={w}
                      className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary px-4 py-3"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <span className="text-sm text-foreground">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Content>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
