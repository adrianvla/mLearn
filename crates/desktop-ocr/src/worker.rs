//! Rust-only staged inference worker. The desktop host owns admission, the
//! authenticated resource lease, package stages, deadlines and kill/reap.
use crate::raster::actual_crop;
use crate::{
    ctc::Ctc,
    detector::{Detector, Preset},
    manga::Manga,
    session::initialize,
};
use mlearn_core::{OcrPlan, OcrPoint, OcrQuad};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, Write},
    path::{Component, Path, PathBuf},
    time::Instant,
};

const FRAME_LIMIT: usize = 192 * 1024;

/// The installed desktop executable also supplies its exact-source inference
/// worker mode. This branch runs before any GUI/runtime startup on every OS.
pub fn handle_process_mode() -> bool {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|mode| mode == "--raster-page") {
        if let Err(error) = crate::raster_helper::run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return true;
    }
    if args.first().is_none_or(|mode| mode != "--native-ocr") {
        return false;
    }
    if let Err(error) = run(&args[1..]) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}

#[derive(Deserialize)]
#[serde(tag = "executor", rename_all_fields = "camelCase", deny_unknown_fields)]
enum Profile {
    #[serde(rename = "paddle-manga-onnx-v1")]
    Manga {
        schema_version: u32,
        detector: GraphProfile,
        recognizer_directory: String,
    },
    #[serde(rename = "paddle-ctc-onnx-v1")]
    Ctc {
        schema_version: u32,
        detector: GraphProfile,
        recognizer: GraphProfile,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GraphProfile {
    path: String,
    input: String,
    output: String,
}
enum Recognizer {
    Manga(Manga),
    Ctc(Ctc),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    plan: OcrPlan,
    #[serde(default)]
    rasterized_pdf: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group {
    quad: OcrQuad,
    sources: Vec<u32>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Groups {
    groups: Vec<Group>,
}

fn resource(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.len() > 256
        || path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Invalid authenticated model resource path".into());
    }
    let path = root
        .join(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !path.starts_with(root) {
        return Err("Model resource escaped its installation".into());
    }
    Ok(path)
}

fn receive(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut bytes = Vec::new();
    loop {
        let buffer = reader.fill_buf().map_err(|error| error.to_string())?;
        if buffer.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err("Truncated OCR stage frame".into())
            };
        }
        let newline = buffer.iter().position(|&byte| byte == b'\n');
        let count = newline.map_or(buffer.len(), |index| index + 1);
        if bytes.len() + count > FRAME_LIMIT {
            return Err("OCR stage frame exceeds 192 KiB".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if newline.is_some() {
            return Ok(Some(bytes));
        }
    }
}

fn emit(output: &mut impl Write, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    if bytes.len() >= FRAME_LIMIT {
        return Err("OCR stage result exceeds 192 KiB".into());
    }
    bytes.push(b'\n');
    output
        .write_all(&bytes)
        .and_then(|()| output.flush())
        .map_err(|error| error.to_string())
}

fn source(request: &Request) -> Result<image::RgbImage, String> {
    if request.plan.page_index.is_some() {
        return Err("PDF must be rasterized by the admitted platform helper".into());
    }
    let maximum = if request.rasterized_pdf {
        64 * 1024 * 1024
    } else {
        8 * 1024 * 1024
    };
    crate::raster::open(Path::new(&request.plan.path), maximum)
}

pub fn run(args: &[String]) -> Result<(), String> {
    if args.len() != 2 {
        return Err("Usage: mlearn-desktop-ocr ORT_LIBRARY MODELS_DIRECTORY".into());
    }
    let root = Path::new(&args[1])
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let profile_text = crate::bounded_text(&root.join("profile.json"), 65536)?;
    let profile: Profile =
        serde_json::from_str(&profile_text).map_err(|error| error.to_string())?;
    let (schema_version, detector_profile, preset, recognizer_graph) = match &profile {
        Profile::Manga {
            schema_version,
            detector,
            ..
        } => (*schema_version, detector, Preset::PaddleManga, None),
        Profile::Ctc {
            schema_version,
            detector,
            recognizer,
        } => (*schema_version, detector, Preset::Rapid, Some(recognizer)),
    };
    if schema_version != 1 {
        return Err("Unsupported native OCR model profile".into());
    }
    for graph in [Some(detector_profile), recognizer_graph]
        .into_iter()
        .flatten()
    {
        if graph.input.is_empty()
            || graph.output.is_empty()
            || graph.input.len() > 128
            || graph.output.len() > 128
        {
            return Err("Native OCR graph binding exceeds its bounds".into());
        }
    }
    let detector_path = resource(&root, &detector_profile.path)?;
    let recognizer_path = resource(
        &root,
        match &profile {
            Profile::Manga {
                recognizer_directory,
                ..
            } => recognizer_directory,
            Profile::Ctc { recognizer, .. } => &recognizer.path,
        },
    )?;
    initialize(Path::new(&args[0]))?;
    let mut detector: Option<Detector> = None;
    let mut recognizer: Option<Recognizer> = None;
    let mut detector_initializations = 0_u32;
    let mut recognizer_initializations = 0_u32;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    while let Some(bytes) = receive(&mut input)? {
        let request: Request = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        let original = source(&request)?;
        let (width, height) = original.dimensions();
        let crop = request
            .plan
            .crop
            .as_ref()
            .map(|crop| actual_crop(crop, width, height))
            .transpose()?;
        let started = Instant::now();
        let detections = if crop.is_some() {
            vec![]
        } else {
            if detector.is_none() {
                detector = Some(Detector::open(
                    &detector_path,
                    &detector_profile.input,
                    &detector_profile.output,
                    preset,
                    false,
                )?);
                detector_initializations += 1;
            }
            detector
                .as_mut()
                .ok_or("Detector is unavailable")?
                .detect(&original)?
                .quads
                .into_iter()
                .map(|quad| OcrQuad {
                    top_left: OcrPoint {
                        x: quad[0][0],
                        y: quad[0][1],
                    },
                    top_right: OcrPoint {
                        x: quad[1][0],
                        y: quad[1][1],
                    },
                    bottom_right: OcrPoint {
                        x: quad[2][0],
                        y: quad[2][1],
                    },
                    bottom_left: OcrPoint {
                        x: quad[3][0],
                        y: quad[3][1],
                    },
                })
                .collect::<Vec<_>>()
        };
        emit(
            &mut output,
            json!({"type":"detected","width":width,"height":height,"crop":crop,
            "detections":detections,"metrics":{"detectorMs":started.elapsed().as_secs_f64()*1000.0,
            "detectorInitializations":detector_initializations,
            "backend":detector.as_ref().map(|detector| &detector.graph.backend)}}),
        )?;
        let groups: Groups =
            serde_json::from_slice(&receive(&mut input)?.ok_or("Missing OCR package groups")?)
                .map_err(|error| error.to_string())?;
        if groups.groups.len() > 512 {
            return Err("OCR package groups exceed 512 regions".into());
        }
        let mut raw = Vec::with_capacity(groups.groups.len());
        let mut confidences = Vec::with_capacity(groups.groups.len());
        let mut backend = None;
        let mut raw_bytes = 0_usize;
        let mut timings = Vec::with_capacity(groups.groups.len());
        // Rapid crops its globally resized source; Manga crops original pixels.
        // Both retain normalized original-source geometry in stored evidence.
        let ctc_source = if !groups.groups.is_empty() && matches!(&profile, Profile::Ctc { .. }) {
            Some(crate::detector::rapid_outer(&original)?)
        } else {
            None
        };
        if !groups.groups.is_empty() && recognizer.is_none() {
            recognizer = Some(match &profile {
                Profile::Manga { .. } => Recognizer::Manga(Manga::open(&recognizer_path, false)?),
                Profile::Ctc { recognizer, .. } => Recognizer::Ctc(
                    Ctc::open(
                        &recognizer_path,
                        &recognizer.input,
                        &recognizer.output,
                        false,
                    )
                    .map_err(|error| error.to_string())?,
                ),
            });
            recognizer_initializations += 1;
        }
        for group in groups.groups {
            if group
                .sources
                .iter()
                .any(|&index| index as usize >= detections.len())
            {
                return Err("Package group references an unknown detector observation".into());
            }
            let points = [
                &group.quad.top_left,
                &group.quad.top_right,
                &group.quad.bottom_right,
                &group.quad.bottom_left,
            ];
            if points.iter().any(|point| {
                !point.x.is_finite()
                    || !point.y.is_finite()
                    || !(0.0..=1.0).contains(&point.x)
                    || !(0.0..=1.0).contains(&point.y)
            }) {
                return Err("Package group lies outside the original source".into());
            }
            let pixel = |value: f64| {
                if (value - value.round()).abs() < 1e-7 {
                    value.round()
                } else {
                    value.trunc()
                }
            };
            let left =
                pixel(points.iter().map(|point| point.x).fold(1.0, f64::min) * f64::from(width))
                    as u32;
            let top =
                pixel(points.iter().map(|point| point.y).fold(1.0, f64::min) * f64::from(height))
                    as u32;
            let right =
                pixel(points.iter().map(|point| point.x).fold(0.0, f64::max) * f64::from(width))
                    as u32;
            let bottom =
                pixel(points.iter().map(|point| point.y).fold(0.0, f64::max) * f64::from(height))
                    as u32;
            let (right, bottom) = (
                right.max(left + 1).min(width),
                bottom.max(top + 1).min(height),
            );
            if left >= right || top >= bottom {
                return Err("Package recognition crop is empty".into());
            }
            let start = Instant::now();
            let (text, confidence, execution) = match recognizer
                .as_mut()
                .ok_or("Recognizer is unavailable")?
            {
                Recognizer::Manga(model) => {
                    let image =
                        image::imageops::crop_imm(&original, left, top, right - left, bottom - top)
                            .to_image();
                    let recognized = model.recognize(&image, || false)?;
                    (
                        recognized.raw_text,
                        None,
                        json!({
                            "encoder":recognized.metrics["encoderBackend"],
                            "decoder":recognized.metrics["decoderBackend"],
                        }),
                    )
                }
                Recognizer::Ctc(model) => {
                    let image = crate::raster::rectified(
                        ctc_source
                            .as_ref()
                            .ok_or("Generic OCR source is unavailable")?,
                        &group.quad,
                    )?;
                    let recognized = model.recognize(&image).map_err(|error| error.to_string())?;
                    (
                        recognized.text,
                        recognized.confidence,
                        json!({"recognizer":model.graph.backend}),
                    )
                }
            };
            raw_bytes += text.len();
            if raw_bytes > 32768 {
                return Err("OCR recognition exceeds 32 KiB".into());
            }
            raw.push(text);
            confidences.push(confidence);
            backend = Some(execution);
            timings.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        emit(
            &mut output,
            json!({"type":"recognized","rawRecognition":raw,"confidences":confidences,
            "metrics":{"recognitionMs":timings,"recognizerInitializations":recognizer_initializations,"backend":backend}}),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_core::OcrRect;
    #[test]
    fn frames_bound_each_message_and_reject_truncated_input() {
        let mut input = io::Cursor::new(b"{\"groups\":[]}\n{\"groups\":[]}\n");
        assert_eq!(receive(&mut input).unwrap().unwrap(), b"{\"groups\":[]}\n");
        assert_eq!(receive(&mut input).unwrap().unwrap(), b"{\"groups\":[]}\n");
        assert!(receive(&mut input).unwrap().is_none());
        assert!(receive(&mut io::Cursor::new(b"{\"groups\":[]}".as_slice())).is_err());
        assert!(receive(&mut io::Cursor::new(vec![b'x'; FRAME_LIMIT + 1])).is_err());
    }
    #[test]
    fn selected_crop_rounds_once_against_original_upright_pixels() {
        let crop = OcrRect {
            x: 0.111,
            y: 0.201,
            width: 0.333,
            height: 0.301,
        };
        let accepted = actual_crop(&crop, 101, 203).unwrap();
        assert_eq!(accepted.x, 11.0 / 101.0);
        assert_eq!(accepted.y, 40.0 / 203.0);
        assert_eq!(accepted.width, 34.0 / 101.0);
        assert_eq!(accepted.height, 62.0 / 203.0);
        assert!(actual_crop(&OcrRect { x: 0.9, ..crop }, 101, 203).is_err());
    }
    #[test]
    fn model_paths_cannot_leave_the_signed_inventory_root() {
        let root = Path::new("/authenticated");
        for path in ["", "/outside", "../outside", "models/../../outside"] {
            assert!(resource(root, path).is_err());
        }
    }
}
