use mlearn_core::ThemeDocument;
use serde_json::json;

#[test]
fn accepts_custom_ids_and_round_trips_unknown_extension_data() {
    let mut theme = ThemeDocument::default();
    theme.id = "school.my-theme".into();
    theme.extensions.insert("school::unknown".into(), json!({"nested": [1, {"value": "kept"}]}));
    assert!(theme.validate().is_ok());
    assert_eq!(serde_json::from_slice::<ThemeDocument>(&serde_json::to_vec(&theme).unwrap()).unwrap(), theme);
}

#[test]
fn rejects_executable_or_invalid_color_values() {
    let mut theme = ThemeDocument::default();
    theme.colors.accent = "url(https://example.invalid/leak)".into();
    assert!(theme.validate().is_err());
}

#[test]
fn rejects_unknown_schema_and_unbounded_metrics() {
    let mut theme = ThemeDocument::default();
    theme.schema_version = 999;
    assert!(theme.validate().is_err());
    theme.schema_version = 1;
    theme.text_scale = f32::INFINITY;
    assert!(theme.validate().is_err());
    theme.text_scale = 1.0;
    theme.radius = u32::MAX;
    assert!(theme.validate().is_err());
    theme.radius = 12;
    theme.spacing_scale = 0.0;
    assert!(theme.validate().is_err());
    theme.spacing_scale = f32::NAN;
    assert!(theme.validate().is_err());
}

#[test]
fn older_theme_documents_default_spacing_and_custom_density_round_trips() {
    let mut older = serde_json::to_value(ThemeDocument::default()).unwrap();
    older.as_object_mut().unwrap().remove("spacingScale");
    let restored: ThemeDocument = serde_json::from_value(older).unwrap();
    assert_eq!(restored.spacing_scale, 1.0);
    let custom = ThemeDocument { spacing_scale: 0.75, ..restored };
    assert!(custom.validate().is_ok());
    let saved: ThemeDocument = serde_json::from_slice(&serde_json::to_vec(&custom).unwrap()).unwrap();
    assert_eq!(saved.spacing_scale, 0.75);
}

#[test]
fn rejects_empty_ids() {
    let mut theme = ThemeDocument::default();
    theme.id.clear();
    assert!(theme.validate().is_err());
}
