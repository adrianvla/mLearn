#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use std::collections::BTreeMap;
use support::{mutation, reveal, submit};

const PACKAGE: &str = "example.language";
const REVISION: &str = "revision-one";

fn capability(name: &str) -> String {
    format!("{PACKAGE}:{name}")
}

fn catalog(store: &mut ProfileStore, count: u32) {
    let description = CollectionDescription {
        calibration_capabilities: Some(vec![capability("meaning"), capability("reading")]),
        capabilities: ["meaning", "reading"]
            .map(|name| Capability {
                id: capability(name),
                label: name.into(),
            })
            .into(),
        kinds: vec![LinguisticLabel {
            id: capability("lexeme"),
            label: "Lexeme".into(),
            color: None,
            attribution: "Original storage fixture".into(),
        }],
        scopes: vec![LinguisticLabel {
            id: capability("even"),
            label: "Even entries".into(),
            color: None,
            attribution: "Original storage fixture".into(),
        }],
        levels: vec![],
    };
    store
        .begin_collection_catalog(PACKAGE, REVISION, &description, count)
        .unwrap();
    let mut offset = 0;
    let mut cursor = None;
    while offset < count {
        let end = (offset + 64).min(count);
        let next = (end < count).then(|| format!("fixture/{end}"));
        store
            .put_collection_catalog_page(
                PACKAGE,
                REVISION,
                offset,
                cursor.as_deref(),
                &CollectionCatalogPage {
                    items: (offset..end)
                        .map(|index| CollectionTarget {
                            calibration_capabilities: Some(vec![
                                capability("meaning"),
                                capability("reading"),
                            ]),
                            summary: LexicalSummary {
                                target_id: format!("entry-{index:03}"),
                                headword: format!("word {index}"),
                                reading: None,
                                summary: "Original fixture".into(),
                                presentation: None,
                            },
                            kind: capability("lexeme"),
                            capabilities: description
                                .capabilities
                                .iter()
                                .map(|value| value.id.clone())
                                .collect(),
                            scopes: if index % 2 == 0 {
                                vec![capability("even")]
                            } else {
                                vec![]
                            },
                            levels: vec![],
                            extensions: BTreeMap::new(),
                        })
                        .collect(),
                    next: next.clone(),
                    total: count,
                },
            )
            .unwrap();
        offset = end;
        cursor = next;
    }
}

fn select(store: &mut ProfileStore, id: &str, filter: CollectionFilter) -> CollectionSelection {
    store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: id.into(),
            source: CollectionSelectionSource::Matching {
                query: CollectionQuery {
                    package_id: Some(PACKAGE.into()),
                    surface: CollectionSurface::Knowledge,
                    filter,
                    sort: CollectionSort::Default,
                    after: None,
                },
            },
        })
        .unwrap()
}

fn all(store: &mut ProfileStore, id: &str) -> CollectionSelection {
    select(store, id, CollectionFilter::All { filters: vec![] })
}

fn start_command(selection: &CollectionSelection, capabilities: &[String]) -> ReviewStart {
    ReviewStart {
        command_id: "start-collection".into(),
        session_id: ReviewSessionId("collection".into()),
        mode: ReviewMode::CollectionPractice {
            selection_id: selection.id.clone(),
            capabilities: capabilities.to_vec(),
        },
    }
}

// Each capability becomes one actual task; no Material, due queue or SQL mock.
fn admissions(item: &TargetPracticeItem) -> Vec<ReviewAdmission> {
    item.capabilities
        .iter()
        .map(|capability| {
            let key = KnowledgeKey {
                package_id: item.package_id.clone(),
                target_id: item.target_id.clone(),
                capability: capability.clone(),
            };
            ReviewAdmission {
                work_id: ReviewWorkId(format!("{}-{capability}", item.target_id)),
                subject: ReviewSubject::Target {
                    target_id: item.target_id.clone(),
                },
                package_id: item.package_id.clone(),
                package_version: "1".into(),
                package_revision: item.package_revision.clone(),
                scheduler_version: REVIEW_POLICY_VERSION,
                source: None,
                probe: ReviewProbe {
                    id: capability.clone(),
                    contract_version: 1,
                    direction: ReviewDirection::Written,
                    cue: "Original cue".into(),
                    answer: "Original answer".into(),
                    targets: vec![ReviewTarget {
                        id: capability.clone(),
                        label: capability.clone(),
                        mnemonic: None,
                        key: Some(key.clone()),
                    }],
                    supplied: vec![],
                    required_media: None,
                },
                task: Some(TaskContract {
                    revision: 1,
                    response_spec: ResponseSpec::SelfReport,
                    validator_id: None,
                    answer_supplied: vec![key],
                    attribution: "Original storage fixture".into(),
                    limitations: "Retrospective recall only".into(),
                }),
            }
        })
        .collect()
}

fn finish(store: &mut ProfileStore, session: &ReviewSession, id: &str) -> ReviewSession {
    let revealed = reveal(store, session, &format!("reveal-{id}"));
    submit(store, &revealed, &format!("submit-{id}"))
}

#[test]
fn empty_material_and_released_selections_cannot_start_canonical_collection_practice() {
    // Given real empty, authored Material and released Knowledge selections.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 1);
    let empty = select(
        &mut store,
        "empty-selection",
        CollectionFilter::Text {
            text: "not present".into(),
        },
    );
    support::admission(&mut store, "saved-material");
    let material = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "material-selection".into(),
            source: CollectionSelectionSource::Matching {
                query: CollectionQuery {
                    package_id: None,
                    surface: CollectionSurface::Material,
                    filter: CollectionFilter::All { filters: vec![] },
                    sort: CollectionSort::Default,
                    after: None,
                },
            },
        })
        .unwrap();
    assert_eq!(empty.target_count, 0);
    assert_eq!(material.material_count, 1);
    let released = all(&mut store, "released-selection");
    store.release_collection_selection(&released.id).unwrap();

    // When canonical collection preparation sees each unsupported scope.
    for selection in [empty, material, released] {
        // Then it fails explicitly rather than substituting due or saved work.
        assert!(matches!(
            store.review_collection_first(&selection.id, &[capability("meaning")]),
            Err(StorageError::Invalid(_))
        ));
    }
}

#[test]
fn more_than_128_frozen_targets_advance_lazily_without_due_or_live_filter_substitution() {
    // Given 129 even, untracked targets frozen by a compound native filter.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 258);
    let unrelated = support::admission(&mut store, "unrelated-due-material");
    let selection = select(
        &mut store,
        "freeze-even-untracked",
        CollectionFilter::All {
            filters: vec![
                CollectionFilter::Scope {
                    id: capability("even"),
                },
                CollectionFilter::Capability {
                    capability: capability("meaning"),
                    states: vec![CollectionKnowledgeState::Untracked],
                },
            ],
        },
    );
    assert_eq!(selection.target_count, 129);
    let capabilities = vec![capability("meaning")];
    let first = store
        .review_collection_first(&selection.id, &capabilities)
        .unwrap();
    let start = start_command(&selection, &capabilities);
    let started = store
        .review_start(&start, &admissions(&first), 100)
        .unwrap();
    assert_eq!(
        store
            .review_start(&start, &admissions(&first), 999)
            .unwrap(),
        started
    );
    let mut session = started.session;
    let changed = KnowledgeKey {
        package_id: PACKAGE.into(),
        target_id: "entry-002".into(),
        capability: capability("meaning"),
    };
    store
        .change_claim(&ClaimChange {
            command_id: "change-live-membership".into(),
            key: changed.clone(),
            claim: Some(true),
        })
        .unwrap();

    // When each frozen target is prepared and queued separately.
    for index in 0..129 {
        let encounter = session.encounter.as_ref().unwrap();
        assert_eq!(
            encounter.subject,
            ReviewSubject::Target {
                target_id: format!("entry-{:03}", index * 2)
            }
        );
        assert_eq!(encounter.package_id, PACKAGE);
        assert_eq!(encounter.package_revision, REVISION);
        assert_eq!(encounter.source, None);
        assert_eq!(
            encounter.targets[0].key.as_ref().unwrap().capability,
            capabilities[0]
        );
        assert!(encounter
            .conditions
            .assistance
            .contains(&ReviewAssistance::Source));
        if index < 128 {
            assert_eq!(session.total, None);
        }
        session = finish(&mut store, &session, &format!("target-{index}"));
        if index < 128 {
            let next = store
                .review_collection_candidate(&session.id)
                .unwrap()
                .unwrap();
            assert_eq!(next.target_id, format!("entry-{:03}", (index + 1) * 2));
            let mutation = mutation(&session, &format!("next-{index}"));
            let plan = admissions(&next);
            let committed = store.review_collection_next(&mutation, &plan, 103).unwrap();
            let retry = store.review_collection_next(&mutation, &plan, 999).unwrap();
            assert_eq!(retry, committed);
            session = committed.session;
        }
    }
    let ended = store
        .review_collection_next(&mutation(&session, "end"), &[], 104)
        .unwrap()
        .session;

    // Then every frozen identity was visited exactly once, never the due Material.
    assert_eq!(ended.completed, 129);
    assert_eq!(ended.total, Some(129));
    assert_eq!(ended.state, ReviewSessionState::Complete);
    assert_eq!(store.knowledge(&[changed]).unwrap()[0].assessed, None);
    assert!(support::schedule(&store, &unrelated).is_none());
    store.release_collection_selection(&selection.id).unwrap();
    assert_eq!(store.review_collection_candidate(&ended.id).unwrap(), None);
}

#[test]
fn queued_tasks_keep_order_pause_restart_and_release_after_last_target_is_queued() {
    // Given two tasks per frozen target and an active pin.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    catalog(&mut store, 2);
    let selection = all(&mut store, "queued-selection");
    let capabilities = vec![capability("meaning"), capability("reading")];
    let first = store
        .review_collection_first(&selection.id, &capabilities)
        .unwrap();
    let session = store
        .review_start(
            &start_command(&selection, &capabilities),
            &admissions(&first),
            100,
        )
        .unwrap()
        .session;
    assert!(store.review_collection_pending(&session.id).unwrap());
    assert_eq!(
        store.collection_selection(&selection.id).unwrap().in_use,
        Some(true)
    );
    assert!(store.release_collection_selection(&selection.id).is_err());
    let next = store
        .review_collection_candidate(&session.id)
        .unwrap()
        .unwrap();
    assert!(store
        .review_collection_next(&mutation(&session, "premature"), &admissions(&next), 101)
        .is_err());
    let paused = store
        .review_apply(
            &ReviewCommand::Pause {
                mutation: mutation(&session, "pause"),
            },
            101,
        )
        .unwrap()
        .session;

    // When the exact queued session restarts, resumes and drains its first target.
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.review_session(&session.id).unwrap(), paused);
    assert!(store.release_collection_selection(&selection.id).is_err());
    let resumed = store
        .review_apply(
            &ReviewCommand::Resume {
                mutation: mutation(&paused, "resume"),
            },
            102,
        )
        .unwrap()
        .session;
    assert_eq!(resumed.encounter, session.encounter);
    let done = finish(&mut store, &resumed, "first-meaning");
    let reading = store
        .review_collection_next(&mutation(&done, "dequeue-reading"), &[], 103)
        .unwrap()
        .session;
    assert_eq!(
        reading.encounter.as_ref().unwrap().probe_id,
        capability("reading")
    );
    assert_eq!(
        reading.encounter.as_ref().unwrap().subject,
        admissions(&first)[0].subject
    );
    let done = finish(&mut store, &reading, "first-reading");
    assert!(!store.review_collection_pending(&done.id).unwrap());
    let last = store
        .review_collection_next(&mutation(&done, "queue-last"), &admissions(&next), 104)
        .unwrap()
        .session;

    // Then the last target's queued tasks own their content, even after release.
    assert_eq!(
        last.encounter.as_ref().unwrap().probe_id,
        capability("meaning")
    );
    assert!(store.review_collection_pending(&last.id).unwrap());
    assert_eq!(
        store.collection_selection(&selection.id).unwrap().in_use,
        Some(false)
    );
    store.release_collection_selection(&selection.id).unwrap();
    assert_eq!(store.review_collection_candidate(&last.id).unwrap(), None);
    let done = finish(&mut store, &last, "last-meaning");
    let reading = store
        .review_collection_next(&mutation(&done, "last-reading"), &[], 105)
        .unwrap()
        .session;
    assert_eq!(
        reading.encounter.as_ref().unwrap().probe_id,
        capability("reading")
    );
    let done = finish(&mut store, &reading, "last-reading");
    let ended = store
        .review_collection_next(&mutation(&done, "end"), &[], 106)
        .unwrap()
        .session;
    assert_eq!(ended.completed, 4);
    assert_eq!(ended.total, Some(4));
    assert_eq!(ended.state, ReviewSessionState::Complete);
}

#[test]
fn malformed_start_and_append_roll_back_without_consuming_command_or_frozen_cursor() {
    // Given exact two-capability tasks for a real frozen selection.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 2);
    let selection = all(&mut store, "validation-selection");
    for capabilities in [
        vec![],
        vec![String::new()],
        vec!["x".repeat(513)],
        vec![capability("meaning"); 2],
        (0..33)
            .map(|index| capability(&index.to_string()))
            .collect(),
    ] {
        assert!(store
            .review_collection_first(&selection.id, &capabilities)
            .is_err());
    }
    let capabilities = vec![capability("meaning"), capability("reading")];
    let first = store
        .review_collection_first(&selection.id, &capabilities)
        .unwrap();
    let valid = admissions(&first);
    let start = start_command(&selection, &capabilities);
    let mut stale = valid.clone();
    stale[0].package_revision = "wrong-revision".into();
    let mut foreign = valid.clone();
    foreign[0].subject = ReviewSubject::Target {
        target_id: "unselected".into(),
    };
    let mut wrong_key = valid.clone();
    wrong_key[0].probe.targets[0]
        .key
        .as_mut()
        .unwrap()
        .package_id = "foreign".into();
    let mut missing_task = valid.clone();
    missing_task[0].task = None;
    let mut duplicate = valid.clone();
    duplicate[1].work_id = duplicate[0].work_id.clone();
    let mut unsupported = valid.clone();
    unsupported[0].probe.targets[0]
        .key
        .as_mut()
        .unwrap()
        .capability = capability("unsupported");
    let mut malformed = valid.clone();
    malformed[0].package_version.clear();

    // When malformed plans retry the same uncommitted start identity.
    for plan in [
        vec![],
        valid[..1].to_vec(),
        stale,
        foreign,
        wrong_key,
        missing_task,
        duplicate,
        unsupported,
        malformed,
        valid.iter().cycle().take(9).cloned().collect(),
    ] {
        assert!(matches!(
            store.review_start(&start, &plan, 100),
            Err(StorageError::Invalid(_))
        ));
        assert!(store.review_session(&start.session_id).is_err());
        assert!(store
            .review_receipt(&ReviewCommand::Start {
                start: start.clone()
            })
            .unwrap()
            .is_none());
    }
    let session = store.review_start(&start, &valid, 100).unwrap().session;
    let done = finish(&mut store, &session, "first-meaning");
    let reading = store
        .review_collection_next(&mutation(&done, "first-reading"), &[], 101)
        .unwrap()
        .session;
    let done = finish(&mut store, &reading, "first-reading");
    let next = store
        .review_collection_candidate(&done.id)
        .unwrap()
        .unwrap();
    let valid = admissions(&next);
    let command = mutation(&done, "append-retry");
    let mut stale = valid.clone();
    stale[0].package_revision = "wrong-revision".into();
    let mut duplicate_existing = valid.clone();
    duplicate_existing[0].work_id = admissions(&first)[0].work_id.clone();
    let mut malformed = valid.clone();
    malformed[1].package_version.clear();
    for plan in [
        vec![],
        valid[..1].to_vec(),
        stale,
        duplicate_existing,
        malformed,
    ] {
        assert!(store.review_collection_next(&command, &plan, 102).is_err());
        assert_eq!(store.review_session(&done.id).unwrap(), done);
        assert!(!store.review_collection_pending(&done.id).unwrap());
        assert_eq!(
            store.review_collection_candidate(&done.id).unwrap(),
            Some(next.clone())
        );
        assert!(store
            .review_receipt(&ReviewCommand::Next {
                mutation: command.clone()
            })
            .unwrap()
            .is_none());
    }

    // Then valid retry commits the original command once, with no skipped target.
    let committed = store.review_collection_next(&command, &valid, 102).unwrap();
    assert_eq!(
        committed.session.encounter.as_ref().unwrap().subject,
        valid[0].subject
    );
    assert_eq!(
        store.review_collection_next(&command, &valid, 999).unwrap(),
        committed
    );
    assert_eq!(
        store
            .knowledge(&[valid[0].probe.targets[0].key.clone().unwrap()])
            .unwrap()[0]
            .assessed,
        None
    );
}

#[test]
fn stop_releases_unfinished_selection_without_erasing_attempts_or_admitting_remaining_targets() {
    // Given one completed target and an active second encounter in a three-target scope.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    catalog(&mut store, 3);
    let selection = all(&mut store, "stoppable-selection");
    let capabilities = vec![capability("meaning")];
    let first = store
        .review_collection_first(&selection.id, &capabilities)
        .unwrap();
    let session = store
        .review_start(
            &start_command(&selection, &capabilities),
            &admissions(&first),
            100,
        )
        .unwrap()
        .session;
    let done = finish(&mut store, &session, "completed");
    let next = store
        .review_collection_candidate(&done.id)
        .unwrap()
        .unwrap();
    let active = store
        .review_collection_next(&mutation(&done, "second-target"), &admissions(&next), 101)
        .unwrap()
        .session;
    assert!(store.release_collection_selection(&selection.id).is_err());

    // When Stop is committed and the profile restarts.
    let command = ReviewCommand::Stop {
        mutation: mutation(&active, "stop"),
    };
    let stopped = store.review_apply(&command, 102).unwrap();
    assert_eq!(
        store.collection_selection(&selection.id).unwrap().in_use,
        Some(false)
    );
    store.release_collection_selection(&selection.id).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.review_apply(&command, 999).unwrap(), stopped);

    // Then stopping retains evidence and honest partial progress, not completion.
    assert_eq!(stopped.session.state, ReviewSessionState::Stopped);
    assert_eq!(stopped.session.completed, 1);
    assert_eq!(stopped.session.total, None);
    assert_eq!(stopped.session.encounter, None);
    assert!(!stopped.session.can_undo);
    assert!(store
        .review_collection_next(&mutation(&stopped.session, "after-stop"), &[], 103)
        .is_err());
    let evidence = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: admissions(&first)[0].probe.targets[0].key.clone().unwrap(),
            after: None,
        })
        .unwrap();
    assert_eq!(evidence.observations.len(), 1);
    assert_eq!(evidence.projection.assessed, None);
    assert!(evidence.observations[0].practice);
    assert_eq!(
        evidence.observations[0].purpose,
        Some(ReviewPurpose::Practice)
    );
}

#[test]
fn calibration_keeps_claims_separate_from_measurement_and_resumes_its_frozen_queue() {
    // Given unmeasured known/unknown claims, one exclusion and a package-defined scope.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    catalog(&mut store, 6);
    let key = |target: &str| KnowledgeKey {
        package_id: PACKAGE.into(),
        target_id: target.into(),
        capability: capability("meaning"),
    };
    for (target, known) in [("entry-000", true), ("entry-002", false)] {
        store
            .change_claim(&ClaimChange {
                command_id: format!("claim-{target}"),
                key: key(target),
                claim: Some(known),
            })
            .unwrap();
    }
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "exclude-four".into(),
            target: MaterialTarget {
                package_id: PACKAGE.into(),
                target_id: "entry-004".into(),
            },
            excluded: true,
        })
        .unwrap();
    let query = CalibrationQuery {
        package_id: PACKAGE.into(),
        capability: capability("meaning"),
        filter: CollectionFilter::Scope {
            id: capability("even"),
        },
        limit: 4,
    };
    let items = store.calibration_candidates(&query).unwrap();
    assert_eq!(
        items
            .iter()
            .map(|item| item.target_id.as_str())
            .collect::<Vec<_>>(),
        ["entry-000", "entry-002"]
    );
    let start = ReviewStart {
        command_id: "calibrate".into(),
        session_id: ReviewSessionId("calibration".into()),
        mode: ReviewMode::Calibration {
            query: query.clone(),
            items: items.clone(),
        },
    };
    let plan: Vec<_> = items.iter().flat_map(admissions).collect();
    // When the existing Review owner admits, rates, pauses and reopens that finite queue.
    let committed = store.review_start(&start, &plan, 100).unwrap();
    assert!(!committed.session.mode.is_scheduled());
    assert_eq!(committed.session.total, Some(2));
    assert!(committed
        .session
        .encounter
        .as_ref()
        .unwrap()
        .conditions
        .assistance
        .is_empty());
    let done = finish(&mut store, &committed.session, "calibration-first");
    let next = store
        .review_next(&mutation(&done, "calibration-next"), None, 103)
        .unwrap()
        .session;
    let paused = store
        .review_apply(
            &ReviewCommand::Pause {
                mutation: mutation(&next, "calibration-pause"),
            },
            104,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    let resumed = store
        .review_apply(
            &ReviewCommand::Resume {
                mutation: mutation(&paused, "calibration-resume"),
            },
            105,
        )
        .unwrap()
        .session;
    // Then native measurement, not a claim, removes a key from subsequent calibration.
    assert_eq!(resumed.encounter, next.encounter);
    assert_eq!(
        store.review_start(&start, &plan, 999).unwrap(),
        ReviewCommit {
            session: resumed,
            ..committed
        }
    );
    let measured = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("entry-000"),
            after: None,
        })
        .unwrap();
    assert_eq!(measured.projection.claim, Some(true));
    assert_eq!(measured.projection.assessed, Some(true));
    assert_eq!(measured.observations.len(), 1);
    assert_eq!(
        measured.observations[0].purpose,
        Some(ReviewPurpose::Calibration)
    );
    assert_eq!(
        measured.observations[0].grade.method,
        ResponseMethod::Remembered
    );
    assert_eq!(
        store
            .calibration_candidates(&query)
            .unwrap()
            .iter()
            .map(|item| item.target_id.as_str())
            .collect::<Vec<_>>(),
        ["entry-002"]
    );
    assert!(store
        .materials(&MaterialQuery {
            after: None,
            query: String::new(),
            source_id: None,
            include_excluded: true,
        })
        .unwrap()
        .items
        .is_empty());
}

#[test]
fn calibration_bounds_and_rechecks_the_native_unmeasured_scope_before_any_durable_write() {
    // Given a bounded preparation from a larger real catalog.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 40);
    let query = CalibrationQuery {
        package_id: PACKAGE.into(),
        capability: capability("meaning"),
        filter: CollectionFilter::All { filters: vec![] },
        limit: 32,
    };
    let items = store.calibration_candidates(&query).unwrap();
    assert_eq!(items.len(), 32);
    for limit in [0, 33] {
        assert!(store
            .calibration_candidates(&CalibrationQuery {
                limit,
                ..query.clone()
            })
            .is_err());
    }
    assert!(store
        .calibration_candidates(&CalibrationQuery {
            capability: capability("unavailable"),
            ..query.clone()
        })
        .is_err());
    let mut stale = items.clone();
    stale[0].package_revision = "stale".into();
    let mut broadened = items.clone();
    broadened[0].capabilities.push(capability("reading"));
    let mut reordered = items.clone();
    reordered.swap(0, 1);
    // When a caller changes membership, revision, capabilities or preparation order.
    for selected in [vec![], items[..31].to_vec(), stale, broadened, reordered] {
        let start = ReviewStart {
            command_id: "uncharged-calibration".into(),
            session_id: ReviewSessionId("uncharged".into()),
            mode: ReviewMode::Calibration {
                query: query.clone(),
                items: selected,
            },
        };
        let plan: Vec<_> = items.iter().flat_map(admissions).collect();
        assert!(store.review_start(&start, &plan, 100).is_err());
        // Then failed admission commits neither a session nor a command receipt.
        assert!(store.review_session(&start.session_id).is_err());
        assert!(store
            .review_receipt(&ReviewCommand::Start { start })
            .unwrap()
            .is_none());
    }
}

#[test]
fn calibration_assistance_and_undo_preserve_unmeasured_eligibility() {
    for assisted in [false, true] {
        // Given one unmeasured target and an unchanged explicit claim.
        let directory = tempfile::tempdir().unwrap();
        let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
        catalog(&mut store, 1);
        let key = KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: "entry-000".into(),
            capability: capability("meaning"),
        };
        store
            .change_claim(&ClaimChange {
                command_id: "claim".into(),
                key: key.clone(),
                claim: Some(true),
            })
            .unwrap();
        let query = CalibrationQuery {
            package_id: PACKAGE.into(),
            capability: capability("meaning"),
            filter: CollectionFilter::All { filters: vec![] },
            limit: 1,
        };
        let items = store.calibration_candidates(&query).unwrap();
        let plan: Vec<_> = items.iter().flat_map(admissions).collect();
        let mut session = store
            .review_start(
                &ReviewStart {
                    command_id: "start".into(),
                    session_id: ReviewSessionId("calibration".into()),
                    mode: ReviewMode::Calibration {
                        query: query.clone(),
                        items: items.clone(),
                    },
                },
                &plan,
                100,
            )
            .unwrap()
            .session;
        if assisted {
            session = store
                .review_apply(
                    &ReviewCommand::Assistance {
                        mutation: mutation(&session, "assist"),
                        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
                        assistance: ReviewAssistance::Source,
                    },
                    101,
                )
                .unwrap()
                .session;
        }
        // When recall is reported, only the independent attempt measures this key.
        let done = finish(&mut store, &session, "recall");
        assert_eq!(
            store.knowledge(&[key.clone()]).unwrap()[0].assessed,
            if assisted { None } else { Some(true) }
        );
        assert_eq!(
            store.calibration_candidates(&query).unwrap(),
            if assisted { items.clone() } else { vec![] }
        );
        let undone = store
            .review_apply(
                &ReviewCommand::Undo {
                    mutation: mutation(&done, "undo"),
                },
                104,
            )
            .unwrap()
            .session;
        // Then Undo restores eligibility, not an independent second attempt.
        assert!(undone.encounter.as_ref().unwrap().conditions.revealed);
        assert_eq!(store.calibration_candidates(&query).unwrap(), items);
        let evidence = store
            .knowledge_evidence(&KnowledgeEvidenceQuery { key, after: None })
            .unwrap();
        assert_eq!(evidence.projection.claim, Some(true));
        assert_eq!(evidence.projection.assessed, None);
        assert_eq!(evidence.observations.len(), 1);
        assert!(!evidence.observations[0].active);
        assert_eq!(
            evidence.observations[0]
                .conditions
                .assistance
                .contains(&ReviewAssistance::Source),
            assisted
        );
    }
}
