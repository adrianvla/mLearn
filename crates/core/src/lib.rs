mod watch;
pub use watch::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PROTOCOL_VERSION: u32 = 1;

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
        if self.name.trim().is_empty() || self.name.len() > 256 || self.name.chars().any(char::is_control) {
            return Err("Theme name must contain 1–256 bytes without control characters".into());
        }
        let colors = [&self.colors.background, &self.colors.surface, &self.colors.text,
            &self.colors.muted, &self.colors.accent, &self.colors.on_accent, &self.colors.border];
        if colors.iter().any(|c| !(c.len() == 7 || c.len() == 9) || !c.starts_with('#') || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)) {
            return Err("Theme colors must be #RRGGBB or #RRGGBBAA".into());
        }
        if self.radius > 48 || !self.text_scale.is_finite() || !(0.8..=2.0).contains(&self.text_scale) {
            return Err("Theme radius or text scale is outside the supported range".into());
        }
        if !self.spacing_scale.is_finite() || !(0.75..=1.5).contains(&self.spacing_scale) {
            return Err("Theme spacing scale must be between 0.75 and 1.5".into());
        }
        if serde_json::to_vec(&self.extensions).map_err(|e| e.to_string())?.len() > 16_384 {
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
pub enum PackageInstallPhase { Downloading, Validating, Succeeded, Failed, Cancelled }

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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Request {
    Snapshot,
    RecentSources,
    AvailablePackages,
    OpenSource { path: String, #[serde(rename="packageId")] package_id:String },
    ResumeSource { #[serde(rename="sourceId")] source_id:String },
    AttachSubtitles { #[serde(rename="sourceId")] source_id:String,path:String },
    SourceWindow { #[serde(rename="sourceId")] source_id:String,#[serde(rename="positionMs")] position_ms:u32 },
    Transcript { #[serde(rename="sourceId")] source_id:String,#[serde(rename="afterIndex")] after_index:Option<u32>,query:String },
    CuePosition { #[serde(rename="sourceId")] source_id:String,#[serde(rename="subtitleRevision")] subtitle_revision:String,#[serde(rename="cueIndex")] cue_index:u32 },
    SetSubtitleOffset { #[serde(rename="sourceId")] source_id:String,#[serde(rename="offsetMs")] offset_ms:i32 },
    SetPlaybackRate { #[serde(rename="sourceId")] source_id:String,rate:f64 },
    SetInspectionTrigger { #[serde(rename="sourceId")] source_id:String,trigger:InspectionTrigger },
    SetSourceLanguage { #[serde(rename="sourceId")] source_id:String,#[serde(rename="packageId")] package_id:String },
    SavePosition { #[serde(rename="sourceId")] source_id:String,#[serde(rename="positionMs")] position_ms:u32,#[serde(rename="durationMs")] duration_ms:u32 },
    AnalyzeSource { #[serde(rename="sourceId")] source_id:String,#[serde(rename="positionMs")] position_ms:u32 },
    AnalyzeTranscript { #[serde(rename="sourceId")] source_id:String,#[serde(rename="afterIndex")] after_index:Option<u32>,query:String },
    DescribeLanguage { #[serde(rename="packageId")] package_id:String },
    InspectTarget { #[serde(rename="packageId")] package_id:String,#[serde(rename="targetId")] target_id:String },
    Knowledge { keys:Vec<KnowledgeKey> },
    ChangeClaim { change:ClaimChange },
    SaveTheme {
        document: ThemeDocument,
        #[serde(rename = "expectedRevision")]
        expected_revision: u32,
        #[serde(rename = "commandId")]
        command_id: String,
    },
    InstallPlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    InstallPackage { command: PackageInstallCommand },
    PackageInstallStatus { #[serde(rename = "commandId")] command_id: String },
    CurrentPackageInstall,
    CancelPackageInstall { #[serde(rename = "commandId")] command_id: String },
    InvokePlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        capability: String,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        input: serde_json::Value,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Response {
    Snapshot { snapshot: Snapshot },
    Sources { sources:Vec<SourceRecord> },
    Packages { plugins:Vec<PluginSummary> },
    Source { window:SourceWindow },
    Transcript { page:TranscriptPage },
    CuePosition { position:CuePosition },
    PositionSaved,
    Analysis { batch:AnalysisBatch },
    Language { description:LanguageDescription },
    Entry { entry:LexicalEntry },
    Knowledge { projections:Vec<KnowledgeProjection> },
    ClaimChanged { projection:KnowledgeProjection },
    Saved { revision: u32 },
    Installed { plugin: PluginSummary },
    PackageInstallStatus { status: Option<PackageInstallStatus> },
    PluginResult {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        output: serde_json::Value,
    },
    Error { code: String, message: String },
}
