use std::str::FromStr;

use crate::auth::hash_token;

#[derive(Debug, Clone, PartialEq)]
pub enum EnvMode {
    Production,
    Development,
}

impl EnvMode {
    fn parse(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "development" | "dev" => Self::Development,
            _ => Self::Production,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeploymentMode {
    LocalOnly,
    SelfHosted,
    CloudConnected,
}

impl FromStr for DeploymentMode {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "local-only" | "local" => Ok(Self::LocalOnly),
            "cloud-connected" | "cloud" => Ok(Self::CloudConnected),
            "self-hosted" | "selfhosted" => Ok(Self::SelfHosted),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: String,
    pub port: u16,
    pub compose_project: String,
    pub management_db_path: String,
    pub token_hash: Option<[u8; 32]>,
    pub env_mode: EnvMode,
    pub deployment_mode: DeploymentMode,
    pub app_version: Option<String>,
    pub local_ai_enabled: bool,
    pub local_ai_provider: Option<String>,
    pub cloud_ai_enabled: bool,
    pub cloud_ai_providers: Vec<String>,
    pub language_data_path: Option<String>,
    pub ocr_data_path: Option<String>,
    pub model_cache_path: Option<String>,
    pub app_data_path: Option<String>,
    pub db_path: Option<String>,
    pub uploads_path: Option<String>,
    pub feature_flags: Vec<(String, bool)>,
}

impl Config {
    pub fn from_env() -> Self {
        let bind_address =
            env_or_default("MLEARN_BIND_ADDRESS", "127.0.0.1");
        let port = env_u16_or_default("MLEARN_MANAGEMENT_PORT", 3000);
        let compose_project = env_or_default("MLEARN_COMPOSE_PROJECT", "mlearn");
        let management_db_path = env_or_default(
            "MLEARN_MANAGEMENT_DB",
            if cfg!(debug_assertions) {
                "management.db"
            } else {
                "/data/management.db"
            },
        );

        let env_mode = EnvMode::parse(&env_or_default("MLEARN_ENV", "production"));
        let deployment_mode = env_or_default("MLEARN_DEPLOYMENT_MODE", "self-hosted");
        let deployment_mode = DeploymentMode::from_str(&deployment_mode)
            .unwrap_or(DeploymentMode::SelfHosted);

        let app_version = env_nonempty("MLEARN_APP_VERSION");

        let local_ai_enabled = env_bool_or_default("MLEARN_LOCAL_AI_ENABLED", true);
        let local_ai_provider = env_nonempty("MLEARN_LOCAL_AI_PROVIDER");
        let cloud_ai_enabled = env_bool_or_default("MLEARN_CLOUD_AI_ENABLED", false);
        let cloud_ai_providers = env_list("MLEARN_CLOUD_AI_PROVIDERS");

        let language_data_path = env_nonempty("MLEARN_LANGUAGE_DATA_PATH");
        let ocr_data_path = env_nonempty("MLEARN_OCR_DATA_PATH");
        let model_cache_path = env_nonempty("MLEARN_MODEL_CACHE_PATH");
        let app_data_path = env_nonempty("MLEARN_APP_DATA_PATH");
        let db_path = env_nonempty("MLEARN_DB_PATH");
        let uploads_path = env_nonempty("MLEARN_UPLOADS_PATH");

        let feature_flags = parse_feature_flags(&std::env::var("MLEARN_FEATURE_FLAGS").unwrap_or_default());

        let token_hash = load_token_hash();

        Self {
            bind_address,
            port,
            compose_project,
            management_db_path,
            token_hash,
            env_mode,
            deployment_mode,
            app_version,
            local_ai_enabled,
            local_ai_provider,
            cloud_ai_enabled,
            cloud_ai_providers,
            language_data_path,
            ocr_data_path,
            model_cache_path,
            app_data_path,
            db_path,
            uploads_path,
            feature_flags,
        }
    }

    pub fn auth_enabled(&self) -> bool {
        self.token_hash.is_some() || self.env_mode == EnvMode::Production
    }

    pub fn fail_closed(&self) -> bool {
        self.env_mode == EnvMode::Production && self.token_hash.is_none()
    }
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_nonempty(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    }
}

fn env_u16_or_default(key: &str, default: u16) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&v| v > 0)
        .unwrap_or(default)
}

fn env_bool_or_default(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(value) => parse_bool(&value, default),
        Err(_) => default,
    }
}

fn parse_bool(value: &str, default: bool) -> bool {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => true,
        "false" | "0" | "no" | "off" => false,
        _ => default,
    }
}

fn env_list(key: &str) -> Vec<String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_feature_flags(raw: &str) -> Vec<(String, bool)> {
    raw.split(',')
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let (name, value) = entry.split_once('=')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            let enabled = parse_bool(value.trim(), true);
            Some((name.to_string(), enabled))
        })
        .collect()
}

fn load_token_hash() -> Option<[u8; 32]> {
    if let Ok(hex_value) = std::env::var("MLEARN_MANAGEMENT_TOKEN_HASH") {
        if !hex_value.trim().is_empty() {
            return decode_hex_32(&hex_value);
        }
    }

    if let Ok(token) = std::env::var("MLEARN_MANAGEMENT_TOKEN") {
        if !token.trim().is_empty() {
            return Some(hash_token(&token));
        }
    }

    None
}

fn decode_hex_32(hex_value: &str) -> Option<[u8; 32]> {
    match hex::decode(hex_value.trim()) {
        Ok(bytes) => match bytes.try_into() {
            Ok(array) => Some(array),
            Err(_) => {
                tracing::warn!(
                    "MLEARN_MANAGEMENT_TOKEN_HASH is not exactly 32 bytes; ignoring"
                );
                None
            }
        },
        Err(err) => {
            tracing::warn!(
                error = %err,
                "MLEARN_MANAGEMENT_TOKEN_HASH is not valid hex; ignoring"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_mode_recognizes_known_values() {
        assert_eq!(EnvMode::parse("production"), EnvMode::Production);
        assert_eq!(EnvMode::parse("PRODUCTION"), EnvMode::Production);
        assert_eq!(EnvMode::parse("development"), EnvMode::Development);
        assert_eq!(EnvMode::parse("dev"), EnvMode::Development);
        assert_eq!(EnvMode::parse("garbage"), EnvMode::Production);
        assert_eq!(EnvMode::parse(""), EnvMode::Production);
    }

    #[test]
    fn parse_deployment_mode_recognizes_known_values() {
        assert_eq!(
            DeploymentMode::from_str("local-only").unwrap(),
            DeploymentMode::LocalOnly
        );
        assert_eq!(
            DeploymentMode::from_str("Local-Only").unwrap(),
            DeploymentMode::LocalOnly
        );
        assert_eq!(
            DeploymentMode::from_str("local").unwrap(),
            DeploymentMode::LocalOnly
        );
        assert_eq!(
            DeploymentMode::from_str("self-hosted").unwrap(),
            DeploymentMode::SelfHosted
        );
        assert_eq!(
            DeploymentMode::from_str("cloud-connected").unwrap(),
            DeploymentMode::CloudConnected
        );
        assert_eq!(
            DeploymentMode::from_str("cloud").unwrap(),
            DeploymentMode::CloudConnected
        );
        assert!(DeploymentMode::from_str("unknown").is_err());
    }

    #[test]
    fn parse_bool_recognizes_common_truthy_and_falsy() {
        assert!(parse_bool("true", false));
        assert!(parse_bool("1", false));
        assert!(parse_bool("YES", false));
        assert!(parse_bool("on", false));
        assert!(!parse_bool("false", true));
        assert!(!parse_bool("0", true));
        assert!(!parse_bool("no", true));
        assert!(!parse_bool("off", true));
        assert!(parse_bool("maybe", true));
        assert!(!parse_bool("maybe", false));
    }

    #[test]
    fn parse_feature_flags_handles_pairs_and_defaults() {
        assert_eq!(
            parse_feature_flags("a=true,b=false,c=1,d=0"),
            vec![
                ("a".to_string(), true),
                ("b".to_string(), false),
                ("c".to_string(), true),
                ("d".to_string(), false),
            ]
        );
    }

    #[test]
    fn parse_feature_flags_skips_invalid_entries() {
        assert_eq!(
            parse_feature_flags("ok=true, ,noeq,y=maybe"),
            vec![("ok".to_string(), true), ("y".to_string(), true)]
        );
    }

    #[test]
    fn parse_feature_flags_handles_empty() {
        assert!(parse_feature_flags("").is_empty());
        assert!(parse_feature_flags("   ").is_empty());
    }

    #[test]
    fn env_list_splits_comma_separated() {
        std::env::set_var(
            "MLEARN_TEST_CONFIG_LIST",
            "ollama ,  builtin ,, openai",
        );
        let list = env_list("MLEARN_TEST_CONFIG_LIST");
        assert_eq!(list, vec!["ollama", "builtin", "openai"]);
        std::env::remove_var("MLEARN_TEST_CONFIG_LIST");
    }

    #[test]
    fn decode_hex_32_accepts_valid_hash() {
        let hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        let decoded = decode_hex_32(hash);
        assert!(decoded.is_some());
        assert_eq!(decoded.unwrap().len(), 32);
    }

    #[test]
    fn decode_hex_32_rejects_invalid_input() {
        assert!(decode_hex_32("not hex").is_none());
        assert!(decode_hex_32("abcd").is_none());
        assert!(decode_hex_32("").is_none());
    }

    #[test]
    fn config_from_env_uses_defaults_when_unset() {
        std::env::remove_var("MLEARN_BIND_ADDRESS");
        std::env::remove_var("MLEARN_MANAGEMENT_PORT");
        std::env::remove_var("MLEARN_COMPOSE_PROJECT");
        std::env::remove_var("MLEARN_MANAGEMENT_TOKEN_HASH");
        std::env::remove_var("MLEARN_MANAGEMENT_TOKEN");
        std::env::remove_var("MLEARN_DEPLOYMENT_MODE");
        std::env::remove_var("MLEARN_FEATURE_FLAGS");

        let config = Config::from_env();

        assert_eq!(config.bind_address, "127.0.0.1");
        assert_eq!(config.port, 3000);
        assert_eq!(config.compose_project, "mlearn");
        assert!(config.feature_flags.is_empty());
    }

    #[test]
    fn auth_enabled_and_fail_closed_logic() {
        let mut config = Config {
            bind_address: "127.0.0.1".to_string(),
            port: 3000,
            compose_project: "mlearn".to_string(),
            management_db_path: "management.db".to_string(),
            token_hash: Some([0u8; 32]),
            env_mode: EnvMode::Production,
            deployment_mode: DeploymentMode::SelfHosted,
            app_version: None,
            local_ai_enabled: true,
            local_ai_provider: None,
            cloud_ai_enabled: false,
            cloud_ai_providers: vec![],
            language_data_path: None,
            ocr_data_path: None,
            model_cache_path: None,
            app_data_path: None,
            db_path: None,
            uploads_path: None,
            feature_flags: vec![],
        };

        assert!(config.auth_enabled());
        assert!(!config.fail_closed());

        config.token_hash = None;
        assert!(config.auth_enabled());
        assert!(config.fail_closed());

        config.env_mode = EnvMode::Development;
        assert!(!config.auth_enabled());
        assert!(!config.fail_closed());
    }
}
