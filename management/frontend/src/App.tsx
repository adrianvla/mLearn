import * as React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Cloud,
  DownloadCloud,
  FileText,
  Gauge,
  HardDrive,
  Languages,
  Lock,
  Network,
  Play,
  RefreshCcw,
  RotateCw,
  Search,
  Server,
  Settings,
  Shield,
  SquareTerminal,
  Users,
  XCircle,
} from 'lucide-react';
import appIcon from '../../../build/icons/128x128.png';
import { ApiError, AUTH_ERROR_EVENT, AuthError, TOKEN_KEY, createApiClient } from '@/api/client';
import type { AnalyticsDto, ConfigDto, DistributionDto, LlmGatewayDto, LogsDto, ServiceDto } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, compactNumber, formatBytes, formatUptime } from '@/lib/utils';
import { redactLine } from '@/redact';
import { containerStatusToVariant, deploymentModeToVariant, healthStatusToVariant, type BadgeVariant } from '@/status';

type PageId =
  | 'overview'
  | 'services'
  | 'logs'
  | 'config'
  | 'storage'
  | 'ai'
  | 'users'
  | 'distribution'
  | 'gateway'
  | 'analytics'
  | 'school';

interface NavItem {
  id: PageId;
  label: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  group: 'Operate' | 'Govern' | 'Intelligence';
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', description: 'Fleet state', icon: Gauge, group: 'Operate' },
  { id: 'services', label: 'Services', description: 'Containers', icon: Server, group: 'Operate' },
  { id: 'logs', label: 'Logs', description: 'Readable tails', icon: SquareTerminal, group: 'Operate' },
  { id: 'config', label: 'Config', description: 'Runtime settings', icon: Settings, group: 'Operate' },
  { id: 'storage', label: 'Storage', description: 'Volumes and mounts', icon: HardDrive, group: 'Operate' },
  { id: 'users', label: 'Users & Rules', description: 'Roles and locks', icon: Users, group: 'Govern' },
  { id: 'distribution', label: 'Distribution', description: 'LAN mirror/cache', icon: DownloadCloud, group: 'Govern' },
  { id: 'analytics', label: 'Analytics', description: 'Opt-in audit logs', icon: BarChart3, group: 'Govern' },
  { id: 'school', label: 'Guardrails', description: 'Deployment checks', icon: Shield, group: 'Govern' },
  { id: 'ai', label: 'AI Status', description: 'Local/cloud state', icon: Bot, group: 'Intelligence' },
  { id: 'gateway', label: 'LLM Gateway', description: 'Routes and budgets', icon: Network, group: 'Intelligence' },
];

const groupedNav = ['Operate', 'Govern', 'Intelligence'].map((group) => ({
  group,
  items: navItems.filter((item) => item.group === group),
}));

const pageTitles: Record<PageId, string> = {
  overview: 'Deployment Overview',
  services: 'Service Control',
  logs: 'Service Logs',
  config: 'Runtime Configuration',
  storage: 'Storage',
  ai: 'AI Status',
  users: 'Users & Rules',
  distribution: 'Download Distribution',
  gateway: 'Central LLM Gateway',
  analytics: 'Analytics & Logs',
  school: 'School Guardrails',
};

const client = createApiClient();

interface Resource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
}

export function App(): React.ReactElement {
  const [page, setPage] = React.useState<PageId>(() => readPageFromPath());
  const [authRequired, setAuthRequired] = React.useState(false);

  React.useEffect(() => {
    const handlePop = (): void => setPage(readPageFromPath());
    const handleAuth = (): void => setAuthRequired(true);

    window.addEventListener('popstate', handlePop);
    window.addEventListener(AUTH_ERROR_EVENT, handleAuth);

    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener(AUTH_ERROR_EVENT, handleAuth);
    };
  }, []);

  const navigate = (nextPage: PageId): void => {
    window.history.pushState(null, '', nextPage === 'overview' ? '/' : `/${nextPage}`);
    setPage(nextPage);
  };

  if (authRequired) {
    return <AuthPanel onTokenSaved={() => setAuthRequired(false)} />;
  }

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-border bg-card/80 lg:block">
        <div className="flex h-24 items-center gap-3 border-b border-border px-5">
          <img src={appIcon} alt="mLearn" className="size-12 rounded-lg" />
          <div>
            <div className="text-xl font-semibold">mLearn</div>
            <div className="text-sm text-muted-foreground">Self-host Manager</div>
          </div>
        </div>
        <nav className="flex flex-col gap-6 p-4">
          {groupedNav.map(({ group, items }) => (
            <div className="flex flex-col gap-2" key={group}>
              <div className="px-2 text-xs font-semibold uppercase text-muted-foreground">{group}</div>
              {items.map((item) => (
                <button
                  aria-current={item.id === page ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    item.id === page ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                  )}
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                >
                  <item.icon className="size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{item.label}</span>
                    <span className="block truncate text-xs">{item.description}</span>
                  </span>
                  {item.id === page ? <ChevronRight className="size-4" /> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-h-dvh lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Management console</div>
              <h1 className="text-2xl font-semibold tracking-normal">{pageTitles[page]}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">React</Badge>
              <Badge variant="secondary">Vite</Badge>
              <Badge variant="secondary">Tailwind</Badge>
              <Badge variant="secondary">shadcn/ui</Badge>
            </div>
          </div>
        </header>
        <div className="p-5">
          <Page page={page} />
        </div>
      </main>
    </div>
  );
}

function Page({ page }: { page: PageId }): React.ReactElement {
  switch (page) {
    case 'services':
      return <ServicesPage />;
    case 'logs':
      return <LogsPage />;
    case 'config':
      return <ConfigPage />;
    case 'storage':
      return <StoragePage />;
    case 'ai':
      return <AiPage />;
    case 'users':
      return <UsersPage />;
    case 'distribution':
      return <DistributionPage />;
    case 'gateway':
      return <GatewayPage />;
    case 'analytics':
      return <AnalyticsPage />;
    case 'school':
      return <SchoolPage />;
    case 'overview':
    default:
      return <OverviewPage />;
  }
}

function OverviewPage(): React.ReactElement {
  const resource = useResource(() => client.getOverview(), []);

  return (
    <ResourceState resource={resource}>
      {(overview) => (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Server} label="Services" value={`${overview.service_count.running}/${overview.service_count.total}`} detail="running" />
            <MetricCard icon={Activity} label="Health" value={`${overview.health.healthy}`} detail="healthy containers" variant={overview.health.unhealthy > 0 ? 'warning' : 'success'} />
            <MetricCard icon={Shield} label="Admin auth" value={overview.management_auth_enabled ? 'On' : 'Off'} detail="Bearer token gate" variant={overview.management_auth_enabled ? 'success' : 'warning'} />
            <MetricCard icon={Cloud} label="Cloud features" value={overview.cloud_features_enabled ? 'Enabled' : 'Disabled'} detail={overview.deployment_mode} variant={overview.cloud_features_enabled ? 'warning' : 'neutral'} />
          </div>
          {overview.docker_available ? null : (
            <AlertCard title="Docker is unavailable" message={overview.docker_error ?? 'The management server cannot reach the Docker daemon.'} />
          )}
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Exposed Ports</CardTitle>
                <CardDescription>What clients on this host can reach from the deployment.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Protocol</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.exposed_ports.map((port) => (
                      <TableRow key={`${port.service}-${port.host_port}-${port.container_port}`}>
                        <TableCell className="font-medium">{port.service}</TableCell>
                        <TableCell>{port.host_port ?? 'internal'}</TableCell>
                        <TableCell>{port.container_port}</TableCell>
                        <TableCell>{port.protocol}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Runtime</CardTitle>
                <CardDescription>Build and deployment identifiers reported by the server.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <KeyValue label="Manager version" value={overview.version} />
                <KeyValue label="mLearn version" value={overview.mlearn_version ?? 'not mounted'} />
                <KeyValue label="Compose project" value={overview.compose_project} />
                <KeyValue label="Deployment mode" value={<StatusBadge variant={deploymentModeToVariant(overview.deployment_mode)}>{overview.deployment_mode}</StatusBadge>} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ResourceState>
  );
}

function ServicesPage(): React.ReactElement {
  const services = useResource(() => client.getServices(), []);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const runAction = async (service: ServiceDto, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    setBusyId(service.id);
    setActionError(null);

    try {
      await client.performAction(service.id, action);
      services.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ResourceState resource={services}>
      {(data) => (
        <div className="flex flex-col gap-5">
          {actionError === null ? null : <AlertCard title="Service action failed" message={actionError} />}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Containers</CardTitle>
                <CardDescription>Actions call the Rust management API and Docker backend.</CardDescription>
              </div>
              <Button variant="outline" onClick={services.refresh}>
                <RefreshCcw data-icon="inline-start" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>Uptime</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>
                        <div className="font-medium">{service.service_name ?? service.container_name}</div>
                        <div className="text-xs text-muted-foreground">{service.container_name}</div>
                      </TableCell>
                      <TableCell><StatusBadge variant={containerStatusToVariant(service.status)}>{service.status}</StatusBadge></TableCell>
                      <TableCell><StatusBadge variant={healthStatusToVariant(service.health)}>{service.health}</StatusBadge></TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs">{service.image}:{service.tag ?? 'latest'}</TableCell>
                      <TableCell>{formatUptime(service.uptime_seconds)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button disabled={busyId === service.id} size="sm" variant="outline" onClick={() => runAction(service, 'start')}>
                            <Play data-icon="inline-start" />
                            Start
                          </Button>
                          <Button disabled={busyId === service.id} size="sm" variant="outline" onClick={() => runAction(service, 'restart')}>
                            <RotateCw data-icon="inline-start" />
                            Restart
                          </Button>
                          <Button disabled={busyId === service.id} size="sm" variant="destructive" onClick={() => runAction(service, 'stop')}>
                            <CircleStop data-icon="inline-start" />
                            Stop
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function LogsPage(): React.ReactElement {
  const services = useResource(() => client.getServices(), []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const activeId = selectedId ?? services.data?.[0]?.id ?? null;
  const logs = useResource(() => (activeId === null ? Promise.resolve<LogsDto>({ service_id: '', lines: [], truncated: false }) : client.getLogs(activeId, 300)), [activeId]);

  return (
    <ResourceState resource={services}>
      {(data) => (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Log Tail</CardTitle>
                <CardDescription>Redacted, readable Docker log lines from the selected service.</CardDescription>
              </div>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={activeId ?? ''}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {data.map((service) => (
                    <option key={service.id} value={service.id}>{service.service_name ?? service.container_name}</option>
                  ))}
                </select>
                <Button variant="outline" onClick={logs.refresh}>
                  <RefreshCcw data-icon="inline-start" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {logs.error === null ? null : <AlertCard title="Could not load logs" message={logs.error.message} />}
              <div className="log-scrollbar max-h-[68vh] overflow-auto rounded-md border border-border bg-black/30 p-4 font-mono text-xs leading-6">
                {logs.data?.lines.map((line, index) => (
                  <div className="grid grid-cols-[84px_92px_1fr] gap-3 border-b border-border/40 py-1 last:border-b-0" key={`${line.timestamp ?? 'no-time'}-${index}`}>
                    <span className="text-muted-foreground">{line.timestamp ?? '--'}</span>
                    <span className={line.stream === 'stderr' ? 'text-red-200' : 'text-cyan-200'}>{line.stream}</span>
                    <span className="whitespace-pre-wrap break-words text-foreground">{redactLine(line.message)}</span>
                  </div>
                ))}
                {logs.data?.lines.length === 0 ? <EmptyState icon={FileText} title="No log lines" detail="The selected service did not return log output." /> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function ConfigPage(): React.ReactElement {
  const resource = useResource(() => client.getConfig(), []);

  return (
    <ResourceState resource={resource}>
      {(config) => (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Server Binding</CardTitle>
              <CardDescription>How the management console and self-host services are exposed.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <KeyValue label="Mode" value={config.deployment_mode} />
              <KeyValue label="Bind address" value={config.bind_address} />
              <KeyValue label="Management port" value={String(config.management_port)} />
              <KeyValue label="Public URLs" value={config.public_urls.length === 0 ? 'none' : config.public_urls.join(', ')} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>Server-side feature switches reported by the deployment.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {config.feature_flags.map((flag) => (
                <StatusBadge key={flag.name} variant={flag.enabled ? 'success' : 'neutral'}>{flag.name}</StatusBadge>
              ))}
            </CardContent>
          </Card>
          <RuntimeAiCard config={config} />
          <StoragePathsCard config={config} />
        </div>
      )}
    </ResourceState>
  );
}

function StoragePage(): React.ReactElement {
  const resource = useResource(() => client.getStorage(), []);

  return (
    <ResourceState resource={resource}>
      {(storage) => (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Docker Volumes</CardTitle>
              <CardDescription>Persistent storage owned by the self-host deployment.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Used by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {storage.volumes.map((volume) => (
                    <TableRow key={volume.name}>
                      <TableCell className="font-medium">{volume.name}</TableCell>
                      <TableCell>{volume.driver}</TableCell>
                      <TableCell>{formatBytes(volume.size_bytes)}</TableCell>
                      <TableCell>{volume.in_use_by.join(', ') || 'not mounted'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bind Mounts</CardTitle>
              <CardDescription>Host paths mounted into containers.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {storage.bind_mounts.map((mount) => (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm" key={`${mount.service}-${mount.destination}`}>
                  <div className="font-medium">{mount.service}</div>
                  <div className="mt-2 font-mono text-xs text-muted-foreground">{mount.source}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{mount.destination} ({mount.mode})</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function AiPage(): React.ReactElement {
  const resource = useResource(() => client.getAiStatus(), []);

  return (
    <ResourceState resource={resource}>
      {(ai) => (
        <div className="grid gap-5 xl:grid-cols-3">
          <AiStatusCard title="Local AI" enabled={ai.local_ai.enabled} provider={ai.local_ai.provider_name} detail={ai.local_ai.service_status ?? 'No service status'} />
          <AiStatusCard title="Cloud AI" enabled={ai.cloud_ai.enabled} provider={ai.cloud_ai.provider_names.join(', ') || null} detail={ai.cloud_ai.school_mode_warning ?? 'No server warning'} />
          <Card>
            <CardHeader>
              <CardTitle>Warnings</CardTitle>
              <CardDescription>Server-side checks that need operator attention.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {ai.warnings.map((warning) => <AlertInline key={warning} message={warning} />)}
              {ai.warnings.length === 0 ? <EmptyState icon={CheckCircle2} title="No AI warnings" detail="The management server did not report any AI routing issues." /> : null}
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function UsersPage(): React.ReactElement {
  const resource = useResource(() => client.getUsers(), []);

  return (
    <ResourceState resource={resource}>
      {(users) => (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 xl:grid-cols-3">
            {users.policy_presets.map((preset) => (
              <Card key={preset.id}>
                <CardHeader>
                  <CardTitle>{preset.name}</CardTitle>
                  <CardDescription>{preset.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <KeyValue label="Users" value={String(preset.user_count)} />
                  <div className="flex flex-wrap gap-2">
                    {preset.locked_settings.map((setting) => <Badge key={setting} variant="secondary">{setting}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Managed Users</CardTitle>
              <CardDescription>Policy assignments and device counts from the management server.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Devices</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.display_name}</TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell><StatusBadge variant={user.status === 'active' ? 'success' : user.status === 'restricted' ? 'warning' : 'error'}>{user.status}</StatusBadge></TableCell>
                      <TableCell>{user.policy}</TableCell>
                      <TableCell>{user.devices}</TableCell>
                      <TableCell>{user.last_seen ?? 'never'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Blocked Settings</CardTitle>
              <CardDescription>Settings the server policy prevents clients from changing.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {users.blocked_settings.map((rule) => (
                <div className="rounded-md border border-border bg-muted/30 p-3" key={rule.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{rule.label}</div>
                    <Badge variant="outline">{rule.scope}</Badge>
                  </div>
                  <div className="mt-2 font-mono text-xs text-muted-foreground">{rule.setting_key}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{rule.reason}</p>
                  {rule.enforced_value === null ? null : <div className="mt-2 text-xs text-muted-foreground">Enforced: {rule.enforced_value}</div>}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function DistributionPage(): React.ReactElement {
  const resource = useResource(() => client.getDistribution(), []);

  return (
    <ResourceState resource={resource}>
      {(distribution) => (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard icon={Archive} label="Mirror" value={distribution.catalog_mirror.enabled ? 'Enabled' : 'Off'} detail={distribution.catalog_mirror.catalog_url} variant={distribution.catalog_mirror.enabled ? 'success' : 'neutral'} />
            <MetricCard icon={Boxes} label="Cached items" value={String(distribution.catalog_mirror.item_count)} detail={formatBytes(distribution.catalog_mirror.cached_bytes)} />
            <MetricCard icon={Network} label="Last sync" value={distribution.catalog_mirror.last_sync ?? 'Never'} detail="language/app artifacts" variant={distribution.catalog_mirror.last_sync === null ? 'warning' : 'info'} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Local Distribution Cache</CardTitle>
              <CardDescription>Downloads that can be served from the Docker server instead of upstream.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>LAN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distribution.cache_items.map((item) => (
                    <TableRow key={`${item.kind}-${item.name}`}>
                      <TableCell>{item.kind}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.version}</TableCell>
                      <TableCell>{formatBytes(item.size_bytes)}</TableCell>
                      <TableCell><StatusBadge variant={item.served_locally ? 'success' : 'neutral'}>{item.served_locally ? 'served locally' : 'upstream'}</StatusBadge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="grid gap-5 xl:grid-cols-2">
            <EndpointCard endpoints={distribution.lan_endpoints} />
            <SyncRulesCard rules={distribution.sync_rules} />
          </div>
        </div>
      )}
    </ResourceState>
  );
}

function GatewayPage(): React.ReactElement {
  const resource = useResource(() => client.getLlmGateway(), []);

  return (
    <ResourceState resource={resource}>
      {(gateway) => (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard icon={Network} label="Gateway" value={gateway.gateway_enabled ? 'Enabled' : 'Disabled'} detail="server-side route point" variant={gateway.gateway_enabled ? 'success' : 'warning'} />
            <MetricCard icon={FileText} label="LLM logging" value={gateway.server_side_logging ? 'On' : 'Off'} detail="audit trail" variant={gateway.server_side_logging ? 'info' : 'neutral'} />
            <MetricCard icon={Bot} label="Providers" value={String(gateway.providers.length)} detail="local/cloud/proxy" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Routing Rules</CardTitle>
              <CardDescription>mLearn workflows that route through the centralized gateway.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 xl:grid-cols-2">
              {gateway.routing_rules.map((rule) => (
                <div className="rounded-md border border-border bg-muted/30 p-4" key={rule.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{rule.label}</div>
                    <Badge variant="info">{rule.provider}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{rule.match}</p>
                  <div className="mt-3 text-xs text-muted-foreground">Fallback: {rule.fallback ?? 'none'}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <ProviderCard gateway={gateway} />
            <LanguageRoutesCard gateway={gateway} />
          </div>
          <BudgetCard gateway={gateway} />
        </div>
      )}
    </ResourceState>
  );
}

function AnalyticsPage(): React.ReactElement {
  const resource = useResource(() => client.getAnalytics(), []);

  return (
    <ResourceState resource={resource}>
      {(analytics) => (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard icon={Activity} label="Requests today" value={compactNumber(analytics.llm_summary.requests_today)} detail="LLM gateway" />
            <MetricCard icon={BarChart3} label="Tokens today" value={compactNumber(analytics.llm_summary.estimated_tokens_today)} detail="estimated" />
            <MetricCard icon={Shield} label="Blocked" value={String(analytics.llm_summary.blocked_by_policy)} detail="by policy" variant={analytics.llm_summary.blocked_by_policy > 0 ? 'warning' : 'success'} />
            <MetricCard icon={Gauge} label="Latency" value={`${analytics.llm_summary.average_latency_ms} ms`} detail="average" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <CardHeader>
                <CardTitle>Opt-in Settings</CardTitle>
                <CardDescription>Telemetry status reported by the server, with prompt redaction surfaced explicitly.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <KeyValue label="Analytics" value={<StatusBadge variant={analytics.opt_in.enabled ? 'success' : 'neutral'}>{analytics.opt_in.enabled ? 'enabled' : 'disabled'}</StatusBadge>} />
                <KeyValue label="Retention" value={`${analytics.opt_in.retention_days} days`} />
                <KeyValue label="Prompt redaction" value={analytics.opt_in.redact_prompts ? 'enabled' : 'disabled'} />
                <KeyValue label="Client events" value={analytics.opt_in.collect_client_events ? 'collected' : 'not collected'} />
              </CardContent>
            </Card>
            <ActivityTimeline analytics={analytics} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Log Streams</CardTitle>
              <CardDescription>Server-side destinations for audit, policy, and client analytics events.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {analytics.log_streams.map((stream) => (
                <div className="rounded-md border border-border bg-muted/30 p-3" key={stream.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{stream.label}</div>
                    <StatusBadge variant={stream.enabled ? 'success' : 'neutral'}>{stream.enabled ? 'on' : 'off'}</StatusBadge>
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{stream.destination}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function SchoolPage(): React.ReactElement {
  const resource = useResource(() => client.getSchool(), []);

  return (
    <ResourceState resource={resource}>
      {(school) => (
        <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <CardHeader>
              <CardTitle>Deployment Checks</CardTitle>
              <CardDescription>Whether this server is appropriate for restricted environments.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <KeyValue label="Mode" value={school.deployment_mode} />
              <KeyValue label="Cloud LLM access" value={school.public_cloud_llm_access ? 'available' : 'blocked'} />
              <KeyValue label="Admin auth" value={school.admin_auth_enabled ? 'enabled' : 'disabled'} />
              <KeyValue label="Local binding" value={school.console_bound_locally ? 'local only' : 'network exposed'} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Operator Notes</CardTitle>
              <CardDescription>Warnings are actionable; notes describe the current server posture.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {school.warnings.map((warning) => <AlertInline key={warning} message={warning} />)}
              {school.notes.map((note) => (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground" key={note}>{note}</div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceState>
  );
}

function useResource<T>(loader: () => Promise<T>, deps: React.DependencyList): Resource<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loader()
      .then((nextData) => {
        if (!cancelled) {
          setData(nextData);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !(nextError instanceof AuthError)) {
          setError(nextError instanceof Error ? nextError : new Error('Request failed'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [...deps, version]);

  return { data, error, loading, refresh: () => setVersion((current) => current + 1) };
}

function ResourceState<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => React.ReactElement }): React.ReactElement {
  if (resource.loading && resource.data === null) {
    return <LoadingGrid />;
  }

  if (resource.error !== null) {
    const message = resource.error instanceof ApiError ? `${resource.error.status}: ${resource.error.message}` : resource.error.message;
    return <AlertCard title="Management API error" message={message} />;
  }

  if (resource.data === null) {
    return <EmptyState icon={Search} title="No data returned" detail="The management server returned an empty response." />;
  }

  return children(resource.data);
}

function AuthPanel({ onTokenSaved }: { onTokenSaved: () => void }): React.ReactElement {
  const [token, setToken] = React.useState('');

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    localStorage.setItem(TOKEN_KEY, token.trim());
    onTokenSaved();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="mb-3 flex items-center gap-3">
            <img src={appIcon} alt="mLearn" className="size-12 rounded-lg" />
            <Badge variant="warning">Authorization required</Badge>
          </div>
          <CardTitle className="text-2xl">Admin token required</CardTitle>
          <CardDescription>The management server rejected the saved token. Paste the current token printed by the backend, or run the reset command and restart.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <label className="text-sm font-medium" htmlFor="admin-token">Admin token</label>
            <div className="flex gap-2">
              <input
                autoComplete="off"
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                id="admin-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button disabled={token.trim().length === 0} type="submit">
                <Lock data-icon="inline-start" />
                Continue
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              CLI reset: <code className="rounded bg-muted px-1.5 py-0.5">cargo run -- reset-admin-token</code>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RuntimeAiCard({ config }: { config: ConfigDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Configuration</CardTitle>
        <CardDescription>Provider availability configured on the server.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <KeyValue label="Local AI" value={`${config.local_ai.enabled ? 'enabled' : 'disabled'} (${config.local_ai.provider_name ?? 'none'})`} />
        <KeyValue label="Cloud AI" value={`${config.cloud_ai.enabled ? 'enabled' : 'disabled'} (${config.cloud_ai.provider_name ?? 'none'})`} />
      </CardContent>
    </Card>
  );
}

function StoragePathsCard({ config }: { config: ConfigDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage Paths</CardTitle>
        <CardDescription>Paths the deployment uses for language data, models, app state, and uploads.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {Object.entries(config.storage_paths).map(([key, value]) => <KeyValue key={key} label={key.replaceAll('_', ' ')} value={value ?? 'not configured'} />)}
      </CardContent>
    </Card>
  );
}

function EndpointCard({ endpoints }: { endpoints: DistributionDto['lan_endpoints'] }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>LAN Endpoints</CardTitle>
        <CardDescription>Local URLs exposed to clients on the network.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {endpoints.map((endpoint) => (
          <div className="rounded-md border border-border bg-muted/30 p-3" key={endpoint.label}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{endpoint.label}</div>
              <StatusBadge variant={endpoint.status === 'online' ? 'success' : endpoint.status === 'degraded' ? 'warning' : 'error'}>{endpoint.status}</StatusBadge>
            </div>
            <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{endpoint.url}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SyncRulesCard({ rules }: { rules: DistributionDto['sync_rules'] }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync Rules</CardTitle>
        <CardDescription>How upstream downloads become local cache entries.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rules.map((rule) => (
          <div className="rounded-md border border-border bg-muted/30 p-3" key={rule.id}>
            <div className="font-medium">{rule.label}</div>
            <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground">
              <span>{rule.source}</span>
              <span>{rule.destination}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{rule.mode}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderCard({ gateway }: { gateway: LlmGatewayDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>Available local/cloud/proxy LLM providers behind the gateway.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {gateway.providers.map((provider) => (
          <div className="rounded-md border border-border bg-muted/30 p-3" key={provider.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{provider.name}</div>
              <StatusBadge variant={provider.status === 'ready' ? 'success' : provider.status === 'limited' ? 'warning' : 'neutral'}>{provider.status}</StatusBadge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{provider.kind}</Badge>
              {provider.models.map((model) => <Badge key={model} variant="secondary">{model}</Badge>)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LanguageRoutesCard({ gateway }: { gateway: LlmGatewayDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Language Routes</CardTitle>
        <CardDescription>Language package capabilities drive routing before LLM explanation.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {gateway.language_profiles.map((profile) => (
          <div className="rounded-md border border-border bg-muted/30 p-3" key={profile.id}>
            <div className="flex items-center gap-2">
              <Languages className="size-4 text-muted-foreground" />
              <div className="font-medium">{profile.language}</div>
              <Badge variant="outline">{profile.locale}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{profile.route}</p>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
              {profile.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BudgetCard({ gateway }: { gateway: LlmGatewayDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets & Data Boundaries</CardTitle>
        <CardDescription>Operational controls for when requests can leave the local server.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {gateway.budget_controls.map((control) => (
          <div className="rounded-md border border-border bg-muted/30 p-3" key={control.id}>
            <div className="font-medium">{control.label}</div>
            <p className="mt-2 text-sm text-muted-foreground">{control.limit}</p>
            <div className="mt-2 text-xs text-muted-foreground">{control.scope}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActivityTimeline({ analytics }: { analytics: AnalyticsDto }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Events</CardTitle>
        <CardDescription>Compact timeline pattern suited to operational review.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {analytics.events.map((event, index) => (
          <div className="grid grid-cols-[72px_20px_1fr] gap-3" key={event.id}>
            <div className="pt-0.5 font-mono text-xs text-muted-foreground">{event.time}</div>
            <div className="flex flex-col items-center">
              <span className={cn('mt-1 size-2 rounded-full', event.severity === 'error' ? 'bg-red-400' : event.severity === 'warning' ? 'bg-amber-300' : 'bg-cyan-300')} />
              {index < analytics.events.length - 1 ? <span className="mt-1 h-full w-px bg-border" /> : null}
            </div>
            <div className="pb-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">{event.category}</span>
                <StatusBadge variant={event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'info'}>{event.severity}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{event.summary}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AiStatusCard({ title, enabled, provider, detail }: { title: string; enabled: boolean; provider: string | null; detail: string }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{provider ?? 'No provider configured'}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <StatusBadge variant={enabled ? 'success' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</StatusBadge>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value, detail, variant = 'info' }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string; value: string; detail: string; variant?: BadgeVariant }): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          <div className="mt-1 max-w-[18rem] truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <div className={cn('rounded-md border p-2', badgeToneClass(variant))}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function AlertCard({ title, message }: { title: string; message: string }): React.ReactElement {
  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardContent className="flex gap-3 p-4">
        <AlertTriangle className="mt-0.5 size-5 text-red-200" />
        <div>
          <div className="font-medium text-red-100">{title}</div>
          <div className="mt-1 text-sm text-red-100/75">{message}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertInline({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; title: string; detail: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-8 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <div className="font-medium">{title}</div>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function LoadingGrid(): React.ReactElement {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="h-32 animate-pulse rounded-lg border border-border bg-card" key={index} />
      ))}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[70%] break-words text-right font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }): React.ReactElement {
  const badgeVariant = variant === 'error' ? 'destructive' : variant;
  const Icon = variant === 'error' ? XCircle : variant === 'success' ? CheckCircle2 : variant === 'warning' ? AlertTriangle : Activity;

  return (
    <Badge variant={badgeVariant}>
      <Icon className="mr-1 size-3" />
      {children}
    </Badge>
  );
}

function badgeToneClass(variant: BadgeVariant): string {
  switch (variant) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'error':
      return 'border-red-500/30 bg-red-500/10 text-red-200';
    case 'info':
      return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
    case 'neutral':
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function readPageFromPath(): PageId {
  const candidate = window.location.pathname.replace(/^\//, '') || 'overview';
  return navItems.some((item) => item.id === candidate) ? (candidate as PageId) : 'overview';
}
