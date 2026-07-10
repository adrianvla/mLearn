use std::collections::{HashMap, HashSet};
use std::convert::AsRef;
use std::time::{SystemTime, UNIX_EPOCH};

use bollard::models::{
    ContainerInspectResponse, ContainerState, ContainerSummary, Health, HealthStatusEnum,
    PortSummaryTypeEnum, Volume,
};

use crate::config::{Config, DeploymentMode};
use crate::docker::{
    COMPOSE_CONFIG_FILES_LABEL, COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL,
};
use crate::dto::{
    AiConfig, ConfigDto, FeatureFlag, HealthSummary, PortMapping, ServiceCounts, ServiceDto,
    StoragePaths, VolumeInfo,
};
use crate::redaction::redact_map;

const STOPPED_STATES: [&str; 4] = ["exited", "dead", "created", "paused"];
const ERROR_STATES: [&str; 2] = ["restarting", "oom"];

pub fn container_to_service_dto(
    summary: &ContainerSummary,
    inspect: Option<&ContainerInspectResponse>,
) -> ServiceDto {
    let labels = summary.labels.as_ref();

    let service_name = labels
        .and_then(|map| map.get(COMPOSE_SERVICE_LABEL))
        .cloned();

    let container_name = summary
        .names
        .as_ref()
        .and_then(|names| names.first())
        .map(|name| name.strip_prefix('/').unwrap_or(name).to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let status = summary
        .state
        .as_ref()
        .map(|state| state.as_ref().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let health = inspect
        .and_then(|response| response.state.as_ref())
        .and_then(|state| state.health.as_ref())
        .map(health_status_string)
        .unwrap_or_else(|| "none".to_string());

    let image_raw = summary.image.clone().unwrap_or_else(|| "unknown".to_string());
    let tag = split_image_tag(&image_raw);

    let uptime_seconds = inspect
        .and_then(|response| response.state.as_ref())
        .and_then(compute_uptime);

    let port_service = service_name
        .clone()
        .unwrap_or_else(|| container_name.clone());
    let ports = build_port_mappings(summary, &port_service);

    let compose_project = labels
        .and_then(|map| map.get(COMPOSE_PROJECT_LABEL))
        .cloned();
    let compose_service = labels
        .and_then(|map| map.get(COMPOSE_SERVICE_LABEL))
        .cloned();
    let compose_config_files = labels
        .and_then(|map| map.get(COMPOSE_CONFIG_FILES_LABEL))
        .cloned();

    ServiceDto {
        id: summary.id.clone().unwrap_or_else(|| "unknown".to_string()),
        service_name,
        container_name,
        status,
        health,
        image: image_raw,
        tag,
        uptime_seconds,
        ports,
        compose_project,
        compose_service,
        compose_config_files,
    }
}

pub fn containers_to_counts(containers: &[ContainerSummary]) -> ServiceCounts {
    let mut running = 0usize;
    let mut stopped = 0usize;
    let mut error = 0usize;

    for container in containers {
        let state = container
            .state
            .as_ref()
            .map(|s| s.as_ref().to_string())
            .unwrap_or_default();

        if state == "running" {
            running += 1;
        } else if ERROR_STATES.iter().any(|s| *s == state) || state.contains("error") {
            error += 1;
        } else if STOPPED_STATES.iter().any(|s| *s == state) {
            stopped += 1;
        }
    }

    ServiceCounts {
        total: containers.len(),
        running,
        stopped,
        error,
    }
}

pub fn containers_to_health_summary(
    containers: &[ContainerSummary],
    inspects: &[ContainerInspectResponse],
) -> HealthSummary {
    let mut healthy = 0usize;
    let mut unhealthy = 0usize;
    let mut starting = 0usize;
    let mut none = 0usize;

    let inspect_by_id: HashMap<&str, &ContainerInspectResponse> = inspects
        .iter()
        .filter_map(|inspect| inspect.id.as_deref().map(|id| (id, inspect)))
        .collect();

    for container in containers {
        let Some(id) = container.id.as_deref() else {
            none += 1;
            continue;
        };

    let health_str = inspect_by_id
        .get(id)
        .and_then(|inspect| inspect.state.as_ref())
        .and_then(|state| state.health.as_ref())
        .map(health_status_string)
        .unwrap_or_else(|| "none".to_string());

        match health_str.as_str() {
            "healthy" => healthy += 1,
            "unhealthy" => unhealthy += 1,
            "starting" => starting += 1,
            _ => none += 1,
        }
    }

    HealthSummary {
        healthy,
        unhealthy,
        starting,
        none,
    }
}

pub fn extract_exposed_ports(containers: &[ContainerSummary]) -> Vec<PortMapping> {
    let mut seen: HashSet<(String, Option<u16>, u16, String)> = HashSet::new();
    let mut result: Vec<PortMapping> = Vec::new();

    for container in containers {
        let service = container
            .labels
            .as_ref()
            .and_then(|map| map.get(COMPOSE_SERVICE_LABEL))
            .cloned()
            .or_else(|| {
                container
                    .names
                    .as_ref()
                    .and_then(|names| names.first())
                    .map(|name| name.strip_prefix('/').unwrap_or(name).to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());

        let Some(ports) = container.ports.as_ref() else {
            continue;
        };

        for port in ports {
            let Some(host_port) = port.public_port else {
                continue;
            };

            let protocol = port_type_string(port.typ);
            let key = (
                service.clone(),
                Some(host_port),
                port.private_port,
                protocol.clone(),
            );

            if seen.insert(key) {
                result.push(PortMapping {
                    service: service.clone(),
                    host_port: Some(host_port),
                    container_port: port.private_port,
                    protocol,
                });
            }
        }
    }

    result
}

pub fn volume_to_dto(volume: &Volume, in_use_by: &[String]) -> VolumeInfo {
    let labels = redact_map(&volume.labels);

    VolumeInfo {
        name: volume.name.clone(),
        driver: volume.driver.clone(),
        mountpoint: volume.mountpoint.clone(),
        size_bytes: None,
        in_use_by: in_use_by.to_vec(),
        labels,
    }
}

pub fn build_config_dto(config: &Config) -> ConfigDto {
    let feature_flags = config
        .feature_flags
        .iter()
        .map(|(name, enabled)| FeatureFlag {
            name: name.clone(),
            enabled: *enabled,
        })
        .collect();

    ConfigDto {
        deployment_mode: deployment_mode_string(&config.deployment_mode),
        bind_address: config.bind_address.clone(),
        management_port: config.port,
        public_urls: Vec::new(),
        local_ai: AiConfig {
            enabled: config.local_ai_enabled,
            provider_name: config.local_ai_provider.clone(),
        },
        cloud_ai: AiConfig {
            enabled: config.cloud_ai_enabled,
            provider_name: config.cloud_ai_providers.first().cloned(),
        },
        storage_paths: StoragePaths {
            language_data: config.language_data_path.clone(),
            ocr_data: config.ocr_data_path.clone(),
            model_cache: config.model_cache_path.clone(),
            app_data: config.app_data_path.clone(),
            db: config.db_path.clone(),
            uploads: config.uploads_path.clone(),
        },
        feature_flags,
    }
}

fn split_image_tag(image: &str) -> Option<String> {
    let last_colon = image.rfind(':')?;
    let candidate = &image[last_colon + 1..];

    if candidate.is_empty() || candidate.contains('/') {
        None
    } else {
        Some(candidate.to_string())
    }
}

fn health_status_string(health: &Health) -> String {
    health
        .status
        .map(health_enum_string)
        .unwrap_or_else(|| "none".to_string())
}

fn health_enum_string(status: HealthStatusEnum) -> String {
    let value = status.as_ref();
    if value.is_empty() {
        "none".to_string()
    } else {
        value.to_string()
    }
}

fn port_type_string(typ: Option<PortSummaryTypeEnum>) -> String {
    match typ {
        Some(value) => {
            let value_str = value.as_ref();
            if value_str.is_empty() {
                "tcp".to_string()
            } else {
                value_str.to_string()
            }
        }
        None => "tcp".to_string(),
    }
}

fn build_port_mappings(summary: &ContainerSummary, service: &str) -> Vec<PortMapping> {
    let Some(ports) = summary.ports.as_ref() else {
        return Vec::new();
    };

    ports
        .iter()
        .map(|port| PortMapping {
            service: service.to_string(),
            host_port: port.public_port,
            container_port: port.private_port,
            protocol: port_type_string(port.typ),
        })
        .collect()
}

fn compute_uptime(state: &ContainerState) -> Option<u64> {
    if state.running != Some(true) {
        return None;
    }

    let started_at = state.started_at.as_ref()?;
    let started_secs = parse_rfc3339_seconds(started_at)?;

    if started_secs < 0 {
        return None;
    }

    let started_u64 = started_secs as u64;
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .ok()?;

    if now_secs <= started_u64 {
        return None;
    }

    Some(now_secs - started_u64)
}

fn deployment_mode_string(mode: &DeploymentMode) -> String {
    match mode {
        DeploymentMode::LocalOnly => "local-only".to_string(),
        DeploymentMode::SelfHosted => "self-hosted".to_string(),
        DeploymentMode::CloudConnected => "cloud-connected".to_string(),
    }
}

fn parse_rfc3339_seconds(value: &str) -> Option<i64> {
    let (date_part, time_part, tz_offset) = split_rfc3339(value)?;
    let (year, month, day) = parse_date(date_part)?;
    let (hour, minute, second) = parse_time(time_part)?;

    let days = days_from_civil(year, month, day)?;
    let secs = days * 86400
        + (hour as i64) * 3600
        + (minute as i64) * 60
        + (second as i64)
        - tz_offset;

    Some(secs)
}

fn split_rfc3339(value: &str) -> Option<(&str, &str, i64)> {
    let t_index = value.find('T')?;
    let date = &value[..t_index];
    let rest = &value[t_index + 1..];

    if let Some(stripped) = rest.strip_suffix('Z') {
        return Some((date, stripped, 0));
    }

    let tz_index = rest.rfind(['+', '-'])?;
    let time = &rest[..tz_index];
    let tz = &rest[tz_index..];

    let sign = if tz.starts_with('-') { -1i64 } else { 1i64 };
    let tz_body = &tz[1..];
    let mut tz_parts = tz_body.split(':');
    let tz_h: i64 = tz_parts.next()?.parse().ok()?;
    let tz_m: i64 = tz_parts.next().unwrap_or("0").parse().ok()?;

    Some((date, time, sign * (tz_h * 3600 + tz_m * 60)))
}

fn parse_date(value: &str) -> Option<(i64, u32, u32)> {
    let mut parts = value.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    Some((year, month, day))
}

fn parse_time(value: &str) -> Option<(u32, u32, u32)> {
    let hms = match value.find('.') {
        Some(idx) => &value[..idx],
        None => value,
    };

    let mut parts = hms.split(':');
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = parts.next()?.parse().ok()?;
    let second: u32 = parts.next().unwrap_or("0").parse().ok()?;

    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    Some((hour, minute, second))
}

fn days_from_civil(year: i64, month: u32, day: u32) -> Option<i64> {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let m = month;
    let shifted_month = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * shifted_month + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;

    Some(era * 146097 + doe as i64 - 719468)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{
        ContainerInspectResponse, ContainerState, ContainerSummary, ContainerSummaryStateEnum,
        Health, HealthStatusEnum, PortSummary, PortSummaryTypeEnum, Volume,
    };
    use crate::config::{Config, DeploymentMode, EnvMode};
    use std::collections::HashMap;

    fn label(key: &str, value: &str) -> HashMap<String, String> {
        let mut map = HashMap::new();
        map.insert(key.to_string(), value.to_string());
        map
    }

    fn labels_with(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn container_to_service_dto_with_full_data() {
        let labels = labels_with(&[
            (COMPOSE_PROJECT_LABEL, "mlearn"),
            (COMPOSE_SERVICE_LABEL, "backend"),
            (COMPOSE_CONFIG_FILES_LABEL, "/opt/mlearn/docker-compose.yml"),
        ]);

        let summary = ContainerSummary {
            id: Some("abc123".to_string()),
            names: Some(vec!["/mlearn-backend-1".to_string()]),
            image: Some("mlearn/backend:1.2.3".to_string()),
            labels: Some(labels),
            state: Some(ContainerSummaryStateEnum::RUNNING),
            ports: Some(vec![PortSummary {
                ip: None,
                private_port: 7752,
                public_port: Some(7752),
                typ: Some(PortSummaryTypeEnum::TCP),
            }]),
            ..Default::default()
        };

        let mut state = ContainerState::default();
        state.running = Some(true);
        state.started_at = Some("2000-01-01T00:00:00Z".to_string());
        state.health = Some(Health {
            status: Some(HealthStatusEnum::HEALTHY),
            ..Default::default()
        });

        let inspect = ContainerInspectResponse {
            state: Some(state),
            ..Default::default()
        };

        let dto = container_to_service_dto(&summary, Some(&inspect));

        assert_eq!(dto.id, "abc123");
        assert_eq!(dto.service_name.as_deref(), Some("backend"));
        assert_eq!(dto.container_name, "mlearn-backend-1");
        assert_eq!(dto.status, "running");
        assert_eq!(dto.health, "healthy");
        assert_eq!(dto.image, "mlearn/backend:1.2.3");
        assert_eq!(dto.tag.as_deref(), Some("1.2.3"));
        assert!(dto.uptime_seconds.unwrap_or(0) > 0);
        assert_eq!(dto.ports.len(), 1);
        assert_eq!(dto.ports[0].container_port, 7752);
        assert_eq!(dto.ports[0].host_port, Some(7752));
        assert_eq!(dto.ports[0].protocol, "tcp");
        assert_eq!(dto.compose_project.as_deref(), Some("mlearn"));
        assert_eq!(dto.compose_service.as_deref(), Some("backend"));
        assert_eq!(
            dto.compose_config_files.as_deref(),
            Some("/opt/mlearn/docker-compose.yml")
        );
    }

    #[test]
    fn container_to_service_dto_handles_missing_fields() {
        let summary = ContainerSummary {
            id: None,
            names: None,
            image: None,
            labels: None,
            state: None,
            ports: None,
            ..Default::default()
        };

        let dto = container_to_service_dto(&summary, None);

        assert_eq!(dto.id, "unknown");
        assert!(dto.service_name.is_none());
        assert_eq!(dto.container_name, "unknown");
        assert_eq!(dto.status, "unknown");
        assert_eq!(dto.health, "none");
        assert_eq!(dto.image, "unknown");
        assert!(dto.tag.is_none());
        assert!(dto.uptime_seconds.is_none());
        assert!(dto.ports.is_empty());
        assert!(dto.compose_project.is_none());
        assert!(dto.compose_service.is_none());
        assert!(dto.compose_config_files.is_none());
    }

    #[test]
    fn container_to_service_dto_image_without_tag_yields_none_tag() {
        let labels = label(COMPOSE_SERVICE_LABEL, "svc");
        let summary = ContainerSummary {
            id: Some("id1".to_string()),
            names: Some(vec!["/svc-1".to_string()]),
            image: Some("registry.example.com/mlearn/svc".to_string()),
            labels: Some(labels),
            state: Some(ContainerSummaryStateEnum::RUNNING),
            ports: None,
            ..Default::default()
        };

        let dto = container_to_service_dto(&summary, None);

        assert_eq!(dto.image, "registry.example.com/mlearn/svc");
        assert!(dto.tag.is_none());
    }

    #[test]
    fn containers_to_counts_classifies_running_stopped_error() {
        let containers = vec![
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::RUNNING),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::RUNNING),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::EXITED),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::DEAD),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::CREATED),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::PAUSED),
                ..Default::default()
            },
            ContainerSummary {
                state: Some(ContainerSummaryStateEnum::RESTARTING),
                ..Default::default()
            },
            ContainerSummary {
                state: None,
                ..Default::default()
            },
        ];

        let counts = containers_to_counts(&containers);

        assert_eq!(counts.total, 8);
        assert_eq!(counts.running, 2);
        assert_eq!(counts.stopped, 4);
        assert_eq!(counts.error, 1);
    }

    #[test]
    fn extract_exposed_ports_deduplicates_across_containers() {
        let labels = labels_with(&[(COMPOSE_SERVICE_LABEL, "backend")]);

        let summary = ContainerSummary {
            id: Some("a".to_string()),
            labels: Some(labels.clone()),
            ports: Some(vec![
                PortSummary {
                    ip: None,
                    private_port: 7752,
                    public_port: Some(7752),
                    typ: Some(PortSummaryTypeEnum::TCP),
                },
                PortSummary {
                    ip: None,
                    private_port: 8080,
                    public_port: None,
                    typ: Some(PortSummaryTypeEnum::TCP),
                },
            ]),
            ..Default::default()
        };

        let duplicate = ContainerSummary {
            id: Some("b".to_string()),
            labels: Some(labels),
            ports: Some(vec![PortSummary {
                ip: None,
                private_port: 7752,
                public_port: Some(7752),
                typ: Some(PortSummaryTypeEnum::TCP),
            }]),
            ..Default::default()
        };

        let ports = extract_exposed_ports(&[summary, duplicate]);

        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].service, "backend");
        assert_eq!(ports[0].host_port, Some(7752));
        assert_eq!(ports[0].container_port, 7752);
        assert_eq!(ports[0].protocol, "tcp");
    }

    #[test]
    fn volume_to_dto_redacts_sensitive_labels() {
        let mut labels = HashMap::new();
        labels.insert("PORT".to_string(), "3000".to_string());
        labels.insert(
            "API_KEY".to_string(),
            "sk-abcdefghijklmnopqrstuvwxyz1234567890".to_string(),
        );

        let volume = Volume {
            name: "mlearn-data".to_string(),
            driver: "local".to_string(),
            mountpoint: "/var/lib/docker/volumes/mlearn-data/_data".to_string(),
            created_at: None,
            status: None,
            labels,
            scope: None,
            cluster_volume: None,
            options: HashMap::new(),
            usage_data: None,
        };

        let dto = volume_to_dto(&volume, &["mlearn-backend-1".to_string()]);

        assert_eq!(dto.name, "mlearn-data");
        assert_eq!(dto.driver, "local");
        assert!(dto.mountpoint.ends_with("mlearn-data/_data"));
        assert!(dto.size_bytes.is_none());
        assert_eq!(dto.in_use_by, vec!["mlearn-backend-1".to_string()]);
        assert_eq!(dto.labels.get("PORT").map(String::as_str), Some("3000"));
        assert_eq!(
            dto.labels.get("API_KEY").map(String::as_str),
            Some("[REDACTED]")
        );
    }

    #[test]
    fn build_config_dto_maps_all_fields() {
        let config = Config {
            bind_address: "0.0.0.0".to_string(),
            port: 4000,
            public_url: "https://school.example".to_string(),
            compose_project: "mlearn".to_string(),
            management_db_path: "/data/management.db".to_string(),
            policy_signing_key_path: "/data/policy-signing-key".to_string(),
            encryption_key_path: "/data/encryption-key".to_string(),
            encryption_key: None,
            token_hash: None,
            env_mode: EnvMode::Production,
            deployment_mode: DeploymentMode::CloudConnected,
            app_version: Some("2.0.0".to_string()),
            local_ai_enabled: true,
            local_ai_provider: Some("ollama".to_string()),
            cloud_ai_enabled: true,
            cloud_ai_providers: vec!["openai".to_string(), "anthropic".to_string()],
            language_data_path: Some("/data/lang".to_string()),
            ocr_data_path: Some("/data/ocr".to_string()),
            model_cache_path: Some("/data/models".to_string()),
            app_data_path: None,
            db_path: Some("/data/db".to_string()),
            uploads_path: None,
            feature_flags: vec![("feature_x".to_string(), true)],
        };

        let dto = build_config_dto(&config);

        assert_eq!(dto.deployment_mode, "cloud-connected");
        assert_eq!(dto.bind_address, "0.0.0.0");
        assert_eq!(dto.management_port, 4000);
        assert!(dto.public_urls.is_empty());
        assert!(dto.local_ai.enabled);
        assert_eq!(dto.local_ai.provider_name.as_deref(), Some("ollama"));
        assert!(dto.cloud_ai.enabled);
        assert_eq!(dto.cloud_ai.provider_name.as_deref(), Some("openai"));
        assert_eq!(
            dto.storage_paths.language_data.as_deref(),
            Some("/data/lang")
        );
        assert_eq!(dto.storage_paths.app_data, None);
        assert_eq!(dto.feature_flags.len(), 1);
        assert_eq!(dto.feature_flags[0].name, "feature_x");
        assert!(dto.feature_flags[0].enabled);
    }

    #[test]
    fn parse_rfc3339_handles_docker_timestamps() {
        assert_eq!(
            parse_rfc3339_seconds("1970-01-01T00:00:00Z"),
            Some(0)
        );
        assert_eq!(
            parse_rfc3339_seconds("1970-01-01T00:00:01.500000000Z"),
            Some(1)
        );
        assert_eq!(
            parse_rfc3339_seconds("1970-01-02T00:00:00Z"),
            Some(86400)
        );
        assert_eq!(
            parse_rfc3339_seconds("2024-01-01T00:00:00Z"),
            Some(1704067200)
        );
        assert_eq!(
            parse_rfc3339_seconds("2024-01-01T01:00:00+01:00"),
            Some(1704067200)
        );
        assert!(parse_rfc3339_seconds("not a timestamp").is_none());
    }
}
