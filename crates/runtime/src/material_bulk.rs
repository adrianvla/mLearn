//! Management work reuses the host's blocking worker, guest admission and
//! Material transaction owners. Status/cancel calls never wait behind its guest.
use crate::{
    guest_gate::GuestGate,
    Runtime,
    execution::{Cancellation, Failure},
    guest::{GuestOutput, LanguageAction, Prepared},
};
use mlearn_core::*;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

#[derive(Default)]
pub(super) struct MaterialBulkOwner {
    current: Mutex<Option<Arc<Entry>>>,
    #[cfg(test)]
    observation: Mutex<Option<TestObservation>>,
}

struct Entry {
    command_id: String,
    cancellation: Arc<AtomicU64>,
    active: AtomicBool,
}

#[cfg(test)]
struct TestObservation {
    committed: std::sync::mpsc::SyncSender<u32>,
    resume: std::sync::mpsc::Receiver<()>,
}

struct Transfer<'a> {
    runtime: &'a Mutex<Runtime>,
    guest: &'a GuestGate,
    entry: Arc<Entry>,
    command: MaterialBulkStart,
    finished: bool,
    #[cfg(test)]
    observation: Option<TestObservation>,
}

fn poisoned() -> Failure {
    Failure::Operation("Bulk management lock poisoned".into())
}

fn storage(error: mlearn_storage::StorageError) -> Failure {
    match error {
        mlearn_storage::StorageError::Conflict => Failure::Protocol(
            "conflict",
            "Selected Material changed or the operation stopped; reselect before retrying".into(),
        ),
        error => Failure::Operation(error.to_string()),
    }
}

fn message(error: &Failure) -> String {
    let mut message = error.to_string();
    let mut end = message.len().min(2048);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message.truncate(end);
    message
}

impl MaterialBulkOwner {
    #[cfg(test)]
    pub(super) fn observe(
        &self,
    ) -> (
        std::sync::mpsc::Receiver<u32>,
        std::sync::mpsc::SyncSender<()>,
    ) {
        let (committed, ready) = std::sync::mpsc::sync_channel(1);
        let (release, resume) = std::sync::mpsc::sync_channel(1);
        *self.observation.lock().unwrap() = Some(TestObservation { committed, resume });
        (ready, release)
    }

    pub(super) fn execute(
        &self,
        runtime: &Mutex<Runtime>,
        guest: &GuestGate,
        command: MaterialBulkCommand,
    ) -> Result<Response, Failure> {
        match command {
            command @ (MaterialBulkCommand::Start { .. } | MaterialBulkCommand::Retry { .. }) => {
                return self.apply(runtime, guest, command);
            }
            MaterialBulkCommand::Cancel { command_id } => {
                let entry = self.current.lock().map_err(|_| poisoned())?.clone();
                if let Some(entry) = entry
                    && entry.command_id == command_id
                {
                    entry.cancellation.store(1, Ordering::Relaxed);
                }
                let status = runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .cancel_material_bulk(&command_id)
                    .map_err(storage)?;
                Ok(Response::MaterialBulkStatus { status })
            }
            MaterialBulkCommand::Status { command_id } => {
                let status = runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .material_bulk_status(&command_id)
                    .map_err(storage)?;
                Ok(Response::MaterialBulkStatus { status })
            }
            MaterialBulkCommand::Jobs => {
                let jobs = runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .material_bulk_jobs()
                    .map_err(storage)?;
                Ok(Response::MaterialBulkJobs { jobs })
            }
            MaterialBulkCommand::Results { command_id, after } => {
                let page = runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .material_bulk_page(&command_id, after.as_deref())
                    .map_err(storage)?;
                Ok(Response::MaterialBulkPage { command_id, page })
            }
            MaterialBulkCommand::Release { command_id } => {
                let current = self.current.lock().map_err(|_| poisoned())?;
                if current.as_ref().is_some_and(|entry| {
                    entry.command_id == command_id && entry.active.load(Ordering::Relaxed)
                }) {
                    return Err(Failure::Busy);
                }
                runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .release_material_bulk(&command_id)
                    .map_err(storage)?;
                Ok(Response::MaterialBulkReleased { command_id })
            }
        }
    }

    fn apply(
        &self,
        runtime: &Mutex<Runtime>,
        guest: &GuestGate,
        command: MaterialBulkCommand,
    ) -> Result<Response, Failure> {
        let command_id = match &command {
            MaterialBulkCommand::Start { command } => &command.command_id,
            MaterialBulkCommand::Retry { command_id } => command_id,
            _ => {
                return Err(Failure::Operation(
                    "Expected a bulk admission action".into(),
                ));
            }
        };
        let mut current = self.current.lock().map_err(|_| poisoned())?;
        if let Some(active) = current
            .as_ref()
            .filter(|entry| entry.active.load(Ordering::Relaxed))
            && (active.command_id != *command_id
                || matches!(command, MaterialBulkCommand::Retry { .. }))
        {
            return Err(Failure::Busy);
        }
        let (status, admitted) = {
            let mut runtime = runtime.lock().map_err(|_| poisoned())?;
            match command {
                MaterialBulkCommand::Start { command } => runtime
                    .store
                    .begin_material_bulk(&command)
                    .map_err(storage)?,
                MaterialBulkCommand::Retry { command_id } => {
                    let status = runtime
                        .store
                        .retry_material_bulk(&command_id)
                        .map_err(storage)?;
                    let admitted = status.phase == MaterialBulkPhase::Running;
                    (status, admitted)
                }
                _ => {
                    return Err(Failure::Operation(
                        "Expected a bulk admission action".into(),
                    ));
                }
            }
        };
        if !admitted {
            return Ok(Response::MaterialBulkStatus { status });
        }
        let entry = Arc::new(Entry {
            command_id: status.command.command_id.clone(),
            cancellation: Arc::new(AtomicU64::new(0)),
            active: AtomicBool::new(true),
        });
        *current = Some(entry.clone());
        let mut transfer = Transfer {
            runtime,
            guest,
            entry,
            command: status.command,
            finished: false,
            #[cfg(test)]
            observation: self.observation.lock().map_err(|_| poisoned())?.take(),
        };
        drop(current);
        let result = transfer.run();
        let cancelled = matches!(result, Err(Failure::Cancelled));
        let error = result.err().map(|error| message(&error));
        let completion = {
            let mut runtime = runtime.lock().map_err(|_| poisoned())?;
            if cancelled {
                runtime
                    .store
                    .cancel_material_bulk(&transfer.command.command_id)
            } else {
                runtime
                    .store
                    .finish_material_bulk(&transfer.command.command_id, error.as_deref())
            }
        };
        let status = completion.map_err(storage)?;
        transfer.finished = true;
        Ok(Response::MaterialBulkStatus { status })
    }
}

impl Transfer<'_> {
    fn cancellation(&self) -> Cancellation {
        Cancellation::source(self.entry.cancellation.clone(), 0)
    }

    fn current_package(
        runtime: &Runtime,
        selected: &CollectionSelectionEntry,
    ) -> Result<(), Failure> {
        let package = runtime
            .installed
            .get(&selected.package_id)
            .ok_or_else(|| Failure::Operation("Selected language package is unavailable".into()))?;
        if selected.package_revision.as_deref() != Some(package.revision()?.as_str()) {
            return Err(Failure::Operation(
                "Language package changed; select its current targets again".into(),
            ));
        }
        Ok(())
    }

    fn content(
        &self,
        selected: &CollectionSelectionEntry,
    ) -> Result<Option<MaterialContent>, Failure> {
        if !matches!(self.command.action, MaterialBulkAction::Add { .. }) {
            return Ok(None);
        }
        let CollectionItemId::Target { target_id } = &selected.item else {
            return Err(Failure::Operation(
                "Bulk add requires a selected target".into(),
            ));
        };
        let prepared = {
            let runtime = self.runtime.lock().map_err(|_| poisoned())?;
            self.cancellation().check()?;
            Self::current_package(&runtime, selected)?;
            runtime.language_work(
                &selected.package_id,
                LanguageAction::Inspect {
                    target_id: target_id.clone(),
                },
                self.cancellation(),
            )?
        };
        let Prepared::Work(work) = prepared else {
            return Err(Failure::Operation(
                "Expected package-owned dictionary work".into(),
            ));
        };
        let output = {
            let _admission = self.guest.lock().map_err(|_| poisoned())?;
            self.cancellation().check()?;
            work.run()?
        };
        self.cancellation().check()?;
        let GuestOutput::Entry(entry) = output else {
            return Err(Failure::Operation(
                "Expected a package-produced dictionary entry".into(),
            ));
        };
        if &entry.target_id != target_id {
            return Err(Failure::Operation(
                "Package returned a different target".into(),
            ));
        }
        // This is a default dictionary-sense snapshot, not generated content or
        // fabricated source provenance. Ambiguous existing Material stays explicit.
        let sense = entry
            .senses
            .as_ref()
            .and_then(|senses| senses.first())
            .cloned();
        let meaning = match &sense {
            Some(sense) => sense.definitions.join("\n"),
            None => entry.definition,
        };
        Ok(Some(MaterialContent {
            package_id: selected.package_id.clone(),
            target_id: Some(target_id.clone()),
            package_revision: selected.package_revision.clone(),
            sense,
            phrase: entry.headword,
            reading: entry.reading.unwrap_or_default(),
            meaning,
            context: String::new(),
            notes: String::new(),
            examples: vec![],
            source: None,
            attachments: vec![],
        }))
    }

    fn item(&self, selected: &CollectionSelectionEntry) -> Result<(), Failure> {
        let content = self.content(selected);
        let mut runtime = self.runtime.lock().map_err(|_| poisoned())?;
        self.cancellation().check()?;
        let item_id = match &selected.item {
            CollectionItemId::Target { target_id } => target_id,
            CollectionItemId::Material { id } => &id.0,
        };
        let outcome = content.and_then(|content| {
            if content.is_some() {
                Self::current_package(&runtime, selected)?;
            }
            runtime
                .store
                .apply_material_bulk_item(&self.command.command_id, item_id, content.as_ref())
                .map_err(storage)
        });
        match outcome {
            Ok(_) => Ok(()),
            Err(Failure::Cancelled) => Err(Failure::Cancelled),
            Err(error) => {
                runtime
                    .store
                    .fail_material_bulk_item(&self.command.command_id, item_id, &message(&error))
                    .map_err(storage)?;
                Ok(())
            }
        }
    }

    fn run(&mut self) -> Result<(), Failure> {
        loop {
            self.cancellation().check()?;
            let selected = self
                .runtime
                .lock()
                .map_err(|_| poisoned())?
                .store
                .next_material_bulk_item(&self.command.command_id)
                .map_err(storage)?;
            let Some(selected) = selected else {
                return Ok(());
            };
            self.item(&selected)?;
            #[cfg(test)]
            if let Some(observation) = self.observation.take() {
                let processed = self
                    .runtime
                    .lock()
                    .map_err(|_| poisoned())?
                    .store
                    .material_bulk_status(&self.command.command_id)
                    .map_err(storage)?
                    .processed;
                observation
                    .committed
                    .send(processed)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                observation
                    .resume
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .map_err(|error| Failure::Operation(error.to_string()))?;
            }
        }
    }
}

impl Drop for Transfer<'_> {
    fn drop(&mut self) {
        if !self.finished {
            match self.runtime.lock() {
                Ok(mut runtime) => {
                    if let Err(error) = runtime.store.finish_material_bulk(
                        &self.command.command_id,
                        Some("Bulk work interrupted"),
                    ) {
                        eprintln!("Bulk interruption checkpoint: {error}");
                    }
                }
                Err(error) => eprintln!("Bulk interruption checkpoint: {error}"),
            }
        }
        self.entry.active.store(false, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RuntimeExecutor;
    use mlearn_language_host::CodePolicy;
    use std::{path::Path, time::Duration};

    fn open(profile: &Path) -> RuntimeExecutor {
        RuntimeExecutor::new(
            Runtime::open(profile, CodePolicy::MobileBundled, None, vec![]).unwrap(),
        )
    }

    fn request(executor: &RuntimeExecutor, request: Request) -> Response {
        serde_json::from_str(&executor.execute(&serde_json::to_string(&request).unwrap())).unwrap()
    }

    fn call(executor: &RuntimeExecutor, command: MaterialBulkCommand) -> Response {
        request(executor, Request::MaterialBulk { command })
    }

    fn status(response: Response) -> MaterialBulkStatus {
        match response {
            Response::MaterialBulkStatus { status } => status,
            other => panic!("Expected a native bulk receipt: {other:?}"),
        }
    }

    fn seed(executor: &RuntimeExecutor, count: u32) -> (Vec<Material>, CollectionSelection) {
        let mut materials = vec![];
        for index in 0..count {
            let response = request(
                executor,
                Request::CreateMaterial {
                    command: MaterialCreate {
                        command_id: format!("item-{index}"),
                        distinct: false,
                        media_imports: vec![],
                        content: MaterialContent {
                            package_id: "example.language".into(),
                            target_id: None,
                            package_revision: None,
                            sense: None,
                            phrase: format!("word {index}"),
                            reading: String::new(),
                            meaning: "meaning".into(),
                            context: String::new(),
                            notes: String::new(),
                            examples: vec![],
                            source: None,
                            attachments: vec![],
                        },
                    },
                },
            );
            match response {
                Response::MaterialWritten {
                    outcome: MaterialWriteResult::Saved { material, .. },
                } => materials.push(*material),
                other => panic!("Expected authored Material: {other:?}"),
            }
        }
        let response = request(
            executor,
            Request::CreateCollectionSelection {
                command: CollectionSelectionCreate {
                    command_id: "select-authored".into(),
                    source: CollectionSelectionSource::Matching {
                        query: CollectionQuery {
                            package_id: None,
                            surface: CollectionSurface::Material,
                            filter: CollectionFilter::All { filters: vec![] },
                            sort: CollectionSort::Default,
                            after: None,
                        },
                    },
                },
            },
        );
        let Response::CollectionSelection { selection } = response else {
            panic!("Expected a frozen selection: {response:?}");
        };
        (materials, selection)
    }

    #[test]
    fn cancellation_acknowledgement_fences_publication_and_reopen_retry_skips_successes() {
        // Given a real native worker observed immediately after its first commit.
        let directory = tempfile::tempdir().unwrap();
        let profile = directory.path().join("profile");
        let executor = open(&profile);
        let (materials, selection) = seed(&executor, 3);
        let command = MaterialBulkStart {
            command_id: "exclude-selected".into(),
            selection_id: selection.id,
            action: MaterialBulkAction::Exclude { excluded: true },
        };
        std::thread::scope(|scope| {
            let (committed, release) = executor.observe_material_bulk();
            let worker = scope.spawn(|| {
                call(
                    &executor,
                    MaterialBulkCommand::Start {
                        command: command.clone(),
                    },
                )
            });
            assert_eq!(committed.recv_timeout(Duration::from_secs(10)).unwrap(), 1);
            let progress = status(call(
                &executor,
                MaterialBulkCommand::Status {
                    command_id: command.command_id.clone(),
                },
            ));
            assert_eq!(progress.phase, MaterialBulkPhase::Running);
            assert_eq!(progress.processed, 1);
            let mut collision = command.clone();
            collision.action = MaterialBulkAction::Remove;
            assert!(matches!(
                call(&executor, MaterialBulkCommand::Start { command: collision }),
                Response::Error { .. }
            ));

            // When cancel is acknowledged before the worker can prepare another item.
            let cancelled = status(call(
                &executor,
                MaterialBulkCommand::Cancel {
                    command_id: command.command_id.clone(),
                },
            ));
            assert_eq!(cancelled.phase, MaterialBulkPhase::Cancelled);
            assert!(matches!(
                call(
                    &executor,
                    MaterialBulkCommand::Release {
                        command_id: command.command_id.clone()
                    }
                ),
                Response::Error { .. }
            ));
            release.send(()).unwrap();
            let finished = status(worker.join().unwrap());

            // Then no later item publishes and the committed success remains durable.
            assert_eq!(finished.phase, MaterialBulkPhase::Cancelled);
            assert_eq!((finished.processed, finished.succeeded), (1, 1));
        });
        drop(executor);
        let executor = open(&profile);
        let receipt = status(call(
            &executor,
            MaterialBulkCommand::Start {
                command: command.clone(),
            },
        ));
        assert_eq!(
            (receipt.phase, receipt.processed),
            (MaterialBulkPhase::Cancelled, 1)
        );
        let completed = status(call(
            &executor,
            MaterialBulkCommand::Retry {
                command_id: command.command_id.clone(),
            },
        ));
        assert_eq!(completed.phase, MaterialBulkPhase::Completed);
        assert_eq!(
            (completed.processed, completed.succeeded, completed.failed),
            (3, 3, 0)
        );
        for material in materials {
            match request(&executor, Request::Material { id: material.id }) {
                Response::Material { material } => {
                    assert_eq!(material.revision, 2);
                    assert!(material.excluded);
                }
                other => panic!("Expected retained Material: {other:?}"),
            }
        }
        let replay = status(call(&executor, MaterialBulkCommand::Start { command }));
        assert_eq!(replay, completed);
    }

    #[test]
    fn restart_marks_abandoned_bulk_work_interrupted_without_automatic_mutation() {
        // Given the durable state of a worker abandoned after one atomic commit.
        let directory = tempfile::tempdir().unwrap();
        let profile = directory.path().join("profile");
        let executor = open(&profile);
        let (_, selection) = seed(&executor, 2);
        let command = MaterialBulkStart {
            command_id: "interrupted-notes".into(),
            selection_id: selection.id,
            action: MaterialBulkAction::Edit {
                patch: MaterialBulkPatch {
                    notes: Some("native bulk notes".into()),
                    ..Default::default()
                },
            },
        };
        {
            let mut runtime = executor.runtime.lock().unwrap();
            runtime.store.begin_material_bulk(&command).unwrap();
            let next = runtime
                .store
                .next_material_bulk_item(&command.command_id)
                .unwrap()
                .unwrap();
            let CollectionItemId::Material { id } = next.item else {
                panic!("Expected Material");
            };
            runtime
                .store
                .apply_material_bulk_item(&command.command_id, &id.0, None)
                .unwrap();
        }
        drop(executor);

        // When the actual Runtime opens the profile again.
        let executor = open(&profile);
        let interrupted = status(call(
            &executor,
            MaterialBulkCommand::Status {
                command_id: command.command_id.clone(),
            },
        ));

        // Then nothing resumes until Retry; that command preserves the first receipt.
        assert_eq!(interrupted.phase, MaterialBulkPhase::Interrupted);
        assert_eq!((interrupted.processed, interrupted.succeeded), (1, 1));
        let Response::MaterialBulkJobs { jobs } = call(&executor, MaterialBulkCommand::Jobs) else {
            panic!("Expected bounded recovery jobs");
        };
        assert_eq!(jobs, vec![interrupted]);
        let completed = status(call(
            &executor,
            MaterialBulkCommand::Retry {
                command_id: command.command_id.clone(),
            },
        ));
        assert_eq!(completed.phase, MaterialBulkPhase::Completed);
        assert_eq!((completed.processed, completed.succeeded), (2, 2));
        let Response::MaterialBulkPage { page, .. } = call(
            &executor,
            MaterialBulkCommand::Results {
                command_id: command.command_id.clone(),
                after: None,
            },
        ) else {
            panic!("Expected bounded results");
        };
        assert_eq!(page.items.len(), 2);
        assert!(page.items.iter().all(|item| matches!(
            item.outcome,
            Some(MaterialBulkOutcome::Saved {
                committed_revision: 2,
                ..
            })
        )));
        let released = call(
            &executor,
            MaterialBulkCommand::Release {
                command_id: command.command_id.clone(),
            },
        );
        assert!(
            matches!(released, Response::MaterialBulkReleased { command_id } if command_id == command.command_id)
        );
        assert!(matches!(
            call(
                &executor,
                MaterialBulkCommand::Retry {
                    command_id: command.command_id
                }
            ),
            Response::Error { .. }
        ));
    }
}
