use crate::execution::Failure;
use mlearn_core::LinguisticPresentation;
use std::collections::BTreeSet;

fn color(value: &Option<String>) -> bool {
    value.as_ref().is_none_or(|value| {
        value.len() == 7
            && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    })
}
fn attribution(value: &str) -> bool {
    !value.is_empty() && value.len() <= 2048
}

/// Admission for inert package display data, shared by analysis and inspection.
pub(super) fn validate(
    value: &Option<LinguisticPresentation>,
    text: &str,
    package: &str,
) -> Result<usize, Failure> {
    let Some(value) = value else {
        return Ok(0);
    };
    let invalid = || Failure::Operation("Invalid package linguistic presentation".into());
    let bytes = serde_json::to_vec(value)
        .map_err(|e| Failure::Operation(e.to_string()))?
        .len();
    if bytes > 8192
        || value.readings.len() > 16
        || value.labels.len() > 16
        || value.contours.len() > 16
        || value.levels.as_deref().unwrap_or_default().len() > 16
    {
        return Err(invalid());
    }
    let mut end = 0;
    for reading in &value.readings {
        let start = reading.start as usize;
        let next = reading.end as usize;
        if start < end
            || next <= start
            || text.get(start..next).is_none()
            || reading.text.is_empty()
            || reading.text.len() > 512
            || !attribution(&reading.attribution)
        {
            return Err(invalid());
        }
        if let Some(base) = &reading.base {
            let mut source = text[start..next].chars();
            if base.is_empty()
                || base.len() > 512
                || !base
                    .chars()
                    .all(|character| source.by_ref().any(|original| original == character))
            {
                return Err(invalid());
            }
        }
        end = next;
    }
    let prefix = format!("{package}:");
    let mut ids = BTreeSet::new();
    for level in value.levels.as_deref().unwrap_or_default() {
        if !level.scale_id.starts_with(&prefix)
            || level.scale_id.len() > 512
            || !ids.insert(&level.scale_id)
            || level.level.is_empty()
            || level.level.len() > 128
            || level.label.is_empty()
            || level.label.len() > 512
            || !(1..=7).contains(&level.rank)
            || !attribution(&level.attribution)
        {
            return Err(invalid());
        }
    }
    ids.clear();
    for label in &value.labels {
        if !label.id.starts_with(&prefix)
            || label.id.len() > 512
            || !ids.insert(&label.id)
            || label.label.is_empty()
            || label.label.len() > 512
            || !color(&label.color)
            || !attribution(&label.attribution)
        {
            return Err(invalid());
        }
    }
    ids.clear();
    for contour in &value.contours {
        if !contour.id.starts_with(&prefix)
            || contour.id.len() > 512
            || !ids.insert(&contour.id)
            || contour.reading.is_empty()
            || contour.reading.len() > 512
            || contour.units.is_empty()
            || contour.units.len() > 64
            || contour.label.is_empty()
            || contour.label.len() > 512
            || !color(&contour.color)
            || !attribution(&contour.attribution)
            || contour
                .following_height
                .is_some_and(|height| !height.is_finite() || !(0.0..=1.0).contains(&height))
            || contour.units.iter().any(|unit| {
                unit.text.is_empty()
                    || unit.text.len() > 32
                    || !unit.height.is_finite()
                    || !(0.0..=1.0).contains(&unit.height)
            })
            || contour
                .units
                .iter()
                .map(|unit| unit.text.as_str())
                .collect::<String>()
                != contour.reading
        {
            return Err(invalid());
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn presentation() -> serde_json::Value {
        json!({"readings":[{"start":0,"end":2,"text":"e","attribution":"Dictionary"}],
            "labels":[{"id":"org.example:unfamiliar-level","label":"Level A","color":"#aabbcc","attribution":"List"}],
            "contours":[{"id":"org.example:pronunciation-a","reading":"ab","units":[{"text":"a","height":0.0},{"text":"b","height":1.0}],
                "followingHeight":0.0,"label":"Pattern A","color":null,"attribution":"Pronunciations"}]})
    }
    fn admitted(value: serde_json::Value) -> bool {
        validate(
            &Some(serde_json::from_value(value).unwrap()),
            "éclair",
            "org.example",
        )
        .is_ok()
    }
    #[test]
    fn authentic_display_values_remain_inert_and_unknown_labels_round_trip() {
        let value = presentation();
        assert!(admitted(value.clone()));
        let parsed: LinguisticPresentation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        assert_eq!(validate(&None, "plain text", "org.example").unwrap(), 0);
    }
    #[test]
    fn inline_levels_are_package_owned_bounded_and_unique_per_scale() {
        let mut value = presentation();
        value["levels"] = json!([{"scaleId":"org.example:unknown-course","level":"stage-amber",
            "label":"Amber","rank":4,"attribution":"Course author"}]);
        assert!(admitted(value.clone()));
        let parsed: LinguisticPresentation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        value["levels"][0]["rank"] = json!(8);
        assert!(!admitted(value.clone()));
        value["levels"][0]["rank"] = json!(4);
        value["levels"][0]["scaleId"] = json!("different.package:course");
        assert!(!admitted(value.clone()));
        value["levels"][0]["scaleId"] = json!("org.example:unknown-course");
        let duplicate = value["levels"][0].clone();
        value["levels"].as_array_mut().unwrap().push(duplicate);
        assert!(!admitted(value));
    }
    #[test]
    fn invalid_coordinates_contours_colors_and_nested_budgets_are_rejected() {
        let mut value = presentation();
        value["readings"][0]["base"] = json!("é");
        assert!(admitted(value.clone()));
        value["readings"][0]["base"] = json!("invented");
        assert!(!admitted(value));
        let mut value = presentation();
        value["readings"][0]["end"] = json!(1);
        assert!(!admitted(value));
        let mut value = presentation();
        let duplicate = value["readings"][0].clone();
        value["readings"].as_array_mut().unwrap().push(duplicate);
        assert!(!admitted(value));
        for (field, invalid) in [
            ("color", json!("url(unsafe)")),
            ("id", json!("other:label")),
        ] {
            let mut value = presentation();
            value["labels"][0][field] = invalid;
            assert!(!admitted(value));
        }
        let mut value = presentation();
        value["contours"][0]["units"][0]["height"] = json!(2);
        assert!(!admitted(value));
        let mut value = presentation();
        value["contours"][0]["units"] = json!(vec![json!({"text":"a","height":0}); 65]);
        assert!(!admitted(value));
        let mut value = presentation();
        let contour = value["contours"][0].clone();
        value["contours"] = json!(
            (0..17)
                .map(|index| {
                    let mut contour = contour.clone();
                    contour["id"] = json!(format!("org.example:pattern-{index}"));
                    contour
                })
                .collect::<Vec<_>>()
        );
        assert!(!admitted(value));
        let mut value = presentation();
        value["labels"] = json!(
            (0..16)
                .map(|i| json!({"id":format!("org.example:{i}"),
            "label":"x".repeat(512),"color":null,"attribution":"List"}))
                .collect::<Vec<_>>()
        );
        assert!(!admitted(value));
    }
}
