import { Card, CardContent, CardHeader, Chip } from '@heroui/react';
import { Shield, ShieldAlert, ShieldCheck, CheckCircle2, Info } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow } from '../components/shared';
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
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent">
                <Shield className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Deployment Status</h2>
                <p className="text-xs text-muted">Active deployment configuration</p>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <InfoRow label="Deployment mode">
                <Chip size="sm" variant="flat" color="accent">
                  {data.deployment_mode}
                </Chip>
              </InfoRow>
              <InfoRow label="Public cloud LLM access">
                <Chip
                  size="sm"
                  variant="flat"
                  color={data.public_cloud_llm_access ? 'warning' : 'success'}
                >
                  {data.public_cloud_llm_access ? 'Allowed' : 'Restricted'}
                </Chip>
              </InfoRow>
              <InfoRow label="Admin authentication">
                <Chip
                  size="sm"
                  variant="flat"
                  color={data.admin_auth_enabled ? 'success' : 'danger'}
                >
                  {data.admin_auth_enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </InfoRow>
              <InfoRow label="Console binding">
                <Chip
                  size="sm"
                  variant="flat"
                  color={data.console_bound_locally ? 'success' : 'warning'}
                >
                  {data.console_bound_locally ? 'Local only' : 'Remote accessible'}
                </Chip>
              </InfoRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  data.warnings.length === 0
                    ? 'bg-success-100 text-success'
                    : 'bg-danger-100 text-danger'
                }`}
              >
                {data.warnings.length === 0 ? (
                  <ShieldCheck className="h-5 w-5" />
                ) : (
                  <ShieldAlert className="h-5 w-5" />
                )}
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Safety Warnings</h2>
                <p className="text-xs text-muted">Automated deployment safety checks</p>
              </div>
              <Chip
                size="sm"
                variant="flat"
                color={data.warnings.length === 0 ? 'success' : 'danger'}
              >
                {data.warnings.length === 0
                  ? 'Passed'
                  : `${data.warnings.length} issue${data.warnings.length === 1 ? '' : 's'}`}
              </Chip>
            </CardHeader>
            <CardContent className="pt-4">
              {data.warnings.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg bg-success-50 px-6 py-10 text-success">
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
                      className="flex items-start gap-3 rounded-lg border border-danger bg-danger/10 px-4 py-3"
                    >
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                      <span className="text-sm font-medium text-danger">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-default text-muted">
                <Info className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Deployment Notes</h2>
                <p className="text-xs text-muted">Operator-provided guidance</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.notes.length}
              </Chip>
            </CardHeader>
            <CardContent className="pt-4">
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
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
