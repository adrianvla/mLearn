export interface OverviewDto {
  version: string;
  mlearn_version: string | null;
  deployment_mode: string;
  docker_available: boolean;
  docker_error: string | null;
  compose_project: string;
  service_count: ServiceCounts;
  exposed_ports: PortMapping[];
  health: HealthSummary;
  management_auth_enabled: boolean;
  cloud_features_enabled: boolean;
}

export interface ServiceCounts {
  total: number;
  running: number;
  stopped: number;
  error: number;
}

export interface HealthSummary {
  healthy: number;
  unhealthy: number;
  starting: number;
  none: number;
}

export interface PortMapping {
  service: string;
  host_port: number | null;
  container_port: number;
  protocol: string;
}

export interface ServiceDto {
  id: string;
  service_name: string | null;
  container_name: string;
  status: string;
  health: string;
  image: string;
  tag: string | null;
  uptime_seconds: number | null;
  ports: PortMapping[];
  compose_project: string | null;
  compose_service: string | null;
  compose_config_files: string | null;
}

export interface ServiceActionResponse {
  id: string;
  action: string;
  status: string;
}

export interface LogsDto {
  service_id: string;
  lines: LogLine[];
  truncated: boolean;
}

export interface LogLine {
  stream: string;
  timestamp: string | null;
  message: string;
}

export interface ConfigDto {
  deployment_mode: string;
  bind_address: string;
  management_port: number;
  public_urls: string[];
  local_ai: AiConfig;
  cloud_ai: AiConfig;
  storage_paths: StoragePaths;
  feature_flags: FeatureFlag[];
}

export interface AiConfig {
  enabled: boolean;
  provider_name: string | null;
}

export interface StoragePaths {
  language_data: string | null;
  ocr_data: string | null;
  model_cache: string | null;
  app_data: string | null;
  db: string | null;
  uploads: string | null;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
}

export interface StorageDto {
  volumes: VolumeInfo[];
  bind_mounts: BindMountInfo[];
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  size_bytes: number | null;
  in_use_by: string[];
  labels: Record<string, string>;
}

export interface BindMountInfo {
  service: string;
  source: string;
  destination: string;
  mode: string;
}

export interface AiStatusDto {
  local_ai: LocalAiStatus;
  cloud_ai: CloudAiStatus;
  warnings: string[];
}

export interface LocalAiStatus {
  enabled: boolean;
  provider_name: string | null;
  service_status: string | null;
}

export interface CloudAiStatus {
  enabled: boolean;
  provider_names: string[];
  school_mode_warning: string | null;
}

export interface SchoolDto {
  deployment_mode: string;
  public_cloud_llm_access: boolean;
  admin_auth_enabled: boolean;
  console_bound_locally: boolean;
  warnings: string[];
  notes: string[];
}

export interface UsersDto {
  users: ManagedUser[];
  policy_presets: PolicyPreset[];
  blocked_settings: BlockedSettingRule[];
}

export interface ManagedUser {
  id: string;
  display_name: string;
  role: 'admin' | 'teacher' | 'learner';
  status: 'active' | 'restricted' | 'disabled';
  policy: string;
  devices: number;
  last_seen: string | null;
}

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  user_count: number;
  locked_settings: string[];
}

export interface BlockedSettingRule {
  id: string;
  setting_key: string;
  label: string;
  scope: string;
  reason: string;
  enforced_value: string | null;
}

export interface DistributionDto {
  catalog_mirror: MirrorStatus;
  cache_items: CacheItem[];
  lan_endpoints: LanEndpoint[];
  sync_rules: SyncRule[];
}

export interface MirrorStatus {
  enabled: boolean;
  catalog_url: string;
  last_sync: string | null;
  cached_bytes: number;
  item_count: number;
}

export interface CacheItem {
  kind: string;
  name: string;
  version: string;
  size_bytes: number;
  served_locally: boolean;
}

export interface LanEndpoint {
  label: string;
  url: string;
  status: 'online' | 'offline' | 'degraded';
}

export interface SyncRule {
  id: string;
  label: string;
  source: string;
  destination: string;
  mode: string;
}

export interface LlmGatewayDto {
  gateway_enabled: boolean;
  server_side_logging: boolean;
  providers: LlmProvider[];
  routing_rules: LlmRouteRule[];
  language_profiles: LlmLanguageProfile[];
  budget_controls: BudgetControl[];
}

export interface LlmProvider {
  id: string;
  name: string;
  kind: 'local' | 'cloud' | 'proxy';
  status: 'ready' | 'limited' | 'offline';
  models: string[];
}

export interface LlmRouteRule {
  id: string;
  label: string;
  match: string;
  provider: string;
  fallback: string | null;
}

export interface LlmLanguageProfile {
  id: string;
  language: string;
  locale: string;
  route: string;
  notes: string[];
}

export interface BudgetControl {
  id: string;
  label: string;
  limit: string;
  scope: string;
}

export interface AnalyticsDto {
  opt_in: AnalyticsOptIn;
  llm_summary: LlmUsageSummary;
  events: AnalyticsEvent[];
  log_streams: LogStream[];
}

export interface AnalyticsOptIn {
  enabled: boolean;
  retention_days: number;
  redact_prompts: boolean;
  collect_client_events: boolean;
}

export interface LlmUsageSummary {
  requests_today: number;
  estimated_tokens_today: number;
  blocked_by_policy: number;
  average_latency_ms: number;
}

export interface AnalyticsEvent {
  id: string;
  time: string;
  category: string;
  summary: string;
  severity: 'info' | 'warning' | 'error';
}

export interface LogStream {
  id: string;
  label: string;
  enabled: boolean;
  destination: string;
}

export type Capability =
  | 'group.view' | 'group.manage'
  | 'members.view' | 'members.manage'
  | 'permissions.delegate'
  | 'policies.view' | 'policies.edit' | 'policies.publish'
  | 'analytics.view'
  | 'conversations.view' | 'conversations.export'
  | 'llm.configure' | 'api_keys.manage';

export interface AuthorizedGroupNode {
  id: string;
  name: string;
  /** The current backend eligible-groups response omits effective capabilities. */
  capabilities: readonly Capability[];
}

export interface AuthorizedUser {
  id: string;
  email: string;
  groups: AuthorizedGroupNode[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface AuthResponse {
  session: AuthSession;
  user: { id: string; email: string };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

export interface AnalyticsSummary {
  activeLearners: number; sessions: number; watchSeconds: number; completions: number;
  readerPages: number; flashcardEvents: number; llmRequests: number; inputTokens: number;
  outputTokens: number; totalTokens: number; costMicros: number; policyBlocks: number;
}
export interface TimeseriesPoint extends AnalyticsSummary { dayStart: number }
export interface LlmAnalytics { requests: number; inputTokens: number; outputTokens: number; totalTokens: number; costMicros: number }
export interface LearnerAnalytics extends AnalyticsSummary { learnerId: string; displayName: string; lastActivityAt: number }
export interface ScopedManagedUser { id:string;email:string;displayName:string;identityType:string;status:string;groupIds:string[] }
export interface GroupNode { id:string;parentId:string|null;name:string;slug:string;status:string }
export interface Membership { id:string;groupId:string;userId:string|null;invitedEmail:string|null;status:string;capabilities:Capability[] }
export interface CsvPreview { validRows:number;errors:Array<{row:number;message:string}> }
