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

export interface HealthDto {
  status: string;
}

export interface ErrorDto {
  error: string;
}
