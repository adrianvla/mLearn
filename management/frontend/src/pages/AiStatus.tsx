import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { Cloud, Cpu, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, statusToColor } from '../components/shared';
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
              <CardHeader className="flex items-center gap-3 pb-0">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary">
                  <Cpu className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-foreground">Local AI</h2>
                  <p className="text-xs text-default-500">On-device inference</p>
                </div>
                <Chip
                  size="sm"
                  variant="flat"
                  color={data.local_ai.enabled ? 'success' : 'default'}
                >
                  {data.local_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </CardHeader>
              <CardBody className="pt-4">
                <div className="flex items-center justify-between border-b border-default-100 py-2 last:border-0">
                  <span className="text-sm text-default-500">Provider</span>
                  <span className="text-sm font-medium text-foreground">
                    {data.local_ai.provider_name ?? '—'}
                  </span>
                </div>
                {data.local_ai.service_status && (
                  <div className="flex items-center justify-between border-b border-default-100 py-2 last:border-0">
                    <span className="text-sm text-default-500">Service status</span>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={statusToColor(data.local_ai.service_status)}
                    >
                      {data.local_ai.service_status}
                    </Chip>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center gap-3 pb-0">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary">
                  <Cloud className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-foreground">Cloud AI</h2>
                  <p className="text-xs text-default-500">Remote LLM providers</p>
                </div>
                <Chip
                  size="sm"
                  variant="flat"
                  color={data.cloud_ai.enabled ? 'success' : 'default'}
                >
                  {data.cloud_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </CardHeader>
              <CardBody className="pt-4">
                <div>
                  <p className="mb-2 text-sm text-default-500">Providers</p>
                  {data.cloud_ai.provider_names.length === 0 ? (
                    <span className="text-sm text-default-400">No cloud providers configured</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.cloud_ai.provider_names.map((name) => (
                        <Chip key={name} size="sm" variant="flat" color="primary">
                          {name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>

          {data.cloud_ai.enabled && (
            <Card className="border border-warning-200 bg-warning-50">
              <CardBody>
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-semibold text-warning">Age-gating required</p>
                    <p className="mt-1 text-sm text-default-700">{ageGateMessage}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-100 text-warning">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Warnings</h2>
                <p className="text-xs text-default-500">Issues detected by the AI subsystem</p>
              </div>
              <Chip size="sm" variant="flat" color={data.warnings.length === 0 ? 'success' : 'warning'}>
                {data.warnings.length}
              </Chip>
            </CardHeader>
            <CardBody className="pt-4">
              {data.warnings.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg bg-success-50 px-4 py-3 text-success">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">No warnings — everything looks healthy.</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.warnings.map((w) => (
                    <li
                      key={w}
                      className="flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <span className="text-sm text-default-700">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
