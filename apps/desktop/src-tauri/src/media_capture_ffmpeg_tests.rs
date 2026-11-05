use super::*;
use std::io::{Read, Write};

fn plan(kind: MaterialMediaKind) -> MediaCapturePlan {
    MediaCapturePlan {
        source_id: "source".into(),
        content_revision: "revision".into(),
        path: "/not-used".into(),
        kind,
        start_ms: 1250,
        end_ms: 1750,
    }
}

#[test]
fn command_preserves_canonical_range_and_literal_paths() {
    // Given paths that must never become shell syntax.
    let input = Path::new("/media/hello ' ; $(touch nope).mp4");
    let output = Path::new("/private/capture.mp4");
    for kind in [
        MaterialMediaKind::Image,
        MaterialMediaKind::Audio,
        MaterialMediaKind::Video,
    ] {
        let plan = plan(kind);
        // When building the direct process invocation.
        let command = command(&plan, input, output);
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        // Then inputs stay a single argument and range/streams match the plan.
        assert_eq!(command.as_std().get_program(), "ffmpeg");
        assert!(
            args.windows(2)
                .any(|pair| pair == ["-i", input.to_str().unwrap()])
        );
        assert!(args.windows(2).any(|pair| pair == ["-ss", "1.250"]));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["-protocol_whitelist", "file"])
        );
        match kind {
            MaterialMediaKind::Image => {
                assert!(args.windows(2).any(|pair| pair == ["-frames:v", "1"]));
                assert!(args.contains(&"-copyts"));
            }
            MaterialMediaKind::Audio => {
                assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:0"]));
                assert!(args.windows(2).any(|pair| pair == ["-t", "0.500"]));
            }
            MaterialMediaKind::Video => {
                assert!(args.windows(2).any(|pair| pair == ["-map", "0:v:0"]));
                assert!(args.windows(2).any(|pair| pair == ["-t", "0.500"]));
                assert!(!args.contains(&"copy"));
            }
        }
    }
}

#[test]
fn frame_timestamp_uses_decoded_pts_and_rejects_invalid_output() {
    // Given a non-keyframe request whose next decoded frame is at 1.3 s.
    let stderr = b"[Parsed_showinfo_0 @ 0x1] n: 0 pts: 13312 pts_time:1.3 duration:1024\n";
    // When reading provider timing, then use the decoded timestamp.
    assert_eq!(frame_time(stderr).unwrap(), 1300);
    for value in ["NaN", "inf", "-1", "4294967.296", "N/A"] {
        assert!(milliseconds(value).is_err(), "{value}");
    }
    assert!(frame_time(b"no frames decoded").is_err());
}

#[test]
fn partial_output_is_removed_when_not_published() {
    // Given an interrupted file.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("partial.mp4");
    std::fs::write(&path, b"partial").unwrap();
    // When extraction unwinds.
    drop(PartialOutput {
        path: path.clone(),
        published: false,
    });
    // Then no partial file survives.
    assert!(!path.exists());
}

// Use this same test executable as a process fixture, without a shell or timing
// guesses. The socket connection is the exact "child is running" signal.
#[test]
fn fixture_process() {
    let Ok(mode) = std::env::var("MLEARN_FFMPEG_TEST_MODE") else {
        return;
    };
    match mode.as_str() {
        "block" => {
            let mut stream =
                std::net::TcpStream::connect(std::env::var("MLEARN_FFMPEG_TEST_ADDRESS").unwrap())
                    .unwrap();
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
        }
        "stdout" => {
            std::io::stdout()
                .write_all(&vec![b'x'; usize::try_from(STDOUT_BYTES + 1).unwrap()])
                .unwrap();
        }
        "stderr" => {
            std::io::stderr()
                .write_all(&vec![b'x'; usize::try_from(STDERR_BYTES + 1).unwrap()])
                .unwrap();
        }
        _ => panic!("Unknown process fixture"),
    }
}

fn fixture(mode: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["fixture_process", "--nocapture"]);
    command.env("MLEARN_FFMPEG_TEST_MODE", mode);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

#[tokio::test]
async fn cancellation_terminates_and_reaps_running_provider() {
    // Given a child whose readiness is acknowledged by a socket.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut command = fixture("block");
    command.env(
        "MLEARN_FFMPEG_TEST_ADDRESS",
        listener.local_addr().unwrap().to_string(),
    );
    let mut child = command.spawn().unwrap();
    let (_connection, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let (cancel, mut cancelled) = watch::channel(false);
    // When cancellation arrives after the process is running.
    cancel.send_replace(true);
    let result = tokio::time::timeout(Duration::from_secs(5), wait(&mut child, &mut cancelled))
        .await
        .unwrap();
    // Then completion includes the reap, not just a termination request.
    assert!(result.unwrap_err().contains("cancelled"));
    assert!(child.try_wait().unwrap().is_some());
    assert!(child.id().is_none());
}

#[tokio::test]
async fn excessive_diagnostics_fail_without_pipe_deadlock() {
    for mode in ["stdout", "stderr"] {
        // Given a real child writing beyond each pipe's bound.
        let mut child = fixture(mode).spawn().unwrap();
        let (_cancel, mut cancelled) = watch::channel(false);
        // When collecting the bounded diagnostics concurrently with exit.
        let result = tokio::time::timeout(Duration::from_secs(5), wait(&mut child, &mut cancelled))
            .await
            .unwrap();
        // Then the job fails and its writer is reaped.
        assert!(result.unwrap_err().contains("output limit"));
        assert!(child.try_wait().unwrap().is_some());
    }
}

#[tokio::test]
async fn missing_provider_reports_unavailable() {
    // Given a nonexistent executable, without modifying the shared PATH.
    let directory = tempfile::tempdir().unwrap();
    let mut command = Command::new(directory.path().join("missing-ffmpeg"));
    let (_cancel, mut cancelled) = watch::channel(false);
    // When launching it, then fail explicitly instead of claiming readiness.
    assert!(
        run(&mut command, &mut cancelled)
            .await
            .unwrap_err()
            .contains("unavailable")
    );
}

#[tokio::test]
#[ignore = "Requires local ffmpeg (libx264, AAC, PNG) and ffprobe on PATH"]
async fn installed_ffmpeg_extracts_actual_frame_audio_and_video() {
    // Given a long-GOP source and a capture away from a keyframe.
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source ' ;.mp4");
    let (_cancel, mut cancelled) = watch::channel(false);
    let mut generate = Command::new("ffmpeg");
    generate
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=32x32:rate=10:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:v",
            "libx264",
            "-g",
            "100",
            "-c:a",
            "aac",
            "-threads",
            "2",
        ])
        .arg(&source);
    run(&mut generate, &mut cancelled).await.unwrap();
    for kind in [
        MaterialMediaKind::Image,
        MaterialMediaKind::Audio,
        MaterialMediaKind::Video,
    ] {
        let mut plan = plan(kind);
        plan.path = source.to_str().unwrap().into();
        let output = tempfile::tempdir().unwrap();
        // When extracting the canonical selection through the real provider.
        let file = extract(&plan, output.path(), &mut cancelled).await.unwrap();
        // Then bytes, source continuity, and actual timing describe the capture.
        assert!(std::fs::metadata(&file.path).unwrap().len() > 0);
        assert_eq!(file.segment.source_id, plan.source_id);
        assert_eq!(file.segment.content_revision, plan.content_revision);
        assert_eq!(file.kind, kind);
        match kind {
            MaterialMediaKind::Image => {
                assert_eq!(file.segment.start_ms, 1300);
                assert_eq!(file.segment.end_ms, 1300);
                assert!(
                    std::fs::read(&file.path)
                        .unwrap()
                        .starts_with(b"\x89PNG\r\n\x1a\n")
                );
            }
            MaterialMediaKind::Audio | MaterialMediaKind::Video => {
                assert_eq!(file.segment.start_ms, 1250);
                assert!((file.segment.end_ms - file.segment.start_ms).abs_diff(500) <= 100);
            }
        }
    }
}
