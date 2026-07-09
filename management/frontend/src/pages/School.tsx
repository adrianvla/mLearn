import { Avatar, Card, Chip } from '@heroui/react';
import { Shield, ShieldAlert, ShieldCheck, CheckCircle2, Info } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  InfoRow,
  deploymentModeColor,
} from '../components/shared';
import type { SchoolDto } from '../api/types';

export default function School() {
  const { data, loading, error } = useApi<SchoolDto>(() => api.getSchool());

  return (
    <PageContainer>
      <PageHeader title="School Deployment" subtitle="Safety posture and deployment configuration" />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && (
        <div className="space-y-4">
          <Card>
            <Card.Header className="flex items-center gap-3 pb-0">
              <Avatar size="sm" color="accent">
                <Avatar.Fallback><Shield className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Deployment Status</Card.Title>
                <Card.Description>Active deployment configuration</Card.Description>
              </div>
            </Card.Header>
            <Card.Content className="pt-4">
              <InfoRow label="Deployment mode">
                <Chip size="sm" variant="soft" color={deploymentModeColor(data.deployment_mode)}>
                  {data.deployment_mode}
                </Chip>
              </InfoRow>
              <InfoRow label="Public cloud LLM access">
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.public_cloud_llm_access ? 'warning' : 'success'}
                >
                  {data.public_cloud_llm_access ? 'Allowed' : 'Restricted'}
                </Chip>
              </InfoRow>
              <InfoRow label="Admin authentication">
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.admin_auth_enabled ? 'success' : 'danger'}
                >
                  {data.admin_auth_enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </InfoRow>
              <InfoRow label="Console binding">
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.console_bound_locally ? 'success' : 'warning'}
                >
                  {data.console_bound_locally ? 'Local only' : 'Remote accessible'}
                </Chip>
              </InfoRow>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header className="flex items-center gap-3 pb-0">
              <Avatar size="sm" color={data.warnings.length === 0 ? 'success' : 'danger'}>
                <Avatar.Fallback>
                  {data.warnings.length === 0 ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <ShieldAlert className="h-5 w-5" />
                  )}
                </Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Safety Warnings</Card.Title>
                <Card.Description>Automated deployment safety checks</Card.Description>
              </div>
              <Chip
                size="sm"
                variant="soft"
                color={data.warnings.length === 0 ? 'success' : 'danger'}
              >
                {data.warnings.length === 0
                  ? 'Passed'
                  : `${data.warnings.length} issue${data.warnings.length === 1 ? '' : 's'}`}
              </Chip>
            </Card.Header>
            <Card.Content className="pt-4">
              {data.warnings.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-secondary px-6 py-10 text-success">
                  <CheckCircle2 className="h-12 w-12" />
                  <span className="text-lg font-semibold">All checks passed</span>
                  <span className="text-sm text-muted">
                    No deployment safety issues detected.
                  </span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.warnings.map((w) => (
                    <li
                      key={w}
                      className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary px-4 py-3"
                    >
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                      <span className="text-sm font-medium text-danger">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header className="flex items-center gap-3 pb-0">
              <Avatar size="sm" color="default">
                <Avatar.Fallback><Info className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Deployment Notes</Card.Title>
                <Card.Description>Operator-provided guidance</Card.Description>
              </div>
              <Chip size="sm" variant="soft">
                {data.notes.length}
              </Chip>
            </Card.Header>
            <Card.Content className="pt-4">
              {data.notes.length === 0 ? (
                <p className="text-sm text-muted">No notes recorded.</p>
              ) : (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground marker:text-muted">
                  {data.notes.map((note) => (
                    <li key={note} className="leading-relaxed">
                      {note}
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
