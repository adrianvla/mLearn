use mlearn_core::{OcrPage, OcrPoint, OcrQuad, OcrRect};
use mlearn_language_sdk::serde_json::{self, Value, json};
use serde::{Deserialize, Serialize};

pub(super) fn profile() -> Value {
    json!({"providerId":"org.mlearn.english.paddle-ctc","profileId":"org.mlearn.paddle-ctc.onnx.v1",
        "label":"English · PaddleOCR","languages":["en"],"scripts":["Latn"]})
}

pub(super) fn geometry(input: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct Input {
        detections: Vec<OcrQuad>,
        width: u32,
        height: u32,
        crop: Option<OcrRect>,
    }
    #[derive(Serialize)]
    struct Group {
        quad: OcrQuad,
        sources: Vec<usize>,
    }
    let input: Input = serde_json::from_value(input).map_err(|e| e.to_string())?;
    if input.detections.len() > 512 || input.width == 0 || input.height == 0 {
        return Err("Invalid OCR geometry input".into());
    }
    if let Some(crop) = input.crop {
        if !input.detections.is_empty() {
            return Err("Selected-crop recognition must bypass detection".into());
        }
        return Ok(json!([Group {
            quad: OcrQuad {
                top_left: OcrPoint {
                    x: crop.x,
                    y: crop.y
                },
                top_right: OcrPoint {
                    x: crop.x + crop.width,
                    y: crop.y
                },
                bottom_right: OcrPoint {
                    x: crop.x + crop.width,
                    y: crop.y + crop.height
                },
                bottom_left: OcrPoint {
                    x: crop.x,
                    y: crop.y + crop.height
                },
            },
            sources: vec![],
        }]));
    }
    let mut groups = input
        .detections
        .into_iter()
        .enumerate()
        .map(|(index, quad)| Group {
            quad,
            sources: vec![index],
        })
        .collect::<Vec<_>>();
    // Rapid's line order is a package policy, not a language branch in core.
    groups.sort_by(|a, b| {
        a.quad
            .top_left
            .y
            .total_cmp(&b.quad.top_left.y)
            .then(a.quad.top_left.x.total_cmp(&b.quad.top_left.x))
    });
    for i in 1..groups.len() {
        let mut j = i;
        while j > 0
            && (groups[j].quad.top_left.y - groups[j - 1].quad.top_left.y).abs()
                * f64::from(input.height)
                < 10.0
            && groups[j].quad.top_left.x < groups[j - 1].quad.top_left.x
        {
            groups.swap(j, j - 1);
            j -= 1;
        }
    }
    serde_json::to_value(groups).map_err(|e| e.to_string())
}

pub(super) fn recognition(input: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct Input {
        texts: Vec<String>,
    }
    let input: Input = serde_json::from_value(input).map_err(|e| e.to_string())?;
    if input.texts.len() > 512 || input.texts.iter().map(String::len).sum::<usize>() > 32768 {
        return Err("OCR text stage exceeds bounds".into());
    }
    // Do not apply Japanese whitespace/width normalization to generic output.
    Ok(json!(input.texts))
}

pub(super) fn postprocess(input: Value) -> Result<Value, String> {
    let mut page: OcrPage =
        serde_json::from_value(input["page"].clone()).map_err(|e| e.to_string())?;
    if page.regions.len() > 512 {
        return Err("OCR context exceeds page bounds".into());
    }
    let bounds = page
        .regions
        .iter()
        .map(|r| {
            let q = &r.quad;
            [&q.top_left, &q.top_right, &q.bottom_right, &q.bottom_left]
                .iter()
                .fold(
                    (
                        f64::INFINITY,
                        f64::INFINITY,
                        f64::NEG_INFINITY,
                        f64::NEG_INFINITY,
                    ),
                    |(l, t, r, b), p| (l.min(p.x), t.min(p.y), r.max(p.x), b.max(p.y)),
                )
        })
        .collect::<Vec<_>>();
    for i in 0..page.regions.len() {
        let (l, t, r, b) = bounds[i];
        let mut context = bounds
            .iter()
            .enumerate()
            .filter_map(|(j, &(ll, tt, rr, bb))| {
                let height = b - t;
                let neighbor_height = bb - tt;
                let same_size = height.min(neighbor_height) >= 0.65 * height.max(neighbor_height);
                let same_row = t.max(tt) < b.min(bb)
                    && l.max(ll) - r.min(rr) <= 3.0 * height.max(neighbor_height);
                let next_line = l.max(ll) < r.min(rr)
                    && t.max(tt) - b.min(bb) <= 2.0 * height.max(neighbor_height);
                (j == i || (same_size && (same_row || next_line))).then_some(j)
            })
            .collect::<Vec<_>>();
        context.sort_by(|&a, &b| {
            bounds[a]
                .1
                .total_cmp(&bounds[b].1)
                .then(bounds[a].0.total_cmp(&bounds[b].0))
        });
        if context.len() <= 16
            && context
                .iter()
                .map(|&j| page.regions[j].text.len())
                .sum::<usize>()
                <= 4096
        {
            page.regions[i].context_region_ids = Some(
                context
                    .iter()
                    .map(|&j| page.regions[j].id.clone())
                    .collect(),
            );
        }
    }
    serde_json::to_value(page.regions).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_language_sdk::serde_json::json;
    #[test]
    fn generic_stages_preserve_skewed_observations_and_ctc_text() {
        let quad = |x, y| {
            json!({"topLeft":{"x":x,"y":y},"topRight":{"x":x+0.2,"y":y+0.001},
            "bottomRight":{"x":x+0.19,"y":y+0.05},"bottomLeft":{"x":x-0.01,"y":y+0.049}})
        };
        let detections = json!([quad(0.7, 0.1), quad(0.1, 0.105), quad(0.2, 0.4)]);
        let result =
            geometry(json!({"detections":detections,"width":1000,"height":1000,"crop":null}))
                .unwrap();
        assert_eq!(result[0]["sources"], json!([1]));
        assert_eq!(result[0]["quad"], detections[1]);
        assert_eq!(result[1]["sources"], json!([0]));
        assert_eq!(result[2]["sources"], json!([2]));
        let texts = json!(["Read  42.", "", "naïve 😀"]);
        assert_eq!(recognition(json!({"texts":texts})).unwrap(), texts);
        assert_eq!(profile()["profileId"], "org.mlearn.paddle-ctc.onnx.v1");
        assert_eq!(profile()["languages"], json!(["en"]));
    }
    #[test]
    fn selected_generic_crop_has_no_detector_sources() {
        let result = geometry(json!({"detections":[],"width":1000,"height":800,
            "crop":{"x":0.2,"y":0.3,"width":0.4,"height":0.1}}))
        .unwrap();
        assert_eq!(result[0]["sources"], json!([]));
        assert_eq!(result[0]["quad"]["topLeft"], json!({"x":0.2,"y":0.3}));
        assert!(
            geometry(
                json!({"detections":[result[0]["quad"]],"width":1000,"height":800,
            "crop":{"x":0.2,"y":0.3,"width":0.4,"height":0.1}})
            )
            .is_err()
        );
    }
    #[test]
    fn nearby_context_keeps_original_bytes_and_excludes_other_columns() {
        let region = |id: &str, text: &str, x: f64, y: f64| {
            json!({"id":id,"text":text,
            "quad":{"topLeft":{"x":x,"y":y},"topRight":{"x":x+0.2,"y":y},"bottomRight":{"x":x+0.2,"y":y+0.05},"bottomLeft":{"x":x,"y":y+0.05}},
            "candidates":[],"language":null,"orientation":null,"readingOf":null})
        };
        let regions = json!([
            region("a", "A😀 source", 0.1, 0.1),
            region("b", "Read again.", 0.1, 0.18),
            region("c", "Other column", 0.75, 0.1)
        ]);
        let result=postprocess(json!({"page":{"sourceId":"fixture","contentRevision":"1","resourceId":"page","ocrRevision":1,
            "provider":{"id":"fixture","label":"Fixture","revision":"1","availability":"ready","languages":["en"],"scripts":[],
                "languageProvenance":"Deterministic package fixture","reason":null},"width":1000,"height":1000,"crop":null,"regions":regions}})).unwrap();
        assert_eq!(result[0]["contextRegionIds"], json!(["a", "b"]));
        assert_eq!(result[2]["contextRegionIds"], json!(["c"]));
        assert_eq!(result[0]["text"], regions[0]["text"]);
        assert_eq!(result[0]["quad"], regions[0]["quad"]);
    }
}
