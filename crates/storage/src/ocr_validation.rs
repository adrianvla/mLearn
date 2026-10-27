use crate::{StorageError, document_validation::invalid};
use mlearn_core::*;
use std::collections::BTreeSet;

pub(crate) const OCR_BYTES: usize = 384 * 1024;

pub(crate) fn field(value: &str) -> Result<(), StorageError> {
    if value.is_empty() || value.len() > 512 || value.contains('\0') {
        return Err(invalid("Invalid OCR identity or metadata"));
    }
    Ok(())
}

pub(crate) fn rect(value: &OcrRect) -> Result<(), StorageError> {
    if ![value.x, value.y, value.width, value.height]
        .iter()
        .all(|number| number.is_finite())
        || value.x < 0.0
        || value.y < 0.0
        || value.width <= 0.0
        || value.height <= 0.0
        || value.x + value.width > 1.0
        || value.y + value.height > 1.0
    {
        return Err(invalid("OCR crop must be a contained normalized rectangle"));
    }
    Ok(())
}

pub(crate) fn request(value: &OcrRequest) -> Result<(), StorageError> {
    for item in [
        &value.request_id,
        &value.source_id,
        &value.content_revision,
        &value.resource_id,
        &value.provider_id,
    ] {
        field(item)?;
    }
    if value.recognition_languages.len() > 32
        || value
            .recognition_languages
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != value.recognition_languages.len()
    {
        return Err(invalid("OCR languages exceed bounds or contain duplicates"));
    }
    for language in &value.recognition_languages {
        field(language)?;
    }
    if let Some(crop) = &value.crop {
        rect(crop)?;
    }
    Ok(())
}

pub(crate) fn provider(value: &OcrProvider) -> Result<(), StorageError> {
    for item in [
        &value.id,
        &value.label,
        &value.revision,
        &value.language_provenance,
    ] {
        field(item)?;
    }
    if value.languages.len() > 256 || value.scripts.len() > 64 {
        return Err(invalid("OCR provider capability metadata exceeds bounds"));
    }
    for item in value.languages.iter().chain(&value.scripts) {
        field(item)?;
    }
    if let Some(reason) = &value.reason {
        field(reason)?;
    }
    if value.availability != OcrAvailability::Ready {
        return Err(invalid("The selected OCR provider is unavailable"));
    }
    Ok(())
}

pub(crate) fn regions(values: &[OcrRegion]) -> Result<(), StorageError> {
    if values.len() > 512 {
        return Err(invalid("OCR output exceeds 512 observations"));
    }
    let mut ids = BTreeSet::new();
    let mut text_bytes = 0usize;
    for region in values {
        field(&region.id)?;
        if !ids.insert(&region.id) || region.candidates.len() > 3 {
            return Err(invalid(
                "OCR observations have duplicate IDs or too many candidates",
            ));
        }
        for item in [&region.language, &region.orientation, &region.reading_of]
            .into_iter()
            .flatten()
        {
            field(item)?;
        }
        text_bytes = text_bytes.saturating_add(region.text.len());
        for candidate in &region.candidates {
            text_bytes = text_bytes.saturating_add(candidate.text.len());
            if candidate
                .confidence
                .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
            {
                return Err(invalid(
                    "OCR confidence must be actual normalized evidence or null",
                ));
            }
        }
        // Provider corners can fall outside the source; preserve them unchanged.
        for point in [
            &region.quad.top_left,
            &region.quad.top_right,
            &region.quad.bottom_right,
            &region.quad.bottom_left,
        ] {
            if !point.x.is_finite() || !point.y.is_finite() {
                return Err(invalid(
                    "OCR geometry must contain finite source coordinates",
                ));
            }
        }
        let q = &region.quad;
        let area = (q.top_left.x * q.top_right.y - q.top_right.x * q.top_left.y
            + q.top_right.x * q.bottom_right.y
            - q.bottom_right.x * q.top_right.y
            + q.bottom_right.x * q.bottom_left.y
            - q.bottom_left.x * q.bottom_right.y
            + q.bottom_left.x * q.top_left.y
            - q.top_left.x * q.bottom_left.y)
            .abs();
        if !area.is_finite() || area <= f64::EPSILON {
            return Err(invalid("OCR region has no usable polygon"));
        }
        let corners = [&q.top_left, &q.top_right, &q.bottom_right, &q.bottom_left];
        let turns: [f64; 4] = std::array::from_fn(|index| {
            let a = corners[index];
            let b = corners[(index + 1) % 4];
            let c = corners[(index + 2) % 4];
            (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
        });
        if !(turns.iter().all(|turn| *turn > f64::EPSILON)
            || turns.iter().all(|turn| *turn < -f64::EPSILON))
        {
            return Err(invalid(
                "OCR region corners must describe a convex source quad",
            ));
        }
    }
    if text_bytes > 32768 {
        return Err(invalid("OCR text and candidates exceed 32 KiB"));
    }
    for region in values {
        if let Some(context) = &region.context_region_ids {
            if context.is_empty()
                || context.len() > 16
                || !context.contains(&region.id)
                || context.iter().collect::<BTreeSet<_>>().len() != context.len()
            {
                return Err(invalid(
                    "OCR context requires 1-16 unique ordered regions including its selection",
                ));
            }
            let mut bytes = 0usize;
            for id in context {
                let original = values
                    .iter()
                    .find(|r| &r.id == id)
                    .ok_or_else(|| invalid("OCR context must refer to the same page"))?;
                bytes = bytes.saturating_add(original.text.len());
            }
            if bytes > 4096 {
                return Err(invalid("OCR context exceeds 4096 UTF-8 bytes"));
            }
        }
        if let Some(target) = &region.reading_of
            && (target == &region.id || !ids.contains(target))
        {
            return Err(invalid(
                "OCR reading annotation must identify another source region",
            ));
        }
    }
    Ok(())
}

pub(crate) fn page(value: &OcrPage) -> Result<(), StorageError> {
    for item in [
        &value.source_id,
        &value.content_revision,
        &value.resource_id,
    ] {
        field(item)?;
    }
    provider(&value.provider)?;
    if value.width == 0
        || value.height == 0
        || value.width > 65536
        || value.height > 65536
        || u64::from(value.width) * u64::from(value.height) > 268_435_456
        || value.ocr_revision == 0
    {
        return Err(invalid("OCR original dimensions or revision exceed bounds"));
    }
    if let Some(crop) = &value.crop {
        rect(crop)?;
    }
    regions(&value.regions)?;
    if serde_json::to_vec(value)?.len() > OCR_BYTES {
        return Err(invalid("OCR page exceeds bounded native transport"));
    }
    Ok(())
}

pub(crate) fn stages(result: &OcrNativeResult) -> Result<(), StorageError> {
    let Some(stage) = &result.stage_evidence else {
        return Ok(());
    };
    for value in [&stage.profile_revision, &stage.package_revision] {
        if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid("Invalid OCR stage revision"));
        }
    }
    if stage.detections.len() > 512
        || stage.groups.len() != result.regions.len()
        || stage.raw_recognition.len() != result.regions.len()
        || stage.raw_recognition.iter().map(String::len).sum::<usize>() > 32768
    {
        return Err(invalid(
            "OCR stage evidence exceeds bounds or lacks group recognition",
        ));
    }
    let geometry = stage
        .detections
        .iter()
        .enumerate()
        .map(|(i, quad)| OcrRegion {
            id: i.to_string(),
            text: String::new(),
            quad: quad.clone(),
            candidates: vec![],
            language: None,
            orientation: None,
            reading_of: None,
            context_region_ids: None,
        })
        .collect::<Vec<_>>();
    regions(&geometry)?;
    let mut seen = BTreeSet::new();
    for group in &stage.groups {
        if group.is_empty() && result.crop.is_none() {
            return Err(invalid("Detected OCR group has no detector evidence"));
        }
        for &index in group {
            if index as usize >= stage.detections.len() || !seen.insert(index) {
                return Err(invalid("OCR detection mapping is duplicated or invalid"));
            }
        }
    }
    if seen.len() != stage.detections.len() {
        return Err(invalid("OCR grouping discarded detector evidence"));
    }
    Ok(())
}

pub(crate) fn intersects(region: &OcrRegion, crop: &OcrRect) -> bool {
    let points = [
        &region.quad.top_left,
        &region.quad.top_right,
        &region.quad.bottom_right,
        &region.quad.bottom_left,
    ];
    let rectangle = [
        OcrPoint {
            x: crop.x,
            y: crop.y,
        },
        OcrPoint {
            x: crop.x + crop.width,
            y: crop.y,
        },
        OcrPoint {
            x: crop.x + crop.width,
            y: crop.y + crop.height,
        },
        OcrPoint {
            x: crop.x,
            y: crop.y + crop.height,
        },
    ];
    // Separating axes use actual provider edges, not an axis-aligned bounding
    // box that can erase unrelated slanted text beside a crop.
    let edges = points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(4)
        .map(|(from, to)| (from.y - to.y, to.x - from.x));
    [(1.0, 0.0), (0.0, 1.0)]
        .into_iter()
        .chain(edges)
        .all(|(x, y)| {
            let project = |vertices: &[&OcrPoint]| {
                vertices
                    .iter()
                    .map(|point| point.x * x + point.y * y)
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), value| {
                        (min.min(value), max.max(value))
                    })
            };
            let (min, max) = project(&points);
            let (crop_min, crop_max) = project(&rectangle.each_ref());
            max > crop_min && crop_max > min
        })
}
