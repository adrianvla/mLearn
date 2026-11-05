//! Explicit real-model verification, never an ordinary test or build step.
use mlearn_desktop_ocr::{manga::Manga, session::initialize};
use std::path::Path;

fn main() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if !(7..=10).contains(&args.len()) {
        return Err("Usage: recognize ORT_LIBRARY MODELS IMAGE LEFT TOP WIDTH HEIGHT [cpu|auto] [REPEATS] [PROFILE_DIRECTORY]".into());
    }
    initialize(Path::new(&args[0]))?;
    let cpu_only = match args.get(7).map(String::as_str) {
        None | Some("cpu") => true,
        Some("auto") => false,
        _ => return Err("Expected cpu or auto provider mode".into()),
    };
    let repeats = args
        .get(8)
        .map(|value| value.parse::<u32>())
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or(1);
    if !(1..=3).contains(&repeats) {
        return Err("Verification repeats must be 1-3".into());
    }
    let profile = args.get(9).map(Path::new);
    let start = std::time::Instant::now();
    let mut model = Manga::open_profiled(Path::new(&args[1]), cpu_only, profile)?;
    let initialized_ms = start.elapsed().as_secs_f64() * 1000.0;
    let image = image::open(&args[2])
        .map_err(|error| error.to_string())?
        .to_rgb8();
    let numbers = args[3..7]
        .iter()
        .map(|value| value.parse::<u32>().map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let [left, top, width, height] = numbers[..] else {
        return Err("Expected four crop coordinates".into());
    };
    if width == 0
        || height == 0
        || left
            .checked_add(width)
            .is_none_or(|right| right > image.width())
        || top
            .checked_add(height)
            .is_none_or(|bottom| bottom > image.height())
    {
        return Err("Crop must lie inside the original image".into());
    }
    let crop = image::imageops::crop_imm(&image, left, top, width, height).to_image();
    for iteration in 0..repeats {
        let mut value = serde_json::to_value(model.recognize(&crop, || false)?)
            .map_err(|error| error.to_string())?;
        value["iteration"] = serde_json::json!(iteration);
        value["initializationMs"] = serde_json::json!(initialized_ms);
        println!("{value}");
    }
    if profile.is_some() {
        println!(
            "{}",
            serde_json::json!({"profiles":model.finish_profiling()?})
        );
    }
    Ok(())
}
