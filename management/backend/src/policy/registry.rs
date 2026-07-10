use serde_json::Value;

use super::model::PolicyDocument;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JsonKind {
    Boolean,
    Number,
    String,
    StringOrNull,
    StringLiterals(&'static [&'static str]),
}

const SETTING_REGISTRY: &[(&str, JsonKind)] = &[
    ("srsLearningThreshold", JsonKind::Number),
    ("known_ease_threshold", JsonKind::Number),
    ("ankiLearningThreshold", JsonKind::Number),
    ("ankiKnownThreshold", JsonKind::Number),
    ("blur_words", JsonKind::Boolean),
    ("blur_known_subtitles", JsonKind::Boolean),
    ("blur_amount", JsonKind::Number),
    ("colour_known", JsonKind::String),
    ("do_colour_known", JsonKind::Boolean),
    ("do_colour_codes", JsonKind::Boolean),
    (
        "theme",
        JsonKind::StringLiterals(&[
            "light",
            "dark",
            "glass-light",
            "glass-dark",
            "light-high-contrast",
            "dark-high-contrast",
            "darker",
            "custom",
        ]),
    ),
    ("language", JsonKind::String),
    ("hover_known_get_from_dictionary", JsonKind::Boolean),
    ("show_pos", JsonKind::Boolean),
    ("showReadingAnnotations", JsonKind::Boolean),
    ("hideReadingForKnownWords", JsonKind::Boolean),
    ("showProsody", JsonKind::Boolean),
    ("showDictionary", JsonKind::Boolean),
    ("use_anki", JsonKind::Boolean),
    ("flashcardSkipAnkiChoice", JsonKind::Boolean),
    ("skipAnkiDuplicateWarning", JsonKind::Boolean),
    ("skipStatusSourceWarning", JsonKind::Boolean),
    ("skipAnkiModifyWarning", JsonKind::Boolean),
    ("easeThresholdUnknown", JsonKind::Number),
    ("easeThresholdLearning", JsonKind::Number),
    ("easeThresholdKnown", JsonKind::Number),
    ("easeThresholdMastered", JsonKind::Number),
    ("manualStatusEaseBuffer", JsonKind::Number),
    ("ankiDeckName", JsonKind::String),
    ("enable_flashcard_creation", JsonKind::Boolean),
    ("automaticFlashcardCreation", JsonKind::Boolean),
    ("flashcard_deck", JsonKind::StringOrNull),
    ("flashcards_add_picture", JsonKind::Boolean),
    ("maxNewCardsPerDay", JsonKind::Number),
    ("proportionOfLevelCards", JsonKind::Number),
    ("wordSyncStaleLearningDays", JsonKind::Number),
    ("createUnseenCards", JsonKind::Boolean),
    ("flashcardLLMExamples", JsonKind::Boolean),
    ("newDayHour", JsonKind::Number),
    ("flashcardFlipAnimation", JsonKind::Boolean),
    ("leechThreshold", JsonKind::Number),
    (
        "flashcardMediaType",
        JsonKind::StringLiterals(&["image", "video"]),
    ),
    ("flashcardVideoMargin", JsonKind::Number),
    ("autoSuggestFlashcards", JsonKind::Boolean),
    ("autoSuggestUnknownWords", JsonKind::Boolean),
    ("openAside", JsonKind::Boolean),
    ("rightSidebarOpen", JsonKind::Boolean),
    ("subsOffsetTime", JsonKind::Number),
    ("immediateFetch", JsonKind::Boolean),
    (
        "subtitleTheme",
        JsonKind::StringLiterals(&["marker", "background", "shadow"]),
    ),
    ("subtitle_font_size", JsonKind::Number),
    ("subtitle_font_weight", JsonKind::Number),
    ("showSubtitles", JsonKind::Boolean),
    ("showTranslation", JsonKind::Boolean),
    ("overlayAutoPosition", JsonKind::Boolean),
    ("overlayTextMode", JsonKind::Boolean),
    ("removeParentheses", JsonKind::Boolean),
    ("removeSpeakerNames", JsonKind::Boolean),
    ("showLiveTranslator", JsonKind::Boolean),
    ("liveTranslatorIncludeKnown", JsonKind::Boolean),
    ("blurKnownWords", JsonKind::Boolean),
    ("llmEnabled", JsonKind::Boolean),
    ("ocrEnabled", JsonKind::Boolean),
    ("voiceEnabled", JsonKind::Boolean),
    ("lowBatteryMode", JsonKind::Boolean),
    ("ocr_crop_padding", JsonKind::Number),
    ("ocrRamSaver", JsonKind::Boolean),
    ("ocrTurboMode", JsonKind::Boolean),
    ("ocrReadingAnnotationFiltering", JsonKind::Boolean),
    ("ocrReadingAnnotationWidthRatio", JsonKind::Number),
    (
        "ocrReadingAnnotationNeighborWindowMultiplier",
        JsonKind::Number,
    ),
    ("ocrReadingAnnotationNeighborLookahead", JsonKind::Number),
    ("ocrProvider", JsonKind::StringLiterals(&["local", "cloud"])),
    ("readerCropMode", JsonKind::Boolean),
    ("readerDocumentOcr", JsonKind::Boolean),
    (
        "readerWordHoverTrigger",
        JsonKind::StringLiterals(&["hover", "long-hover", "key-hover"]),
    ),
    ("readerWordHoverKey", JsonKind::String),
    ("readerReadingAnnotationHider", JsonKind::Boolean),
    ("readerCollatePages", JsonKind::Boolean),
    (
        "readerPageMode",
        JsonKind::StringLiterals(&["single", "double"]),
    ),
    ("readerFirstPageSingle", JsonKind::Boolean),
    (
        "readerSpreadDirection",
        JsonKind::StringLiterals(&["left-to-right", "right-to-left"]),
    ),
    (
        "readerTextFontStyle",
        JsonKind::StringLiterals(&["language", "sans", "serif", "mono"]),
    ),
    ("readerTextSize", JsonKind::Number),
    ("readerTextLineHeight", JsonKind::Number),
    ("readerTextWidth", JsonKind::Number),
    ("readerTextMargin", JsonKind::Number),
    ("readerMagnifierHotkey", JsonKind::String),
    ("readerMagnifierZoom", JsonKind::Number),
    ("readerMagnifierSize", JsonKind::Number),
    ("passiveEaseEnabled", JsonKind::Boolean),
];

pub fn validate_setting_rule(key: &str, value: &Value) -> Result<(), String> {
    let kind = SETTING_REGISTRY
        .iter()
        .find_map(|(registered_key, kind)| (*registered_key == key).then_some(*kind))
        .ok_or_else(|| format!("setting `{key}` is not policy-addressable"))?;

    let valid = match kind {
        JsonKind::Boolean => value.is_boolean(),
        JsonKind::Number => is_i_json_policy_number(value),
        JsonKind::String => value.is_string(),
        JsonKind::StringOrNull => value.is_string() || value.is_null(),
        JsonKind::StringLiterals(allowed_values) => value
            .as_str()
            .is_some_and(|value| allowed_values.contains(&value)),
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
        assert!(validate_setting_rule("theme", &json!("dark")).is_ok());
        assert!(validate_setting_rule("theme", &json!("neon")).is_err());
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
        assert_eq!(serialized["settings"]["theme"]["value"], json!("dark"));
        assert!(serialized["settings"]["flashcard_deck"]["value"].is_null());
    }
}
