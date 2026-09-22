use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::PolicyDocument;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySettingDescriptor {
    pub key: String,
    pub value_type: String,
    pub allowed_values: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingContract {
    kind: String,
    #[serde(default)]
    allowed_values: Vec<String>,
}

fn setting_contract() -> &'static std::collections::BTreeMap<String, SettingContract> {
    static CONTRACT: std::sync::OnceLock<std::collections::BTreeMap<String, SettingContract>> =
        std::sync::OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../src/shared/policySettings.json"))
            .expect("canonical policy settings contract must be valid")
    })
}

pub fn policy_setting_registry() -> Vec<PolicySettingDescriptor> {
    setting_contract()
        .iter()
        .map(|(key, descriptor)| PolicySettingDescriptor {
            key: key.clone(),
            value_type: if descriptor.allowed_values.is_empty() {
                descriptor.kind.clone()
            } else {
                "select".into()
            },
            allowed_values: descriptor.allowed_values.clone(),
        })
        .collect()
}

pub fn validate_setting_rule(key: &str, value: &Value) -> Result<(), String> {
    let descriptor = setting_contract().get(key).ok_or_else(|| {
        format!(
            "setting `{key}` is not policy-addressable; upgrade to a compatible policy contract"
        )
    })?;
    let valid = match descriptor.kind.as_str() {
        "boolean" => value.is_boolean(),
        "number" => is_i_json_policy_number(value),
        "string" => value.as_str().is_some_and(|v| {
            descriptor.allowed_values.is_empty()
                || descriptor.allowed_values.iter().any(|allowed| allowed == v)
        }),
        "stringOrNull" => value.is_string() || value.is_null(),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!("setting `{key}` has the wrong JSON value type"))
    }
}

fn is_i_json_policy_number(value: &Value) -> bool {
    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

    let Some(number) = value.as_number() else {
        return false;
    };
    if let Some(integer) = number.as_i64() {
        return (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&integer);
    }
    if let Some(integer) = number.as_u64() {
        return integer <= MAX_SAFE_INTEGER as u64;
    }
    number.as_f64().is_some_and(|number| {
        number.is_finite() && (!number.fract().eq(&0.0) || number.abs() <= MAX_SAFE_INTEGER as f64)
    })
}

pub fn validate_policy_document(document: &PolicyDocument) -> Result<(), String> {
    if document.schema_version != 1 {
        return Err("unsupported management policy schema version".to_string());
    }
    if !(1..=90).contains(&document.governance.activity_retention_days)
        || !(1..=90).contains(&document.governance.conversation_retention_days)
    {
        return Err("governance retention must be between 1 and 90 days".into());
    }
    require_non_empty("policyVersionId", &document.policy_version_id)?;
    require_non_empty("activeGroupId", &document.active_group_id)?;
    require_non_empty("issuedAt", &document.issued_at)?;
    require_non_empty("expiresAt", &document.expires_at)?;
    require_non_empty("keyId", &document.key_id)?;
    require_non_empty("signature", &document.signature)?;

    for ancestor in &document.ancestry {
        require_non_empty("ancestry.id", &ancestor.id)?;
        require_non_empty("ancestry.name", &ancestor.name)?;
    }
    for (key, rule) in &document.settings {
        validate_setting_rule(key, &rule.value)?;
        if !rule.locked {
            return Err(format!("managed setting `{key}` must be locked"));
        }
        require_non_empty("settings.sourceGroupId", &rule.source_group_id)?;
        require_non_empty("settings.sourceGroupName", &rule.source_group_name)?;
    }
    for (feature_id, rule) in &document.features {
        require_safe_identifier("feature", feature_id)?;
        require_non_empty("features.sourceGroupId", &rule.source_group_id)?;
    }
    for provider in &document.llm.allowed_providers {
        require_safe_identifier("LLM provider", provider)?;
    }
    for model in &document.llm.allowed_models {
        require_non_empty("llm.allowedModels", model)?;
    }
    if let Some(prompt_profile_id) = &document.llm.prompt_profile_id {
        require_safe_identifier("prompt profile", prompt_profile_id)?;
    }
    for quota in &document.llm.quotas {
        if quota.limit > 9_007_199_254_740_991 {
            return Err("llm quota limit exceeds JavaScript's safe integer maximum".to_string());
        }
        require_non_empty("llm.quotas.sourceGroupId", &quota.source_group_id)?;
    }
    if document.llm.requests_per_minute == 0 || document.llm.requests_per_minute > 10_000 {
        return Err("llm.requestsPerMinute is invalid".into());
    }
    if document.llm.max_concurrent_streams == 0 || document.llm.max_concurrent_streams > 1_000 {
        return Err("llm.maxConcurrentStreams is invalid".into());
    }
    Ok(())
}

fn require_non_empty(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("`{field}` must not be empty"))
    } else {
        Ok(())
    }
}

fn require_safe_identifier(kind: &str, value: &str) -> Result<(), String> {
    require_non_empty(kind, value)?;
    if value == "__proto__" || value == "constructor" || value == "prototype" {
        Err(format!("unsafe {kind} identifier"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_policy_document, validate_setting_rule};
    use crate::policy::model::PolicyDocument;
    use serde_json::json;

    fn fixture_document() -> PolicyDocument {
        serde_json::from_str(include_str!(
            "../../../../test/fixtures/management-policy-v1.json"
        ))
        .expect("fixture should deserialize")
    }

    #[test]
    fn every_canonical_definition_is_consumed_by_rust() {
        let canonical: serde_json::Value =
            serde_json::from_str(include_str!("../../../../src/shared/policySettings.json"))
                .unwrap();
        let registry = super::policy_setting_registry();
        assert_eq!(registry.len(), canonical.as_object().unwrap().len());
        for descriptor in registry {
            let entry = &canonical[&descriptor.key];
            let values = match entry["kind"].as_str().unwrap() {
                "boolean" => vec![json!(true), json!(false)],
                "number" => vec![json!(0), json!(0.5)],
                "stringOrNull" => vec![json!(null), json!("deck")],
                "string" => entry
                    .get("allowedValues")
                    .map(|v| v.as_array().unwrap().clone())
                    .unwrap_or(vec![json!("text")]),
                kind => panic!("unsupported canonical kind {kind}"),
            };
            for value in values {
                assert!(
                    validate_setting_rule(&descriptor.key, &value).is_ok(),
                    "{}",
                    descriptor.key
                );
            }
            assert!(validate_setting_rule(&descriptor.key, &json!({})).is_err());
        }
    }

    #[test]
    fn obsolete_and_future_locked_keys_fail_closed() {
        for key in [
            "colour_known",
            "do_colour_known",
            "wordSyncStaleLearningDays",
            "futureLockedSetting",
        ] {
            assert!(validate_setting_rule(key, &json!(true)).is_err());
        }
    }

    #[test]
    fn registry_accepts_current_desktop_settings() {
        for key in [
            "enableWordColoring",
            "colorKnownWords",
            "readingAnnotationMoreContrast",
            "simplifyHomeScreen",
            "readerSepiaEnabled",
        ] {
            assert!(validate_setting_rule(key, &json!(true)).is_ok(), "{key}");
        }
        assert!(validate_setting_rule("frequencyStarCollapse", &json!("auto")).is_ok());
    }

    #[test]
    fn registry_rejects_unknown_setting_and_wrong_value_type() {
        assert!(validate_setting_rule("notASetting", &json!(true)).is_err());
        assert!(validate_setting_rule("llmEnabled", &json!("yes")).is_err());
        assert!(validate_setting_rule("llmEnabled", &json!(false)).is_ok());
    }

    #[test]
    fn registry_rejects_deprecated_scalar_language_level() {
        assert!(validate_setting_rule("learningLanguageLevel", &json!(3)).is_err());
    }

    #[test]
    fn registry_rejects_secrets_and_executable_content() {
        assert!(validate_setting_rule("cloudAuthAccessToken", &json!("secret")).is_err());
        assert!(validate_setting_rule("cloudAuthRefreshToken", &json!("secret")).is_err());
        assert!(
            validate_setting_rule("customThemeCSS", &json!("body { display: none; }")).is_err()
        );
    }

    #[test]
    fn registry_accepts_only_registered_literal_setting_values() {
        assert!(validate_setting_rule("uiType", &json!("glass")).is_ok());
        assert!(validate_setting_rule("uiType", &json!("damascus")).is_err());
        assert!(validate_setting_rule("colorScheme", &json!("dark-quartz")).is_ok());
        assert!(validate_setting_rule("colorScheme", &json!("neon")).is_err());
        assert!(validate_setting_rule("readerTextFontStyle", &json!("serif")).is_ok());
        assert!(validate_setting_rule("readerTextFontStyle", &json!("comic")).is_err());
    }

    #[test]
    fn registry_rejects_integer_settings_outside_javascript_safe_range() {
        for raw in [
            "9007199254740992",
            "9007199254740993",
            "-9007199254740992",
            "-9007199254740993",
        ] {
            let value: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert!(
                validate_setting_rule("subtitle_font_size", &value).is_err(),
                "{raw} must be rejected"
            );
        }
        for raw in ["9007199254740991", "-9007199254740991", "20.5", "1e-7"] {
            let value: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert!(
                validate_setting_rule("subtitle_font_size", &value).is_ok(),
                "{raw} must remain supported"
            );
        }
    }

    #[test]
    fn policy_rejects_quota_limits_above_javascript_safe_integer() {
        let mut document = fixture_document();
        document.llm.quotas[0].limit = 9_007_199_254_740_991;
        assert!(validate_policy_document(&document).is_ok());

        document.llm.quotas[0].limit = 9_007_199_254_740_992;
        assert!(validate_policy_document(&document).is_err());
    }

    #[test]
    fn shared_fixture_round_trips_and_validates() {
        let fixture = include_str!("../../../../test/fixtures/management-policy-v1.json");
        let document = fixture_document();

        validate_policy_document(&document).expect("fixture should be valid");
        let serialized = serde_json::to_value(&document).expect("document should serialize");
        let expected: serde_json::Value =
            serde_json::from_str(fixture).expect("fixture should be JSON");
        assert_eq!(serialized, expected);
        assert_eq!(serialized["schemaVersion"], json!(1));
        assert!(serialized["settings"].get("llmEnabled").is_some());
        assert_eq!(
            serialized["settings"]["colorScheme"]["value"],
            json!("dark-quartz")
        );
        assert!(serialized["settings"]["flashcard_deck"]["value"].is_null());
    }
}
