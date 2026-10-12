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
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, unknown>"))]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

impl ThemeDocument {
    pub fn validate(&self) -> Result<(), String> {
        Ok(())
    }
}

impl Default for ThemeDocument {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../../resources/themes/quartz.json"))
            .expect("the checked-in built-in theme must be valid")
    }
}
