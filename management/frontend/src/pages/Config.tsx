import { Card, CardContent, CardHeader, Chip } from '@heroui/react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow } from '../components/shared';

const NOT_CONFIGURED = 'not configured';

export default function Config() {
  const { data, loading, error } = useApi(() => api.getConfig(), []);

  return (
    <PageContainer>
      <PageHeader title="Config" subtitle="Safe deployment configuration (secrets masked)" />

      {loading ? (
        <LoadingState />
      ) : error !== null ? (
        <ErrorState message={error} />
      ) : data === null ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-foreground">Connection</h2>
            </CardHeader>
            <CardContent>
              <InfoRow label="Deployment Mode">{data.deployment_mode}</InfoRow>
              <InfoRow label="Bind Address">{data.bind_address}</InfoRow>
              <InfoRow label="Management Port">{data.management_port}</InfoRow>
              <InfoRow label="Public URLs">
                {data.public_urls.length === 0 ? 'none' : data.public_urls.join(', ')}
              </InfoRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-foreground">AI Configuration</h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-separator pb-4">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">Local AI</span>
                  <span className="text-xs text-muted">
                    {data.local_ai.provider_name ?? NOT_CONFIGURED}
                  </span>
                </div>
                <Chip color={data.local_ai.enabled ? 'success' : 'default'} variant="flat">
                  {data.local_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">Cloud AI</span>
                  <span className="text-xs text-muted">
                    {data.cloud_ai.provider_name ?? NOT_CONFIGURED}
                  </span>
                </div>
                <Chip color={data.cloud_ai.enabled ? 'success' : 'default'} variant="flat">
                  {data.cloud_ai.enabled ? 'Enabled' : 'Disabled'}
                </Chip>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-foreground">Storage Paths</h2>
            </CardHeader>
            <CardContent>
              <InfoRow label="Language Data">
                {data.storage_paths.language_data ?? NOT_CONFIGURED}
              </InfoRow>
              <InfoRow label="OCR Data">{data.storage_paths.ocr_data ?? NOT_CONFIGURED}</InfoRow>
              <InfoRow label="Model Cache">
                {data.storage_paths.model_cache ?? NOT_CONFIGURED}
              </InfoRow>
              <InfoRow label="App Data">{data.storage_paths.app_data ?? NOT_CONFIGURED}</InfoRow>
              <InfoRow label="Database">{data.storage_paths.db ?? NOT_CONFIGURED}</InfoRow>
              <InfoRow label="Uploads">{data.storage_paths.uploads ?? NOT_CONFIGURED}</InfoRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-foreground">Feature Flags</h2>
            </CardHeader>
            <CardContent>
              {data.feature_flags.length === 0 ? (
                <p className="text-sm text-muted">No feature flags reported</p>
              ) : (
                <div className="flex flex-col">
                  {data.feature_flags.map((flag) => (
                    <div
                      key={flag.name}
                      className="flex items-center justify-between border-b border-separator py-2 last:border-0"
                    >
                      <span className="text-sm font-medium text-foreground">{flag.name}</span>
                      <Chip size="sm" color={flag.enabled ? 'success' : 'default'} variant="flat">
                        {flag.enabled ? 'Enabled' : 'Disabled'}
                      </Chip>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
