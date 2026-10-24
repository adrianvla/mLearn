//! Local desktop provider. Requires ffmpeg and ffprobe on PATH; never downloads tools.
use mlearn_core::{CapturedMediaFile, MaterialMediaKind, MediaCapturePlan, MediaSegment};
use std::{
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::watch,
};

// Match the runtime's per-asset admission bound. Reaching it is failure, not a
// successful, silently truncated clip (-fs may exceed the limit by one packet).
const OUTPUT_BYTES: u64 = 128 * 1024 * 1024;
const STDOUT_BYTES: u64 = 32 * 1024;
const STDERR_BYTES: u64 = 64 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(300);

struct PartialOutput {
    path: PathBuf,
    published: bool,
}

impl Drop for PartialOutput {
    fn drop(&mut self) {
        if !self.published {
            if let Err(error) = std::fs::remove_file(&self.path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("Partial ffmpeg output cleanup failed: {error}");
                }
            }
        }
    }
}

fn seconds(ms: u32) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

fn command(plan: &MediaCapturePlan, input: &Path, output: &Path) -> Command {
    let mut command = Command::new("ffmpeg");
    command.args([
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-n",
        "-xerror",
        "-abort_on",
        "empty_output",
        "-filter_threads",
        "1",
        "-loglevel",
        match plan.kind {
            MaterialMediaKind::Image => "info",
            MaterialMediaKind::Audio | MaterialMediaKind::Video => "error",
        },
    ]);
    if plan.kind == MaterialMediaKind::Image {
        // Keep source-relative timestamps through showinfo. Without copyts,
        // input seeking subtracts start_ms from the decoded frame's timestamp.
        command.args(["-copyts", "-start_at_zero"]);
    }
    // Accurate input seeking decodes/discards from the preceding keyframe.
    // Transcode rather than stream-copy, which would preserve that extra range.
    command.args(["-ss", &seconds(plan.start_ms), "-accurate_seek"]);
    command.args(["-protocol_whitelist", "file", "-threads", "2", "-i"]);
    command.arg(input);
    command.args(["-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn"]);
    match plan.kind {
        MaterialMediaKind::Image => {
            command.args([
                "-map",
                "0:v:0",
                "-an",
                "-vf",
                "showinfo",
                "-frames:v",
                "1",
                "-fps_mode",
                "passthrough",
                "-c:v",
                "png",
                "-f",
                "image2",
                "-update",
                "1",
            ]);
        }
        MaterialMediaKind::Audio => {
            command.args([
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                &seconds(plan.end_ms - plan.start_ms),
                "-f",
                "ipod",
            ]);
        }
        MaterialMediaKind::Video => {
            command.args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt",
                "yuv420p",
                "-fps_mode",
                "passthrough",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                &seconds(plan.end_ms - plan.start_ms),
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
            ]);
        }
    }
    command.args(["-threads", "2", "-fs", &OUTPUT_BYTES.to_string()]);
    command.arg(output);
    command
}

async fn read_bounded(reader: impl AsyncRead + Unpin, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if u64::try_from(bytes.len()).map_err(|e| e.to_string())? > limit {
        return Err("Media provider exceeded its diagnostic output limit".into());
    }
    Ok(bytes)
}

async fn wait(
    child: &mut Child,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or("Media provider stdout unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Media provider stderr unavailable")?;
    let result = tokio::select! {
        biased;
        _ = cancelled.wait_for(|value| *value) => Err("Media capture cancelled".into()),
        _ = tokio::time::sleep(PROCESS_TIMEOUT) => Err("Media provider timed out".into()),
        result = async {
            tokio::try_join!(
                async { child.wait().await.map_err(|e| e.to_string()) },
                read_bounded(stdout, STDOUT_BYTES),
                read_bounded(stderr, STDERR_BYTES),
            )
        } => result,
    };
    if result.is_err() {
        // kill() waits as well as terminating: no process may keep writing after
        // the caller's partial-output guard removes the file.
        child
            .kill()
            .await
            .map_err(|e| format!("Cannot terminate/reap media provider: {e}"))?;
    }
    result
}

async fn run(
    command: &mut Command,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    if *cancelled.borrow() {
        return Err("Media capture cancelled".into());
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            format!("Local media provider unavailable (install ffmpeg with ffprobe on PATH): {e}")
        })?;
    let (status, stdout, stderr) = wait(&mut child, cancelled).await?;
    if !status.success() {
        return Err(format!(
            "Local media provider failed ({status}): {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok((stdout, stderr))
}

fn milliseconds(value: &str) -> Result<u32, String> {
    // ffprobe and showinfo emit seconds (sometimes in scientific notation).
    // Round at the contract's millisecond boundary, rejecting nonfinite/overflow.
    let ms = value.parse::<f64>().map_err(|e| e.to_string())? * 1000.0;
    if !ms.is_finite() || ms < 0.0 || ms.round() > f64::from(u32::MAX) {
        return Err("Media provider returned an invalid timestamp".into());
    }
    // Parse the rounded decimal rather than silently saturating a numeric cast.
    format!("{ms:.0}")
        .parse()
        .map_err(|e: std::num::ParseIntError| e.to_string())
}

fn frame_time(stderr: &[u8]) -> Result<u32, String> {
    let text = std::str::from_utf8(stderr).map_err(|e| e.to_string())?;
    let timestamp = text
        .lines()
        .filter(|line| line.contains("Parsed_showinfo_"))
        .find_map(|line| {
            line.split_once("pts_time:")
                .and_then(|(_, tail)| tail.split_whitespace().next())
        })
        .ok_or("Media provider did not report the captured frame timestamp")?;
    milliseconds(timestamp)
}

pub(crate) async fn extract(
    plan: &MediaCapturePlan,
    directory: &Path,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<CapturedMediaFile, String> {
    let name = match plan.kind {
        MaterialMediaKind::Image => "frame.png",
        MaterialMediaKind::Audio => "audio.m4a",
        MaterialMediaKind::Video => "video.mp4",
    };
    let mut output = PartialOutput {
        path: directory.join(name),
        published: false,
    };
    // A filesystem path, never a URL or an option, reaches the local-only input.
    let input = tokio::fs::canonicalize(&plan.path)
        .await
        .map_err(|e| e.to_string())?;
    let (_, stderr) = run(&mut command(plan, &input, &output.path), cancelled).await?;
    let metadata = tokio::fs::metadata(&output.path)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() >= OUTPUT_BYTES {
        return Err("Media provider output is empty or exceeds 128 MiB".into());
    }
    let (start_ms, end_ms) = match plan.kind {
        MaterialMediaKind::Image => {
            let actual = frame_time(&stderr)?;
            (actual, actual)
        }
        MaterialMediaKind::Audio | MaterialMediaKind::Video => {
            // Inspect the produced bytes, not the requested duration. Encoding
            // granularity and source EOF can change the actual clip duration.
            let mut probe = Command::new("ffprobe");
            probe
                .args([
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nw=1:nk=1",
                ])
                .arg(&output.path);
            let (duration, _) = run(&mut probe, cancelled).await?;
            let duration = milliseconds(
                std::str::from_utf8(&duration)
                    .map_err(|e| e.to_string())?
                    .trim(),
            )?;
            if duration == 0 {
                return Err("Media provider produced a clip without duration".into());
            }
            let end = plan
                .start_ms
                .checked_add(duration)
                .ok_or("Captured timestamp overflow")?;
            (plan.start_ms, end)
        }
    };
    if *cancelled.borrow() {
        return Err("Media capture cancelled".into());
    }
    let file = CapturedMediaFile {
        path: output
            .path
            .to_str()
            .ok_or("Captured path is not UTF-8")?
            .to_owned(),
        kind: plan.kind,
        name: name.into(),
        segment: MediaSegment {
            source_id: plan.source_id.clone(),
            content_revision: plan.content_revision.clone(),
            start_ms,
            end_ms,
        },
    };
    output.published = true;
    Ok(file)
}

#[cfg(test)]
#[path = "media_capture_ffmpeg_tests.rs"]
mod tests;
