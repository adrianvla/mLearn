mod collection;
mod conversation;
mod document;
mod material;
mod material_media;
mod ocr;
mod request;
mod response;
mod review;
mod review_policy;
mod source;
mod watch;
pub use collection::*;
pub use conversation::*;
pub use document::*;
pub use material::*;
pub use material_media::*;
pub use ocr::*;
pub use request::Request;
pub use response::Response;
pub use review::*;
pub use review_policy::{review_compatible, review_schedule, REVIEW_POLICY_VERSION};
use serde::{Deserialize, Serialize};
pub use source::{SourceAnchor, SourceLocator};
use std::collections::BTreeMap;
pub use watch::*;

pub const PROTOCOL_VERSION: u32 = 1;

/// Cosmetic annotation selection, independent of learner evidence and review.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum StarCollapse {
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ViewPreferences {
    pub revision: u32,
    pub inline_level_scale: Option<String>,
    #[serde(default)]
    pub star_collapse: StarCollapse,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ThemeColors {
    pub background: String,
    pub surface: String,
    pub text: String,
    pub muted: String,
    pub accent: String,
    pub on_accent: String,
    pub border: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ThemeDocument {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub colors: ThemeColors,
    pub radius: u32,
    pub text_scale: f32,
    #[serde(default = "default_spacing_scale")]
    pub spacing_scale: f32,
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, unknown>"))]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

impl ThemeDocument {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Unsupported theme schema version".into());
        }
        if self.id.is_empty() || self.id.len() > 128 || self.id.chars().any(char::is_control) {
            return Err("Theme id must contain 1–128 bytes without control characters".into());
        }
        if self.name.trim().is_empty()
            || self.name.len() > 256
            || self.name.chars().any(char::is_control)
        {
            return Err("Theme name must contain 1–256 bytes without control characters".into());
        }
        let colors = [
            &self.colors.background,
            &self.colors.surface,
            &self.colors.text,
            &self.colors.muted,
            &self.colors.accent,
            &self.colors.on_accent,
            &self.colors.border,
        ];
        if colors.iter().any(|c| {
            !(c.len() == 7 || c.len() == 9)
                || !c.starts_with('#')
                || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        }) {
            return Err("Theme colors must be #RRGGBB or #RRGGBBAA".into());
        }
        if self.radius > 48
            || !self.text_scale.is_finite()
            || !(0.8..=2.0).contains(&self.text_scale)
        {
            return Err("Theme radius or text scale is outside the supported range".into());
        }
        if !self.spacing_scale.is_finite() || !(0.75..=1.5).contains(&self.spacing_scale) {
            return Err("Theme spacing scale must be between 0.75 and 1.5".into());
        }
        if serde_json::to_vec(&self.extensions)
            .map_err(|e| e.to_string())?
            .len()
            > 16_384
        {
            return Err("Theme extensions exceed 16 KiB".into());
        }
        Ok(())
    }
}

fn default_spacing_scale() -> f32 {
    1.0
}

impl Default for ThemeDocument {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../../resources/themes/quartz.json"))
            .expect("the checked-in built-in theme must be valid")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PluginSummary {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub version: String,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Snapshot {
    pub protocol_version: u32,
    pub revision: u32,
    pub theme: ThemeDocument,
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub view_preferences: Option<ViewPreferences>,
    pub code_policy: String,
    pub catalog_configured: bool,
    pub available_plugins: Vec<PluginSummary>,
    pub installed_plugins: Vec<PluginSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub package_issues: Vec<PackageIssue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackageIssue {
    pub package_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackageInstallCommand {
    pub plugin_id: String,
    pub command_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum PackageInstallPhase {
    Downloading,
    Validating,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackageInstallStatus {
    pub command: PackageInstallCommand,
    pub phase: PackageInstallPhase,
    pub downloaded_bytes: u32,
    pub total_bytes: Option<u32>,
    pub message: Option<String>,
}
