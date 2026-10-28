//! Collection preparation uses the host's existing blocking call and admission.
//! Only one command is active; each page releases guest and Runtime ownership.
use crate::{
    Installed, Runtime,
    execution::{Cancellation, Failure},
};
use mlearn_core::{
    CollectionCatalogPage, CollectionCatalogRequest, CollectionPreparationCommand,
    CollectionPreparationPhase, CollectionPreparationStatus, Response,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

#[derive(Default)]
pub(super) struct CollectionOwner {
    current: Mutex<Option<Arc<Entry>>>,
    #[cfg(test)]
    observation: Mutex<Option<TestObservation>>,
}

#[cfg(test)]
struct TestObservation {
    committed: std::sync::mpsc::SyncSender<u32>,
    resume: std::sync::mpsc::Receiver<()>,
}

struct Entry {
    status: Mutex<CollectionPreparationStatus>,
    epoch: Arc<AtomicU64>,
}

struct Transfer {
    entry: Arc<Entry>,
    #[cfg(test)]
    observation: Mutex<Option<TestObservation>>,
}

fn active(phase: CollectionPreparationPhase) -> bool {
    match phase {
        CollectionPreparationPhase::Preparing | CollectionPreparationPhase::Cancelling => true,
        CollectionPreparationPhase::Succeeded
        | CollectionPreparationPhase::Cancelled
        | CollectionPreparationPhase::Failed => false,
    }
}

fn poisoned() -> Failure {
    Failure::Operation("Collection preparation lock poisoned".into())
}

impl CollectionOwner {
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

    pub(super) fn status(
        &self,
        command_id: Option<&str>,
        cancel: bool,
    ) -> Result<Response, Failure> {
        let entry = self.current.lock().map_err(|_| poisoned())?.clone();
        let status = match entry {
            Some(entry) => {
                let mut status = entry.status.lock().map_err(|_| poisoned())?;
                if command_id.is_some_and(|id| id != status.command.command_id) {
                    None
                } else {
                    if cancel && active(status.phase) {
                        entry.epoch.store(1, Ordering::Relaxed);
                        status.phase = CollectionPreparationPhase::Cancelling;
                    }
                    Some(status.clone())
                }
            }
            None => None,
        };
        Ok(Response::CollectionPreparation { status })
    }

    pub(super) fn prepare(
        &self,
        runtime: &Mutex<Runtime>,
        guest: &Mutex<()>,
        command: CollectionPreparationCommand,
    ) -> Result<Response, Failure> {
        if command.command_id.is_empty()
            || command.command_id.len() > 128
            || command.package_id.is_empty()
            || command.package_id.len() > 128
        {
            return Err(Failure::Operation(
                "Invalid collection preparation identity".into(),
            ));
        }
        let transfer = {
            let mut current = self.current.lock().map_err(|_| poisoned())?;
            if let Some(entry) = current.as_ref() {
                let status = entry.status.lock().map_err(|_| poisoned())?;
                if status.command.command_id == command.command_id {
                    if status.command != command {
                        return Err(Failure::Operation(
                            "Command identity reused for different contents".into(),
                        ));
                    }
                    return Ok(Response::CollectionPreparation {
                        status: Some(status.clone()),
                    });
                }
                if active(status.phase) {
                    return Err(Failure::Busy);
                }
            }
            let entry = Arc::new(Entry {
                status: Mutex::new(CollectionPreparationStatus {
                    command,
                    phase: CollectionPreparationPhase::Preparing,
                    processed: 0,
                    total: None,
                    message: None,
                }),
                epoch: Arc::new(AtomicU64::new(0)),
            });
            *current = Some(entry.clone());
            Transfer {
                entry,
                #[cfg(test)]
                observation: Mutex::new(self.observation.lock().map_err(|_| poisoned())?.take()),
            }
        };
        let result = transfer.run(runtime, guest);
        transfer.finish(result)
    }
}

impl Transfer {
    fn cancellation(&self) -> Cancellation {
        Cancellation::source(self.entry.epoch.clone(), 0)
    }

    fn publish<T>(
        &self,
        runtime: &Mutex<Runtime>,
        package: &Installed,
        revision: &str,
        commit: impl FnOnce(&mut Runtime, &mut CollectionPreparationStatus) -> Result<T, Failure>,
    ) -> Result<T, Failure> {
        // A cancellation acknowledged first cannot publish a later cache page.
        let mut status = self.entry.status.lock().map_err(|_| poisoned())?;
        self.cancellation().check()?;
        let mut runtime = runtime.lock().map_err(|_| poisoned())?;
        let current = runtime
            .installed
            .get(&package.manifest.id)
            .ok_or_else(|| Failure::Operation("Language package is no longer installed".into()))?;
        if current.revision()? != revision {
            return Err(Failure::Operation(
                "Language package changed during collection preparation".into(),
            ));
        }
        commit(&mut runtime, &mut status)
    }

    fn page(
        &self,
        package: &Installed,
        guest: &Mutex<()>,
        after: Option<String>,
    ) -> Result<CollectionCatalogPage, Failure> {
        let _admission = guest.lock().map_err(|_| poisoned())?;
        let cancellation = self.cancellation();
        let request = CollectionCatalogRequest { after, limit: 24 };
        let value = cancellation.invoke(
            package,
            "collection.targets.v1",
            serde_json::to_value(request).map_err(|error| Failure::Operation(error.to_string()))?,
        )?;
        let page: CollectionCatalogPage =
            serde_json::from_value(value).map_err(|error| Failure::Operation(error.to_string()))?;
        if page.items.len() > 24
            || (page.total == 0 && (!page.items.is_empty() || page.next.is_some()))
        {
            return Err(Failure::Operation("Invalid package catalog window".into()));
        }
        for item in &page.items {
            cancellation.check()?;
            crate::linguistic::validate(
                &item.summary.presentation,
                &item.summary.headword,
                &package.manifest.id,
            )?;
        }
        Ok(page)
    }

    fn run(&self, runtime: &Mutex<Runtime>, guest: &Mutex<()>) -> Result<(), Failure> {
        let command = self
            .entry
            .status
            .lock()
            .map_err(|_| poisoned())?
            .command
            .clone();
        let package = runtime
            .lock()
            .map_err(|_| poisoned())?
            .installed
            .get(&command.package_id)
            .cloned()
            .ok_or_else(|| Failure::Operation("Install the selected language package".into()))?;
        let description = {
            let _admission = guest.lock().map_err(|_| poisoned())?;
            crate::language::description(&package, &self.cancellation())?
        };
        let metadata = description.catalog.ok_or_else(|| {
            Failure::Operation(
                "Selected language package does not provide a collection catalog".into(),
            )
        })?;
        let first = self.page(&package, guest, None)?;
        let total = first.total;
        let revision = package.revision()?;
        let (mut offset, mut cursor) =
            self.publish(runtime, &package, &revision, |runtime, status| {
                let progress = runtime
                    .store
                    .begin_collection_catalog(&command.package_id, &revision, &metadata, total)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                status.processed = progress.0;
                status.total = Some(total);
                if progress.0 == total {
                    status.phase = CollectionPreparationPhase::Succeeded;
                }
                Ok(progress)
            })?;
        let mut pending = (offset == 0).then_some(first);
        while offset < total {
            let page = match pending.take() {
                Some(page) => page,
                None => self.page(&package, guest, cursor.clone())?,
            };
            let count = u32::try_from(page.items.len())
                .map_err(|error| Failure::Operation(error.to_string()))?;
            let next = offset
                .checked_add(count)
                .ok_or_else(|| Failure::Operation("Catalog progress overflow".into()))?;
            self.publish(runtime, &package, &revision, |runtime, status| {
                runtime
                    .store
                    .put_collection_catalog_page(
                        &command.package_id,
                        &revision,
                        offset,
                        cursor.as_deref(),
                        &page,
                    )
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                status.processed = next;
                if next == total {
                    status.phase = CollectionPreparationPhase::Succeeded;
                }
                Ok(())
            })?;
            #[cfg(test)]
            if let Some(observation) = self.observation.lock().map_err(|_| poisoned())?.take() {
                // Subscribe before starting preparation. Hold no native owner while
                // the test acknowledges this actual committed page.
                observation
                    .committed
                    .send(next)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                observation
                    .resume
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .map_err(|error| Failure::Operation(error.to_string()))?;
            }
            offset = next;
            cursor = page.next;
        }
        Ok(())
    }

    fn finish(&self, result: Result<(), Failure>) -> Result<Response, Failure> {
        let mut status = self.entry.status.lock().map_err(|_| poisoned())?;
        if active(status.phase) {
            match result {
                Ok(()) => status.phase = CollectionPreparationPhase::Succeeded,
                Err(error) => {
                    status.phase = if self.cancellation().check().is_err() {
                        CollectionPreparationPhase::Cancelled
                    } else {
                        CollectionPreparationPhase::Failed
                    };
                    status.message = Some(error.to_string().chars().take(2048).collect());
                }
            }
        }
        Ok(Response::CollectionPreparation {
            status: Some(status.clone()),
        })
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        match self.entry.status.lock() {
            Ok(mut status) if active(status.phase) => {
                status.phase = if self.cancellation().check().is_err() {
                    CollectionPreparationPhase::Cancelled
                } else {
                    CollectionPreparationPhase::Failed
                };
                status.message = Some("Collection preparation interrupted".into());
            }
            Ok(_) => {}
            Err(error) => eprintln!("Collection preparation cleanup: {error}"),
        }
    }
}

impl Runtime {
    pub(super) fn create_collection_selection(
        &mut self,
        command: mlearn_core::CollectionSelectionCreate,
    ) -> Result<Response, Failure> {
        if let Some(selection) = self
            .store
            .collection_selection_receipt(&command)
            .map_err(|error| Failure::Operation(error.to_string()))?
        {
            return Ok(Response::CollectionSelection { selection });
        }
        let query = match &command.source {
            mlearn_core::CollectionSelectionSource::Matching { query }
            | mlearn_core::CollectionSelectionSource::Items { query, .. } => query,
        };
        // Apply the same installed-package/revision authority as normal browsing.
        match self.collection_query(query.clone())? {
            Response::Collection {
                result: mlearn_core::CollectionResult::Ready { .. },
            } => {}
            Response::Collection {
                result: mlearn_core::CollectionResult::Unavailable { message },
            } => {
                return Err(Failure::Operation(message));
            }
            Response::Collection {
                result: mlearn_core::CollectionResult::Preparing { .. },
            } => {
                return Err(Failure::Operation("Collection is still preparing".into()));
            }
            _ => return Err(Failure::Operation("Unexpected collection response".into())),
        }
        let selection = self
            .store
            .create_collection_selection(&command)
            .map_err(|error| match error {
                mlearn_storage::StorageError::Conflict => {
                    Failure::Protocol("conflict", error.to_string())
                }
                error => Failure::Operation(error.to_string()),
            })?;
        Ok(Response::CollectionSelection { selection })
    }

    pub(super) fn collection_query(
        &mut self,
        query: mlearn_core::CollectionQuery,
    ) -> Result<Response, Failure> {
        if let Some(id) = &query.package_id {
            match self.installed.get(id) {
                Some(package) => {
                    let current_revision = package.revision()?;
                    if self
                        .store
                        .collection_catalog_revision(id)
                        .map_err(|error| Failure::Operation(error.to_string()))?
                        .is_some_and(|revision| revision != current_revision)
                    {
                        // Rebuildable metadata cannot claim to describe a new package.
                        // Authored Material and learner state are never evicted here.
                        self.store
                            .evict_collection_catalog(id)
                            .map_err(|error| Failure::Operation(error.to_string()))?;
                    }
                }
                None if query.surface == mlearn_core::CollectionSurface::Knowledge => {
                    return Ok(Response::Collection {
                        result: mlearn_core::CollectionResult::Unavailable {
                            message: "Install the selected language package".into(),
                        },
                    });
                }
                None => {}
            }
        }
        let result = self.store.collection(&query).map_err(|error| match error {
            mlearn_storage::StorageError::Conflict => {
                Failure::Protocol("conflict", error.to_string())
            }
            error => Failure::Operation(error.to_string()),
        })?;
        Ok(Response::Collection { result })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BundledPlugin, RuntimeExecutor, catalog::Manifest};
    use mlearn_core::{
        CollectionFilter, CollectionQuery, CollectionResult, CollectionSort, CollectionSurface,
        Request,
    };
    use mlearn_language_host::CodePolicy;
    use std::{path::Path, time::Duration};

    fn open(profile: &Path) -> RuntimeExecutor {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
        let manifests: Vec<Manifest> =
            serde_json::from_slice(&std::fs::read(root.join("bundle.json")).unwrap()).unwrap();
        let manifest = manifests
            .into_iter()
            .find(|manifest| manifest.id == "org.mlearn.english")
            .unwrap();
        let code = std::fs::read(root.join(&manifest.code.path)).unwrap();
        let assets = manifest
            .assets
            .iter()
            .map(|(key, artifact)| {
                (
                    key.clone(),
                    std::fs::read(root.join(&artifact.path)).unwrap().into(),
                )
            })
            .collect();
        RuntimeExecutor::new(
            Runtime::open(
                profile,
                CodePolicy::MobileBundled,
                None,
                vec![BundledPlugin {
                    manifest,
                    code,
                    assets,
                }],
            )
            .unwrap(),
        )
    }

    fn call(executor: &RuntimeExecutor, request: Request) -> Response {
        serde_json::from_str(&executor.execute(&serde_json::to_string(&request).unwrap())).unwrap()
    }

    fn status(response: Response) -> Option<CollectionPreparationStatus> {
        match response {
            Response::CollectionPreparation { status } => status,
            other => panic!("Expected native preparation status, got {other:?}"),
        }
    }

    #[test]
    fn frozen_selection_transport_retains_receipts_and_releases_after_reopen() {
        use mlearn_core::{CollectionSelectionCreate, CollectionSelectionSource};
        // Given the real metadata transport without an installed language package.
        let directory = tempfile::tempdir().unwrap();
        let profile = directory.path().join("profile");
        let open_empty = || {
            RuntimeExecutor::new(
                Runtime::open(&profile, CodePolicy::MobileBundled, None, vec![]).unwrap(),
            )
        };
        let executor = open_empty();
        let command = CollectionSelectionCreate {
            command_id: "transport-selection".into(),
            source: CollectionSelectionSource::Matching {
                query: CollectionQuery {
                    package_id: None,
                    surface: CollectionSurface::Material,
                    filter: CollectionFilter::All { filters: vec![] },
                    sort: CollectionSort::Default,
                    after: None,
                },
            },
        };
        let selected = match call(
            &executor,
            Request::CreateCollectionSelection {
                command: command.clone(),
            },
        ) {
            Response::CollectionSelection { selection } => selection,
            other => panic!("Expected a native selection receipt: {other:?}"),
        };
        drop(executor);

        // When the native owner restarts and receives the original command again.
        let executor = open_empty();
        let replay = call(
            &executor,
            Request::CreateCollectionSelection {
                command: command.clone(),
            },
        );

        // Then the frozen handle persists, bounded reads work, and release is final.
        assert!(
            matches!(replay, Response::CollectionSelection { selection } if selection == selected)
        );
        assert!(matches!(
            call(&executor, Request::CollectionSelections),
            Response::CollectionSelections { selections } if selections == vec![selected.clone()]
        ));
        assert!(matches!(
            call(&executor, Request::CollectionSelectionPage { id: selected.id.clone(), after: None }),
            Response::CollectionSelectionPage { id, page } if id == selected.id && page.items.is_empty() && page.next.is_none()
        ));
        assert!(matches!(
            call(&executor, Request::ReleaseCollectionSelection { id: selected.id.clone() }),
            Response::CollectionSelectionReleased { id } if id == selected.id
        ));
        assert!(matches!(
            call(&executor, Request::CreateCollectionSelection { command }),
            Response::Error { .. }
        ));
        assert!(matches!(
            call(&executor, Request::CollectionSelections),
            Response::CollectionSelections { selections } if selections.is_empty()
        ));
        assert!(matches!(
            call(
                &executor,
                Request::CreateCollectionSelection {
                    command: CollectionSelectionCreate {
                        command_id: "uninstalled-targets".into(),
                        source: CollectionSelectionSource::Matching {
                            query: CollectionQuery {
                                package_id: Some("org.missing".into()),
                                surface: CollectionSurface::Knowledge,
                                filter: CollectionFilter::All { filters: vec![] },
                                sort: CollectionSort::Default,
                                after: None,
                            }
                        },
                    },
                }
            ),
            Response::Error { .. }
        ));
    }

    #[test]
    fn native_preparation_cancels_and_resumes_its_committed_package_cursor() {
        // Given the actual compiled package and a subscription to a committed
        // native page, not a timer or a mocked SQLite transition.
        let directory = tempfile::tempdir().unwrap();
        let profile = directory.path().join("profile");
        let executor = open(&profile);
        let command = CollectionPreparationCommand {
            command_id: "prepare-first".into(),
            package_id: "org.mlearn.english".into(),
        };
        std::thread::scope(|scope| {
            let (committed, release) = executor.observe_collection();
            let worker = scope.spawn(|| {
                call(
                    &executor,
                    Request::PrepareCollection {
                        command: command.clone(),
                    },
                )
            });
            assert_eq!(committed.recv_timeout(Duration::from_secs(10)).unwrap(), 24);

            // When cancellation is acknowledged while the task is between pages.
            let replay = status(call(
                &executor,
                Request::PrepareCollection {
                    command: command.clone(),
                },
            ))
            .unwrap();
            assert_eq!(replay.processed, 24);
            assert_eq!(replay.phase, CollectionPreparationPhase::Preparing);
            let cancelled = status(call(
                &executor,
                Request::CancelCollectionPreparation {
                    command_id: command.command_id.clone(),
                },
            ))
            .unwrap();
            assert_eq!(cancelled.phase, CollectionPreparationPhase::Cancelling);
            release.send(()).unwrap();
            let finished = status(worker.join().unwrap()).unwrap();

            // Then no next page publishes after that acknowledgement.
            assert_eq!(finished.phase, CollectionPreparationPhase::Cancelled);
            assert_eq!(finished.processed, 24);
        });
        drop(executor);

        // Given the same persisted cache reopened in a new native owner.
        let executor = open(&profile);
        let query = CollectionQuery {
            package_id: Some(command.package_id.clone()),
            surface: CollectionSurface::Knowledge,
            filter: CollectionFilter::All { filters: vec![] },
            sort: CollectionSort::Default,
            after: None,
        };
        match call(&executor, Request::Collection { query }) {
            Response::Collection {
                result: CollectionResult::Preparing { processed, .. },
            } => {
                assert_eq!(processed, 24);
            }
            other => panic!("Expected the persisted preparation, got {other:?}"),
        }
        let resumed = CollectionPreparationCommand {
            command_id: "prepare-resumed".into(),
            package_id: command.package_id.clone(),
        };
        std::thread::scope(|scope| {
            let (committed, release) = executor.observe_collection();
            let worker = scope.spawn(|| {
                call(
                    &executor,
                    Request::PrepareCollection {
                        command: resumed.clone(),
                    },
                )
            });

            // When resumed, the next committed page starts at the saved cursor.
            assert_eq!(committed.recv_timeout(Duration::from_secs(10)).unwrap(), 48);
            assert!(
                status(call(
                    &executor,
                    Request::CancelCollectionPreparation {
                        command_id: command.command_id.clone()
                    },
                ))
                .is_none()
            );
            call(
                &executor,
                Request::CancelCollectionPreparation {
                    command_id: resumed.command_id.clone(),
                },
            );
            release.send(()).unwrap();

            // Then an old command cannot cancel the new one or replay its first page.
            let finished = status(worker.join().unwrap()).unwrap();
            assert_eq!(finished.phase, CollectionPreparationPhase::Cancelled);
            assert_eq!(finished.processed, 48);
        });
    }
}
