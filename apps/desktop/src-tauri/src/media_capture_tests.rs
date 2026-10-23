use super::*;

#[test]
fn document_selection_has_its_own_cap_and_reuses_capture_release_owner() {
    // Given a document one byte over its own cap but valid for Material.
    let source = tempfile::tempdir().unwrap();
    let selected = source.path().join("book.epub");
    let file = std::fs::File::create(&selected).unwrap();
    let limit = 8 * 1024 * 1024;
    file.set_len(limit + 1).unwrap();
    let owner = Captures::new();
    owner.reserve("document".into()).unwrap();
    let cancelled = owner.cancellation("document").unwrap();
    let mut guard = CaptureGuard {
        owner: &owner,
        id: "document",
        directory: owner.root.join("document"),
        published: false,
    };
    // When document admission runs through the real staging owner.
    assert!(guard.stage_file(&selected, limit, &cancelled).is_err());
    drop(guard);
    // Then failed staging releases admission and leaves no partial or output lease.
    assert!(owner.outputs.lock().unwrap().is_empty());
    assert!(!owner.root.join("document").exists());

    owner.reserve("material".into()).unwrap();
    let cancelled = owner.cancellation("material").unwrap();
    let mut material = CaptureGuard {
        owner: &owner,
        id: "material",
        directory: owner.root.join("material"),
        published: false,
    };
    let output = material
        .stage_selection(&selected, MaterialMediaKind::Image, &cancelled)
        .unwrap();
    drop(material);
    owner.release(output["path"].as_str().unwrap()).unwrap();
    file.set_len(limit).unwrap();
    owner.reserve("exact-document".into()).unwrap();
    let cancelled = owner.cancellation("exact-document").unwrap();
    let mut exact = CaptureGuard {
        owner: &owner,
        id: "exact-document",
        directory: owner.root.join("exact-document"),
        published: false,
    };
    let output = exact.stage_file(&selected, limit, &cancelled).unwrap();
    assert_eq!(output.file_name().unwrap(), "book.epub");
    assert_eq!(std::fs::metadata(&output).unwrap().len(), limit);
    drop(exact);
    owner.release(output.to_str().unwrap()).unwrap();
    assert!(!output.parent().unwrap().exists());
    assert!(owner.outputs.lock().unwrap().is_empty());
}

#[test]
fn oversized_selection_is_rejected_before_staging_and_next_selection_succeeds() {
    // Given a real sparse selection beyond the per-file admission bound.
    let source = tempfile::tempdir().unwrap();
    let oversized = source.path().join("oversized.mp4");
    std::fs::File::create(&oversized)
        .unwrap()
        .set_len(128 * 1024 * 1024 + 1)
        .unwrap();
    let owner = Captures::new();
    owner.reserve("oversized".into()).unwrap();
    let cancelled = owner.cancellation("oversized").unwrap();
    let directory = owner.root.join("oversized");
    let mut guard = CaptureGuard {
        owner: &owner,
        id: "oversized",
        directory: directory.clone(),
        published: false,
    };

    // When the picker stages that selection.
    let result = guard.stage_selection(&oversized, MaterialMediaKind::Video, &cancelled);

    // Then it fails before creating temporary storage or publishing a lease.
    assert!(
        result.is_err(),
        "oversized selection was published: {result:?}"
    );
    assert!(!directory.exists(), "oversized bytes reached host staging");
    assert!(owner.outputs.lock().unwrap().is_empty());
    drop(guard);
    assert!(owner.active.lock().unwrap().is_none());

    // A subsequent ordinary selection retains the real lease/release semantics.
    let normal = source.path().join("normal.wav");
    std::fs::write(&normal, b"ordinary selected media").unwrap();
    owner.reserve("normal".into()).unwrap();
    let cancelled = owner.cancellation("normal").unwrap();
    let mut guard = CaptureGuard {
        owner: &owner,
        id: "normal",
        directory: owner.root.join("normal"),
        published: false,
    };
    let selected = guard
        .stage_selection(&normal, MaterialMediaKind::Audio, &cancelled)
        .unwrap();
    let output = selected["path"].as_str().unwrap();
    assert_eq!(std::fs::read(output).unwrap(), b"ordinary selected media");
    drop(guard);
    assert!(owner.active.lock().unwrap().is_none());
    assert!(owner.outputs.lock().unwrap().contains(Path::new(output)));
    owner.release(output).unwrap();
    assert!(!Path::new(output).exists());
    assert!(owner.outputs.lock().unwrap().is_empty());
}

#[test]
fn growing_selection_stops_at_limit_and_removes_partial_on_failure() {
    // Given an admitted real file which grows after its metadata was read.
    let source = tempfile::tempfile().unwrap();
    source.set_len(1).unwrap();
    assert_eq!(source.metadata().unwrap().len(), 1);
    source.set_len(SELECTION_BYTES + 1).unwrap();
    let owner = Captures::new();
    owner.reserve("growing".into()).unwrap();
    let cancelled = owner.cancellation("growing").unwrap();
    let directory = owner.root.join("growing");
    let guard = CaptureGuard {
        owner: &owner,
        id: "growing",
        directory: directory.clone(),
        published: false,
    };
    std::fs::create_dir_all(&directory).unwrap();
    let output = directory.join("partial");
    let mut destination = std::fs::File::create(&output).unwrap();

    // When the same staging copier encounters bytes beyond admission.
    let result = copy_selection(&mut &source, &mut destination, &cancelled);

    // Then it never writes beyond the ceiling or publishes a failed lease.
    assert!(result.unwrap_err().contains("128 MiB"));
    assert_eq!(destination.metadata().unwrap().len(), SELECTION_BYTES);
    drop(destination);
    drop(guard);
    assert!(!directory.exists());
    assert!(owner.outputs.lock().unwrap().is_empty());
    owner.reserve("next".into()).unwrap();
}

#[test]
fn cancellation_during_copy_removes_partial_and_releases_job() {
    struct CancellingReader {
        cancel: watch::Sender<bool>,
        reads: usize,
    }
    impl Read for CancellingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads += 1;
            if self.reads == 2 {
                self.cancel.send_replace(true);
            }
            buffer[0] = b'x';
            Ok(1)
        }
    }

    // Given a real partial output and cancellation signalled by the next read.
    let owner = Captures::new();
    owner.reserve("cancel".into()).unwrap();
    let cancelled = owner.cancellation("cancel").unwrap();
    let mut input = CancellingReader {
        cancel: owner
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .cancel
            .clone(),
        reads: 0,
    };
    let directory = owner.root.join("cancel");
    let guard = CaptureGuard {
        owner: &owner,
        id: "cancel",
        directory: directory.clone(),
        published: false,
    };
    std::fs::create_dir_all(&directory).unwrap();
    let mut output = std::fs::File::create(directory.join("partial")).unwrap();

    // When cancellation arrives inside the blocking copy.
    let result = copy_selection(&mut input, &mut output, &cancelled);

    // Then no later bytes or lease survive and the owner can admit another job.
    assert!(result.unwrap_err().contains("cancelled"));
    assert_eq!(output.metadata().unwrap().len(), 1);
    drop(output);
    drop(guard);
    assert!(!directory.exists());
    assert!(owner.outputs.lock().unwrap().is_empty());
    owner.reserve("next".into()).unwrap();
}
