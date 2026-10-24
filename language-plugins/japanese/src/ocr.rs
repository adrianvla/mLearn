//! Japanese OCR geometry and interpretation, executed by the installed package.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Deserialize, Serialize)]
struct Point {
    x: f64,
    y: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Quad {
    top_left: Point,
    top_right: Point,
    bottom_right: Point,
    bottom_left: Point,
}
impl Quad {
    fn bounds(&self) -> (f64, f64, f64, f64) {
        let points = [
            &self.top_left,
            &self.top_right,
            &self.bottom_right,
            &self.bottom_left,
        ];
        points.iter().fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |(l, t, r, b), p| (l.min(p.x), t.min(p.y), r.max(p.x), b.max(p.y)),
        )
    }
    fn rectangle(l: f64, t: f64, r: f64, b: f64) -> Self {
        Self {
            top_left: Point { x: l, y: t },
            top_right: Point { x: r, y: t },
            bottom_right: Point { x: r, y: b },
            bottom_left: Point { x: l, y: b },
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeometryInput {
    detections: Vec<Quad>,
    width: u32,
    height: u32,
    crop: Option<Crop>,
}
#[derive(Deserialize)]
struct Crop {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Serialize)]
struct Group {
    quad: Quad,
    sources: Vec<usize>,
}

pub(super) fn profile() -> Value {
    json!({"providerId":"org.mlearn.japanese.paddle-manga","profileId":"org.mlearn.paddle-manga.onnx.v1",
        "label":"Japanese · PaddleOCR + MangaOCR","languages":["ja"],"scripts":["Jpan"]})
}
pub(super) fn geometry(input: Value) -> Result<Value, String> {
    let input: GeometryInput = serde_json::from_value(input).map_err(|e| e.to_string())?;
    if input.detections.len() > 512 || input.width == 0 || input.height == 0 {
        return Err("Invalid OCR geometry input".into());
    }
    if let Some(crop) = input.crop {
        if !input.detections.is_empty() {
            return Err("Selected-crop recognition must bypass detection".into());
        }
        return Ok(json!([Group {
            quad: Quad::rectangle(crop.x, crop.y, crop.x + crop.width, crop.y + crop.height),
            sources: vec![]
        }]));
    }
    let mut groups = input
        .detections
        .into_iter()
        .enumerate()
        .map(|(i, quad)| Group {
            quad,
            sources: vec![i],
        })
        .collect::<Vec<_>>();
    // Merge only aligned vertical fragments. Legacy's width/gap union-find
    // merged independent horizontal lines and swallowed their interline space.
    // A narrow ruby column must not merge into an adjacent full-sized column.
    let w = f64::from(input.width);
    let h = f64::from(input.height);
    let mut i = 0;
    while i < groups.len() {
        let (l, t, r, b) = groups[i].quad.bounds();
        let aw = (r - l) * w;
        let ah = (b - t) * h;
        if ah > 1.3 * aw {
            let mut j = i + 1;
            while j < groups.len() {
                let (ll, tt, rr, bb) = groups[j].quad.bounds();
                let bw = (rr - ll) * w;
                let bh = (bb - tt) * h;
                let overlap = (r.min(rr) - l.max(ll)) * w;
                let gap = ((t.max(tt) - b.min(bb)) * h).max(0.0);
                if bh > 1.3 * bw
                    && aw.min(bw) >= 0.65 * aw.max(bw)
                    && overlap >= 0.65 * aw.min(bw)
                    && gap <= 1.5 * aw.max(bw)
                {
                    let other = groups.remove(j);
                    let (gl, gt, gr, gb) = groups[i].quad.bounds();
                    groups[i].quad =
                        Quad::rectangle(gl.min(ll), gt.min(tt), gr.max(rr), gb.max(bb));
                    groups[i].sources.extend(other.sources);
                } else {
                    j += 1;
                }
            }
        }
        i += 1;
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
    let texts = input
        .texts
        .iter()
        .map(|text| {
            let compact = text
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
                .replace('…', "...");
            let mut output = String::new();
            let mut dots = String::new();
            for c in compact.chars().chain(std::iter::once('\0')) {
                if c == '・' || c == '.' {
                    dots.push(c);
                    continue;
                }
                if dots.chars().count() >= 2 {
                    output.extend(dots.chars().map(|_| '．'));
                } else {
                    output.extend(dots.chars().map(|d| if d == '.' { '．' } else { d }));
                }
                dots.clear();
                if c != '\0' {
                    output.push(if ('!'..='~').contains(&c) {
                        char::from_u32(u32::from(c) + 0xfee0).unwrap_or(c)
                    } else {
                        c
                    });
                }
            }
            let mut normalized = String::new();
            let mut kana = String::new();
            for c in output.chars().chain(std::iter::once('\0')) {
                if ('\u{ff61}'..='\u{ff9f}').contains(&c) {
                    kana.push(c);
                } else {
                    normalized.extend(kana.nfkc());
                    kana.clear();
                    if c != '\0' {
                        normalized.push(c);
                    }
                }
            }
            normalized
        })
        .collect::<Vec<_>>();
    Ok(json!(texts))
}

pub(super) fn postprocess(input: Value) -> Result<Value, String> {
    let mut regions = input
        .get("page")
        .and_then(|v| v.get("regions"))
        .and_then(Value::as_array)
        .cloned()
        .ok_or("Expected OCR page")?;
    if regions.len() > 512 {
        return Err("Too many OCR regions".into());
    }
    let quads = regions
        .iter()
        .map(|r| serde_json::from_value::<Quad>(r["quad"].clone()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let bounds = quads.iter().map(Quad::bounds).collect::<Vec<_>>();
    let page_width = input["page"]["width"]
        .as_f64()
        .ok_or("Missing OCR source width")?;
    let page_height = input["page"]["height"]
        .as_f64()
        .ok_or("Missing OCR source height")?;
    for i in 0..regions.len() {
        let (l, t, r, b) = bounds[i];
        let width = (r - l) * page_width;
        let height = (b - t) * page_height;
        let vertical = height > 1.3 * width;
        if regions[i]["orientation"].is_null() {
            regions[i]["orientation"] = json!(if vertical {
                "vertical-rl"
            } else {
                "horizontal-tb"
            });
        }
        // Publisher ruby is a narrower neighboring vertical column. Preserve
        // every original byte/quad/candidate; only add the interpretation link.
        let reading =
            if vertical {
                bounds.iter().enumerate().filter(|(j, _)| *j != i).find_map(
                    |(j, &(ll, tt, rr, bb))| {
                        let main_width = (rr - ll) * page_width;
                        (main_width >= width * 1.5
                            && (bb - tt) * page_height > main_width * 1.3
                            && l >= rr - 0.2 * (rr - ll)
                            && l - rr <= 0.9 * (rr - ll)
                            && t >= tt - 0.1 * (bb - tt)
                            && b <= bb + 0.1 * (bb - tt))
                            .then_some(j)
                    },
                )
            } else {
                None
            };
        if let Some(j) = reading {
            regions[i]["readingOf"] = regions[j]["id"].clone();
        }
        let mut context = bounds
            .iter()
            .enumerate()
            .filter_map(|(j, &(ll, tt, rr, bb))| {
                let neighbor_width = (rr - ll) * page_width;
                let neighbor_height = (bb - tt) * page_height;
                let same_axis = vertical == (neighbor_height > 1.3 * neighbor_width);
                let similar_size = if vertical {
                    width.min(neighbor_width) >= 0.65 * width.max(neighbor_width)
                } else {
                    height.min(neighbor_height) >= 0.65 * height.max(neighbor_height)
                };
                let nearby = if vertical {
                    (l.max(ll) - r.min(rr)) * page_width <= 3.0 * width.max(neighbor_width)
                        && t.max(tt) < b.min(bb)
                } else {
                    (t.max(tt) - b.min(bb)) * page_height <= 2.0 * height.max(neighbor_height)
                        && l.max(ll) < r.min(rr)
                };
                (j == i || (same_axis && similar_size && nearby)).then_some(j)
            })
            .collect::<Vec<_>>();
        context.sort_by(|&a, &b| {
            if vertical {
                bounds[b]
                    .0
                    .total_cmp(&bounds[a].0)
                    .then(bounds[a].1.total_cmp(&bounds[b].1))
            } else {
                bounds[a]
                    .1
                    .total_cmp(&bounds[b].1)
                    .then(bounds[a].0.total_cmp(&bounds[b].0))
            }
        });
        let bytes = context
            .iter()
            .map(|&j| regions[j]["text"].as_str().map_or(0, str::len))
            .sum::<usize>();
        if context.len() <= 16 && bytes <= 4096 {
            regions[i]["contextRegionIds"] = json!(context
                .iter()
                .map(|&j| regions[j]["id"].clone())
                .collect::<Vec<_>>());
        }
    }
    Ok(json!(regions))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn quad(l: f64, t: f64, r: f64, b: f64) -> Value {
        json!(Quad::rectangle(l, t, r, b))
    }
    #[test]
    fn horizontal_lines_remain_separate_before_recognition() {
        // Given the actual legacy-regression geometry normalized from 720x300.
        let detections = vec![
            quad(40.0 / 720.0, 39.0 / 300.0, 414.0 / 720.0, 74.0 / 300.0),
            quad(41.0 / 720.0, 122.0 / 300.0, 327.0 / 720.0, 160.0 / 300.0),
        ];
        // When the package chooses recognition crops.
        let result =
            geometry(json!({"detections":detections,"width":720,"height":300,"crop":null}))
                .unwrap();
        // Then independent lines are not merged into a false interline hit.
        assert_eq!(result.as_array().unwrap().len(), 2);
        assert_eq!(result[0]["sources"], json!([0]));
    }
    #[test]
    fn aligned_vertical_fragments_group_without_adjacent_ruby() {
        let result=geometry(json!({"detections":[quad(0.5,0.1,0.55,0.4),quad(0.5,0.45,0.55,0.75),quad(0.56,0.1,0.58,0.2)],"width":1000,"height":1000,"crop":null})).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 2);
        assert_eq!(result[0]["sources"], json!([0, 1]));
    }
    #[test]
    fn recognition_matches_retained_manga_text_rules() {
        let result = recognition(json!({"texts":["  日本 語 …・・.a42 "] })).unwrap();
        assert_eq!(result, json!(["日本語．．．．．．ａ４２"]));
    }
    #[test]
    fn recognition_preserves_non_kana_compatibility_forms() {
        let result = recognition(json!({"texts":[" ｶﾞｯｺｳ ① A1 ･ "]})).unwrap();
        assert_eq!(result, json!(["ガッコウ①Ａ１・"]));
    }
    #[test]
    fn ruby_and_right_to_left_context_do_not_rewrite_observations() {
        let region = |id: &str, text: &str, q: Value| json!({"id":id,"text":text,"quad":q,"candidates":[],"language":null,"orientation":null,"readingOf":null});
        let regions = json!([
            region("left", "青い本です", quad(0.36, 0.08, 0.45, 0.6)),
            region("right", "日本語を読む", quad(0.64, 0.08, 0.73, 0.7)),
            region("ruby", "にほんご", quad(0.74, 0.09, 0.78, 0.26))
        ]);
        let result =
            postprocess(json!({"page":{"width":480,"height":420,"regions":regions}})).unwrap();
        assert_eq!(result[2]["readingOf"], json!("right"));
        assert_eq!(result[1]["contextRegionIds"], json!(["right", "left"]));
        assert_eq!(result[0]["orientation"], json!("vertical-rl"));
        assert_eq!(result[1]["orientation"], json!("vertical-rl"));
        assert_eq!(regions[0]["orientation"], Value::Null);
        assert_eq!(result[0]["text"], regions[0]["text"]);
        assert_eq!(result[2]["quad"], regions[2]["quad"]);
    }
}
