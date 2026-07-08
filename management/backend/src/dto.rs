//! Safe Data Transfer Objects for the management API.
//!
//! These types are the **single source of truth** for the API contract.
//! The frontend `src/api/types.ts` mirrors them exactly.
//! Never expose raw bollard / Docker types to the frontend — always convert
//! through these DTOs via the `sanitize` module.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Overview
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OverviewDto {
    pub version: String,
    pub mlearn_version: Option<String>,
    pub deployment_mode: String,
    pub docker_available: bool,
    pub docker_error: Option<String>,
    pub compose_project: String,
    pub service_count: ServiceCounts,
    pub exposed_ports: Vec<PortMapping>,
    pub health: HealthSummary,
    pub management_auth_enabled: bool,
    pub cloud_features_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceCounts {
    pub total: usize,
    pub running: usize,
    pub stopped: usize,
    pub error: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HealthSummary {
    pub healthy: usize,
    pub unhealthy: usize,
    pub starting: usize,
    pub none: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PortMapping {
    pub service: String,
    pub host_port: Option<u16>,
    pub container_port: u16,
    pub protocol: String,
}

// ============================================================================
// Services
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceDto {
    pub id: String,
    pub service_name: Option<String>,
    pub container_name: String,
    pub status: String,
    pub health: String,
    pub image: String,
    pub tag: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub ports: Vec<PortMapping>,
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
    pub compose_config_files: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceActionResponse {
    pub id: String,
    pub action: String,
    pub status: String,
}

// ============================================================================
// Logs
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogsDto {
    pub service_id: String,
    pub lines: Vec<LogLine>,
    pub truncated: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogLine {
    /// "stdout" | "stderr"
    pub stream: String,
    pub timestamp: Option<String>,
    pub message: String,
}

// ============================================================================
// Config
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConfigDto {
    pub deployment_mode: String,
    pub bind_address: String,
    pub management_port: u16,
    pub public_urls: Vec<String>,
    pub local_ai: AiConfig,
    pub cloud_ai: AiConfig,
    pub storage_paths: StoragePaths,
    pub feature_flags: Vec<FeatureFlag>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiConfig {
    pub enabled: bool,
    /// Provider name only (e.g. "ollama", "builtin"). Never a secret.
    pub provider_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StoragePaths {
    pub language_data: Option<String>,
    pub ocr_data: Option<String>,
    pub model_cache: Option<String>,
    pub app_data: Option<String>,
    pub db: Option<String>,
    pub uploads: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FeatureFlag {
    pub name: String,
    pub enabled: bool,
}

// ============================================================================
// Storage
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageDto {
    pub volumes: Vec<VolumeInfo>,
    pub bind_mounts: Vec<BindMountInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VolumeInfo {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub size_bytes: Option<u64>,
    pub in_use_by: Vec<String>,
    pub labels: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BindMountInfo {
    pub service: String,
    pub source: String,
    pub destination: String,
    /// "rw" | "ro"
    pub mode: String,
}

// ============================================================================
// AI Status
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiStatusDto {
    pub local_ai: LocalAiStatus,
    pub cloud_ai: CloudAiStatus,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalAiStatus {
    pub enabled: bool,
    pub provider_name: Option<String>,
    pub service_status: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudAiStatus {
    pub enabled: bool,
    /// Provider names only. Never secrets.
    pub provider_names: Vec<String>,
    pub school_mode_warning: Option<String>,
}

// ============================================================================
// School Deployment
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SchoolDto {
    pub deployment_mode: String,
    pub public_cloud_llm_access: bool,
    pub admin_auth_enabled: bool,
    pub console_bound_locally: bool,
    pub warnings: Vec<String>,
    pub notes: Vec<String>,
}

// ============================================================================
// Health (unauthenticated)
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HealthDto {
    pub status: String,
}

// ============================================================================
// Error
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ErrorDto {
    pub error: String,
}
