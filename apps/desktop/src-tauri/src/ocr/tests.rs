use super::*;
use tokio::io::BufReader;

#[test]
fn cancellation_holds_running_admission_until_guard_releases() {
    // Given an admitted running action.
    let owner = Arc::new(OcrJobs::new());
    owner.reserve("running".into()).unwrap();
    let (guard, receiver) = owner.start("running").unwrap();
    // When cancellation arrives before publication.
    owner.cancel("running").unwrap();
    // Then it cannot publish or release its slot before child cleanup.
    assert!(*receiver.borrow());
    assert!(owner.publish("running", || Ok("stale".into())).is_err());
    assert!(owner.reserve("next".into()).is_err());
    drop(guard);
    assert!(owner.reserve("next".into()).is_ok());
}
#[test]
fn reserved_cancellation_and_shutdown_close_admission() {
    let owner = Arc::new(OcrJobs::new());
    owner.reserve("queued".into()).unwrap();
    owner.cancel("queued").unwrap();
    assert!(owner.reserve("next".into()).is_ok());
    owner.begin_shutdown();
    assert!(owner.start("next").is_err());
    assert!(owner.reserve("late".into()).is_err());
}

#[test]
fn shutdown_remains_pending_until_the_running_owner_releases() {
    let owner = Arc::new(OcrJobs::new());
    owner.reserve("shutdown".into()).unwrap();
    let (guard, _receiver) = owner.start("shutdown").unwrap();
    owner.begin_shutdown();
    assert!(!owner.shutdown_finished());
    drop(guard);
    assert!(owner.shutdown_finished());
}
#[tokio::test]
async fn framed_output_rejects_overflow_without_waiting_for_newline() {
    let data = vec![b'x'; 192 * 1024 + 1];
    let mut reader = BufReader::new(data.as_slice());
    assert!(frame(&mut reader).await.unwrap_err().contains("192 KiB"));
}
#[tokio::test]
#[cfg(unix)]
async fn bounded_pipes_drain_large_simultaneous_outputs() {
    // Given stdout and stderr both larger than a pipe's capacity.
    let mut child=tokio::process::Command::new("/bin/sh")
        .args(["-c","dd if=/dev/zero bs=1024 count=128 2>/dev/null & dd if=/dev/zero bs=1024 count=128 1>&2 2>/dev/null; wait"])
        .stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).spawn().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    // When both streams are drained while the process runs.
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::try_join!(bounded(stdout, 128 * 1024), bounded(stderr, 128 * 1024))
    })
    .await
    .unwrap()
    .unwrap();
    // Then both complete without the wait-before-read deadlock.
    assert_eq!(result.0.len(), 128 * 1024);
    assert_eq!(result.1.len(), 128 * 1024);
    assert!(child.wait().await.unwrap().success());
}

#[tokio::test]
#[cfg(unix)]
async fn helper_observes_eof_before_output_is_awaited() {
    let mut command = tokio::process::Command::new("/usr/bin/wc");
    command.arg("-c");
    let (_owner, mut cancelled) = watch::channel(false);
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        run_once(command, vec![b'x'; 1024], 32, &mut cancelled),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(output, json!(1024));
}
