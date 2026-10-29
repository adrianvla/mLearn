use super::*;
use serde_json::{json, Value};
use std::{cell::RefCell, sync::mpsc, thread, time::Duration};

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Point {
    Claimed,
    Immediate,
}
struct Barrier {
    point: Point,
    reached: mpsc::SyncSender<()>,
    resume: mpsc::Receiver<()>,
}
thread_local! {
    static BARRIER: RefCell<Option<Barrier>> = const { RefCell::new(None) };
    static CANCEL: RefCell<Option<mpsc::SyncSender<()>>> = const { RefCell::new(None) };
}
pub(super) fn hold(point: Point) {
    BARRIER.with(|slot| {
        if slot
            .borrow()
            .as_ref()
            .is_some_and(|barrier| barrier.point == point)
        {
            let barrier = slot.take().unwrap();
            barrier.reached.send(()).unwrap();
            barrier
                .resume
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
        }
    });
}
pub(super) fn cancel_signalled() {
    CANCEL.with(|slot| {
        if let Some(sender) = slot.take() {
            sender.send(()).unwrap();
        }
    });
}

fn fixture() -> (tempfile::TempDir, Arc<RuntimeExecutor>) {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Runtime::open(
        directory.path(),
        mlearn_language_host::CodePolicy::MobileBundled,
        None,
        vec![],
    )
    .unwrap();
    (directory, Arc::new(RuntimeExecutor::new(runtime)))
}
fn graph() -> String {
    json!({"type":"graph_neighborhood","query":{
        "packageId":"org.example","targetId":"target:root","expectedRevision":null,"after":null,
    }})
    .to_string()
}
fn evidence() -> String {
    json!({"type":"knowledge_evidence","query":{
        "key":{"packageId":"org.example","targetId":"root","capability":"org.example:meaning"},
        "after":null,
    }})
    .to_string()
}
fn decoded(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap()
}

/// Releases and joins even if an assertion or bounded receive fails.
struct HeldRead {
    reached: mpsc::Receiver<()>,
    release: Option<mpsc::SyncSender<()>>,
    worker: Option<thread::JoinHandle<Value>>,
}
impl HeldRead {
    fn start(executor: Arc<RuntimeExecutor>, id: String, request: String, point: Point) -> Self {
        let (ready, reached) = mpsc::sync_channel(1);
        let (release, resume) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            BARRIER.with(|slot| {
                *slot.borrow_mut() = Some(Barrier {
                    point,
                    reached: ready,
                    resume,
                })
            });
            decoded(&executor.execute_bounded_read(&id, &request))
        });
        Self {
            reached,
            release: Some(release),
            worker: Some(worker),
        }
    }
    fn finish(&mut self) -> Value {
        self.release.take().unwrap().send(()).unwrap();
        self.worker.take().unwrap().join().unwrap()
    }
}
impl Drop for HeldRead {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[test]
fn bounded_read_cancel_waiter_releases_before_unrelated_guest_unlock() {
    // Given real executor admission occupied by unrelated source-scoped work.
    let (_directory, executor) = fixture();
    let source = Cancellation::source(executor.cancellation_handle(), 0);
    let admission = executor.guest.lock().unwrap();
    let ready = executor.guest.observe_waiter();
    let id = executor.begin_bounded_read().unwrap();
    let worker_executor = Arc::clone(&executor);
    let worker_id = id.clone();
    let worker =
        thread::spawn(move || decoded(&worker_executor.execute_bounded_read(&worker_id, &graph())));
    let entered = ready.recv_timeout(Duration::from_secs(10));
    let (finished, receipt) = mpsc::sync_channel(1);
    let cancel_executor = Arc::clone(&executor);
    // When only the queued operation is cancelled, before releasing the guest.
    let cancel = thread::spawn(move || {
        finished
            .send(cancel_executor.cancel_bounded_read(&id))
            .unwrap()
    });
    let before_unlock = receipt.recv_timeout(Duration::from_secs(10));
    let metadata = decoded(&executor.execute(r#"{"type":"knowledge","keys":[]}"#));
    let source_survived = source.check();
    drop(admission); // Failure cleanup must not make the before-unlock assertion pass.
    let result = worker.join().unwrap();
    cancel.join().unwrap();
    // Then cancellation joins cleanup without entering graph preparation.
    entered.unwrap();
    before_unlock.unwrap().unwrap();
    assert_eq!(result["code"], "cancelled"); // Missing package would fail if preparation ran.
    assert_eq!(metadata["type"], "knowledge");
    assert!(source_survived.is_ok());
    assert_eq!(executor.admitted.load(Ordering::Relaxed), 0);
    assert!(executor.begin_bounded_read().is_ok());
}

#[test]
fn bounded_read_cancellation_retains_lease_permit_and_both_control_slots_until_exit() {
    // Given one claimed read stopped before preparation and a second reservation.
    let (_directory, executor) = fixture();
    thread::scope(|scope| {
        let id = executor.begin_bounded_read().unwrap();
        let other = executor.begin_bounded_read().unwrap();
        let mut held = HeldRead::start(Arc::clone(&executor), id.clone(), graph(), Point::Claimed);
        held.reached.recv_timeout(Duration::from_secs(10)).unwrap();
        let permits = [executor.admit().unwrap(), executor.admit().unwrap()];
        let (accepted, signals) = mpsc::sync_channel(2);
        let (finished, receipts) = mpsc::sync_channel(2);
        // When two independent bounded controls cancel the same running lease.
        for _ in 0..2 {
            let accepted = accepted.clone();
            let finished = finished.clone();
            let id = id.clone();
            let executor = &executor;
            scope.spawn(move || {
                CANCEL.with(|slot| *slot.borrow_mut() = Some(accepted));
                finished.send(executor.cancel_bounded_read(&id)).unwrap();
            });
        }
        signals.recv_timeout(Duration::from_secs(10)).unwrap();
        signals.recv_timeout(Duration::from_secs(10)).unwrap();
        // Then neither acknowledgement nor capacity can precede execution cleanup.
        assert!(matches!(
            receipts.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert!(matches!(
            executor.begin_bounded_read(),
            Err(BoundedReadError::Busy)
        ));
        assert!(matches!(
            executor.cancel_bounded_read(&other),
            Err(BoundedReadError::Busy)
        ));
        assert_eq!(
            decoded(&executor.execute(r#"{"type":"snapshot"}"#))["code"],
            "busy"
        );
        assert_eq!(
            decoded(&executor.execute_bounded_read(&id, &graph()))["code"],
            "invalid_bounded_read"
        );
        assert_eq!(held.finish()["code"], "cancelled");
        receipts
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        receipts
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert_eq!(
            decoded(&executor.execute(r#"{"type":"snapshot"}"#))["type"],
            "snapshot"
        );
        drop(permits);
        executor.cancel_bounded_read(&other).unwrap();
        assert!(executor.begin_bounded_read().is_ok());
    });
}

#[test]
fn bounded_read_unclaimed_cancel_and_terminal_failures_never_resurrect_handles() {
    // Given cancelled reservations and each immediate failure path.
    let (_directory, executor) = fixture();
    let id = executor.begin_bounded_read().unwrap();
    executor.cancel_bounded_read(&id).unwrap();
    assert_eq!(
        decoded(&executor.execute_bounded_read(&id, &graph()))["code"],
        "invalid_bounded_read"
    );
    // When an admitted read fails, it must still consume its identity exactly once.
    for (request, expected) in [
        ("not-json".to_owned(), "invalid_request"),
        (r#"{"type":"snapshot"}"#.to_owned(), "invalid_bounded_read"),
        (graph(), "operation_failed"),
        (
            json!({"type":"search_document","query":{
                "sourceId":"missing","contentRevision":"missing","parserRevision":"missing",
                "scope":"text","text":"needle","after":null,
            }})
            .to_string(),
            "invalid_document_search",
        ),
    ] {
        let id = executor.begin_bounded_read().unwrap();
        assert_eq!(
            decoded(&executor.execute_bounded_read(&id, &request))["code"],
            expected
        );
        assert_eq!(
            decoded(&executor.execute_bounded_read(&id, &request))["code"],
            "invalid_bounded_read"
        );
        executor.cancel_bounded_read(&id).unwrap();
    }
    // Then repeated native identities reuse slots, never old handles.
    for _ in 0..20 {
        let replacement = executor.begin_bounded_read().unwrap();
        assert_ne!(replacement, id);
        executor.cancel_bounded_read(&replacement).unwrap();
    }
    let (_sibling_directory, sibling) = fixture();
    let foreign = executor.begin_bounded_read().unwrap();
    assert_eq!(
        decoded(&sibling.execute_bounded_read(&foreign, &graph()))["code"],
        "invalid_bounded_read"
    );
}

#[test]
fn bounded_read_heavy_admission_failure_releases_only_the_claimed_lease() {
    // Given all three heavy permits and both native reservations occupied.
    let (_directory, executor) = fixture();
    let permits = [
        executor.admit().unwrap(),
        executor.admit().unwrap(),
        executor.admit().unwrap(),
    ];
    let id = executor.begin_bounded_read().unwrap();
    let other = executor.begin_bounded_read().unwrap();
    // When execution cannot obtain its normal heavy permit.
    let failed = decoded(&executor.execute_bounded_read(&id, &graph()));
    // Then that identity is retired and its slot is reusable, not its sibling's.
    assert_eq!(failed["code"], "busy");
    let replacement = executor.begin_bounded_read().unwrap();
    assert!(matches!(
        executor.begin_bounded_read(),
        Err(BoundedReadError::Busy)
    ));
    assert_eq!(
        decoded(&executor.execute_bounded_read(&id, &graph()))["code"],
        "invalid_bounded_read"
    );
    executor.cancel_bounded_read(&other).unwrap();
    executor.cancel_bounded_read(&replacement).unwrap();
    drop(permits);
}

#[test]
fn bounded_read_expiry_and_epoch_cleanup_apply_only_to_unclaimed_leases() {
    // Given one claimed lease and one reserved lease at a deterministic instant.
    let reads = BoundedReads::default();
    let source = AtomicU64::new(7);
    let now = Instant::now();
    let active = reads.begin(&source, now).unwrap();
    let claimed = reads.claim(&active, &source, now).unwrap();
    let reserved = reads.begin(&source, now).unwrap();
    assert!(matches!(
        reads.begin(&source, now + Duration::from_secs(29)),
        Err(BoundedReadError::Busy)
    ));
    // When the unclaimed reservation reaches exactly 30 seconds.
    assert!(reads.cancel(&active).unwrap().is_some());
    let replacement = reads.begin(&source, now + Duration::from_secs(30)).unwrap();
    // Then active work remains charged, while the expired identity is unusable.
    assert!(matches!(
        reads.claim(&reserved, &source, now + Duration::from_secs(30)),
        Err(BoundedReadError::InvalidHandle)
    ));
    assert!(matches!(
        reads.begin(&source, now + Duration::from_secs(30)),
        Err(BoundedReadError::Busy)
    ));
    source.store(8, Ordering::Relaxed);
    let new_source = reads.begin(&source, now + Duration::from_secs(30)).unwrap();
    assert!(matches!(
        reads.claim(&replacement, &source, now + Duration::from_secs(30)),
        Err(BoundedReadError::InvalidHandle)
    ));
    assert!(reads.begin(&source, now + Duration::from_secs(60)).is_ok());
    assert!(matches!(
        reads.claim(&active, &source, now + Duration::from_secs(60)),
        Err(BoundedReadError::InvalidHandle)
    ));
    assert!(reads.cancel(&new_source).unwrap().is_none());
    drop(claimed);
}

#[test]
fn bounded_read_source_epoch_change_wakes_a_queued_read() {
    // Given a scoped read already waiting at the real guest gate.
    let (_directory, executor) = fixture();
    let admission = executor.guest.lock().unwrap();
    let waiting = executor.guest.observe_waiter();
    let id = executor.begin_bounded_read().unwrap();
    let (finished, receipt) = mpsc::sync_channel(1);
    let running = Arc::clone(&executor);
    let worker = thread::spawn(move || {
        finished
            .send(decoded(&running.execute_bounded_read(&id, &graph())))
            .unwrap()
    });
    let entered = waiting.recv_timeout(Duration::from_secs(10));
    // When the canonical source owner advances its epoch.
    executor.cancel_source_open();
    let before_unlock = receipt.recv_timeout(Duration::from_secs(10));
    drop(admission);
    worker.join().unwrap();
    // Then the queued read acknowledges without requiring guest capacity.
    entered.unwrap();
    assert_eq!(before_unlock.unwrap()["code"], "cancelled");
}

#[test]
fn bounded_read_immediate_evidence_rejects_cancelled_publication_after_quantum() {
    // Given a real, bounded storage evidence read held after its immediate result.
    let (_directory, executor) = fixture();
    thread::scope(|scope| {
        let id = executor.begin_bounded_read().unwrap();
        let mut held = HeldRead::start(
            Arc::clone(&executor),
            id.clone(),
            evidence(),
            Point::Immediate,
        );
        held.reached.recv_timeout(Duration::from_secs(10)).unwrap();
        let (accepted, signal) = mpsc::sync_channel(1);
        let (finished, receipt) = mpsc::sync_channel(1);
        let executor = &executor;
        // When cancellation races publication, not the already-drained storage quantum.
        scope.spawn(move || {
            CANCEL.with(|slot| *slot.borrow_mut() = Some(accepted));
            finished.send(executor.cancel_bounded_read(&id)).unwrap();
        });
        signal.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(matches!(receipt.try_recv(), Err(mpsc::TryRecvError::Empty)));
        assert_eq!(held.finish()["code"], "cancelled");
        // Then the terminal control receipt follows cleanup and suppresses the page.
        receipt
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
    });
}
