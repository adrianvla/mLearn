use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use std::collections::{BTreeMap, BTreeSet};

const PACKAGE: &str = "example.language";

#[test]
fn amended_selection_keeps_frozen_preconditions_and_projects_only_requested_membership() {
    // Given a hand-built selection and a later edit to one selected identity.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 6);
    for index in [0, 2, 4] {
        save(&mut store, index);
    }
    let selection_query = query(
        CollectionSurface::Material,
        CollectionFilter::All { filters: vec![] },
    );
    let materials = ready(&store, &selection_query)
        .items
        .into_iter()
        .map(|item| match item {
            CollectionItem::Material { material, .. } => {
                (material.content.target_id.clone().unwrap(), *material)
            }
            other => panic!("Expected Material: {other:?}"),
        })
        .collect::<BTreeMap<_, _>>();
    let item = |index| CollectionItemId::Material {
        id: materials[&format!("entry-{index:03}")].id.clone(),
    };
    let original = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "initial-selection".into(),
            source: CollectionSelectionSource::Items {
                query: selection_query.clone(),
                items: vec![item(0), item(2)],
            },
        })
        .unwrap();
    let changed = &materials["entry-000"];
    let mut content = changed.content.clone();
    content.notes = "edited after selection".into();
    store
        .update_material(&MaterialEdit {
            command_id: "change-selected".into(),
            id: changed.id.clone(),
            expected_revision: changed.revision,
            content,
            excluded: false,
            media_imports: vec![],
        })
        .unwrap();
    let command = CollectionSelectionCreate {
        command_id: "amend-selection".into(),
        source: CollectionSelectionSource::Amend {
            selection_id: original.id.clone(),
            query: selection_query.clone(),
            add: vec![item(4)],
            remove: vec![item(2)],
        },
    };

    // When selection changes without re-evaluating the retained identities.
    let amended = store.create_collection_selection(&command).unwrap();

    // Then the old snapshot is unchanged and the retained edit precondition is frozen.
    assert_eq!((original.material_count, amended.material_count), (2, 2));
    let old = store.collection_selection_page(&original.id, None).unwrap();
    assert!(old.items.iter().any(|entry| entry.item == item(2)));
    let page = store.collection_selection_page(&amended.id, None).unwrap();
    assert_eq!(
        page.items
            .iter()
            .find(|entry| entry.item == item(0))
            .unwrap()
            .material_revision,
        Some(changed.revision)
    );
    assert!(!page.items.iter().any(|entry| entry.item == item(2)));
    let requested = vec![item(4), item(2), item(0)];
    let projected = store
        .collection_selection_membership(&amended.id, None, CollectionSurface::Material, &requested)
        .unwrap();
    assert_eq!(
        projected,
        requested
            .iter()
            .cloned()
            .zip([true, false, true])
            .map(|(item, selected)| { CollectionSelectionMembership { item, selected } })
            .collect::<Vec<_>>()
    );
    let oversized = (0..65)
        .map(|index| CollectionItemId::Material {
            id: MaterialId(format!("material-{index}")),
        })
        .collect::<Vec<_>>();
    assert!(
        store
            .collection_selection_membership(
                &amended.id,
                None,
                CollectionSurface::Material,
                &oversized
            )
            .is_err()
    );
    assert!(
        store
            .collection_selection_membership(
                &amended.id,
                None,
                CollectionSurface::Material,
                &[item(0), item(0)]
            )
            .is_err()
    );
    let overlap = CollectionSelectionCreate {
        command_id: "overlap".into(),
        source: CollectionSelectionSource::Amend {
            selection_id: original.id.clone(),
            query: selection_query.clone(),
            add: vec![item(0)],
            remove: vec![item(0)],
        },
    };
    assert!(store.create_collection_selection(&overlap).is_err());
    let outside = CollectionSelectionCreate {
        command_id: "outside-filter".into(),
        source: CollectionSelectionSource::Amend {
            selection_id: original.id.clone(),
            query: query(
                CollectionSurface::Material,
                CollectionFilter::Text {
                    text: "not present".into(),
                },
            ),
            add: vec![item(4)],
            remove: vec![],
        },
    };
    assert!(matches!(
        store.create_collection_selection(&outside),
        Err(StorageError::Conflict)
    ));
    assert_eq!(store.collection_selections().unwrap().len(), 2);
    store.release_collection_selection(&original.id).unwrap();
    assert_eq!(
        store.create_collection_selection(&command).unwrap(),
        amended
    );
}

#[test]
fn removing_frozen_targets_survives_catalog_eviction_without_cross_package_aliases() {
    // Given frozen target identities whose rebuildable catalog is later evicted.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    catalog(&mut store, 2);
    let selection_query = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All { filters: vec![] },
    );
    let original = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "select-targets".into(),
            source: CollectionSelectionSource::Matching {
                query: selection_query.clone(),
            },
        })
        .unwrap();
    store.evict_collection_catalog(PACKAGE).unwrap();
    let item = |index| CollectionItemId::Target {
        target_id: format!("entry-{index:03}"),
    };

    // When only membership removal is requested, no current dictionary is needed.
    let amended = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "remove-frozen-target".into(),
            source: CollectionSelectionSource::Amend {
                selection_id: original.id,
                query: selection_query.clone(),
                add: vec![],
                remove: vec![item(0)],
            },
        })
        .unwrap();

    // Then the remainder is readable, but an aliased target in another package is not selected.
    assert_eq!(amended.target_count, 1);
    let keys = vec![item(0), item(1)];
    assert_eq!(
        store
            .collection_selection_membership(
                &amended.id,
                Some(PACKAGE),
                CollectionSurface::Knowledge,
                &keys
            )
            .unwrap()
            .iter()
            .map(|row| row.selected)
            .collect::<Vec<_>>(),
        vec![false, true]
    );
    assert!(
        store
            .collection_selection_membership(
                &amended.id,
                Some("other.package"),
                CollectionSurface::Knowledge,
                &keys
            )
            .unwrap()
            .iter()
            .all(|row| !row.selected)
    );
    let add = CollectionSelectionCreate {
        command_id: "add-without-catalog".into(),
        source: CollectionSelectionSource::Amend {
            selection_id: amended.id.clone(),
            query: selection_query.clone(),
            add: vec![item(0)],
            remove: vec![],
        },
    };
    assert!(store.create_collection_selection(&add).is_err());
    let mut foreign_query = selection_query;
    foreign_query.package_id = Some("other.package".into());
    assert!(
        store
            .create_collection_selection(&CollectionSelectionCreate {
                command_id: "foreign-amendment".into(),
                source: CollectionSelectionSource::Amend {
                    selection_id: amended.id,
                    query: foreign_query,
                    add: vec![],
                    remove: vec![item(1)],
                },
            })
            .is_err()
    );
}

#[test]
fn frozen_selection_survives_filter_changes_retry_and_reopen() {
    // Given saved Materials selected through the same native negated predicate.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    for index in 0..70 {
        save(&mut store, index);
    }
    let command = CollectionSelectionCreate {
        command_id: "freeze".into(),
        source: CollectionSelectionSource::Matching {
            query: query(
                CollectionSurface::Material,
                CollectionFilter::Not {
                    filter: Box::new(CollectionFilter::Material {
                        state: CollectionMaterialState::Excluded,
                    }),
                },
            ),
        },
    };
    let selected = store.create_collection_selection(&command).unwrap();
    let first = store.collection_selection_page(&selected.id, None).unwrap();
    assert_eq!(selected.material_count, 69);
    assert_eq!(first.items.len(), 64);
    assert!(first.next.is_some());
    let CollectionItemId::Material { id } = &first.items[0].item else {
        panic!("Expected Material identity");
    };
    let original = store.material(id).unwrap();
    store
        .update_material(&MaterialEdit {
            command_id: "change-selected".into(),
            id: id.clone(),
            expected_revision: original.revision,
            content: original.content,
            excluded: true,
            media_imports: vec![],
        })
        .unwrap();
    save(&mut store, 71);
    drop(store);

    // When resumed and retried after the query's membership and row revision changed.
    let mut store = ProfileStore::open(&path).unwrap();
    let retried = store.create_collection_selection(&command).unwrap();

    // Then the original identities/preconditions persist, not the refreshed filter.
    assert_eq!(retried, selected);
    assert_eq!(
        store.collection_selection_page(&selected.id, None).unwrap(),
        first
    );
    assert_eq!(first.items[0].material_revision, Some(original.revision));
    let last = store
        .collection_selection_page(&selected.id, first.next.as_deref())
        .unwrap();
    assert_eq!(last.items.len(), 5);
    assert_eq!(last.next, None);
    assert_eq!(store.material(id).unwrap().revision, original.revision + 1);
    assert_eq!(
        first
            .items
            .iter()
            .chain(&last.items)
            .map(|row| { serde_json::to_string(&row.item).unwrap() })
            .collect::<BTreeSet<_>>()
            .len(),
        69
    );
}

#[test]
fn frozen_selection_pages_budget_escaped_revision_bytes_without_skipping_entries() {
    // Given 65 admitted Materials whose revisions expand sixfold in JSON.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let revision = "\u{0001}".repeat(512);
    let mut expected = BTreeMap::new();
    for index in 0..65 {
        let saved = store
            .create_material(&MaterialCreate {
                command_id: format!("escaped-revision-{index}"),
                distinct: true,
                media_imports: vec![],
                content: MaterialContent {
                    package_id: PACKAGE.into(),
                    target_id: None,
                    package_revision: Some(revision.clone()),
                    sense: None,
                    phrase: format!("Independent phrase {index}"),
                    reading: "".into(),
                    meaning: "".into(),
                    context: "".into(),
                    notes: "".into(),
                    examples: vec![],
                    attachments: vec![],
                    source: None,
                },
            })
            .unwrap();
        let MaterialWriteResult::Saved { material, .. } = saved else {
            panic!("Expected admitted Material");
        };
        expected.insert(material.id.0, material.revision);
    }
    let mut selection_query = query(
        CollectionSurface::Material,
        CollectionFilter::All { filters: vec![] },
    );
    selection_query.package_id = None;
    let selected = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "freeze-escaped-revisions".into(),
            source: CollectionSelectionSource::Matching {
                query: selection_query,
            },
        })
        .unwrap();
    assert_eq!(selected.material_count, 65);
    drop(store);

    // When traversing the persisted snapshot after reopening the real store.
    let store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.collection_selection(&selected.id).unwrap(), selected);
    let mut after = None;
    let mut actual = BTreeMap::new();
    for _ in 0..65 {
        let page = store
            .collection_selection_page(&selected.id, after.as_deref())
            .unwrap();

        // Then the complete wire page fits and continuation skips no identity.
        assert!(serde_json::to_vec(&page).unwrap().len() <= 131072);
        assert!(!page.items.is_empty());
        assert!(page.items.len() <= 64);
        if let Some(next) = &page.next {
            let CollectionItemId::Material { id } = &page.items.last().unwrap().item else {
                panic!("Expected frozen Material identity");
            };
            assert_eq!(next, &id.0);
        }
        for entry in page.items {
            assert_eq!(entry.package_id, PACKAGE);
            assert_eq!(entry.package_revision.as_deref(), Some(revision.as_str()));
            let CollectionItemId::Material { id } = entry.item else {
                panic!("Expected frozen Material identity");
            };
            assert!(
                actual
                    .insert(id.0, entry.material_revision.unwrap())
                    .is_none(),
                "Frozen identity was returned more than once"
            );
        }
        after = page.next;
        if after.is_none() {
            break;
        }
    }
    assert!(after.is_none(), "Frozen traversal must terminate");
    assert_eq!(actual, expected);
}

#[test]
fn explicit_selection_rejects_missing_filtered_duplicate_and_wrong_kind_items() {
    // Given a prepared catalog and an explicit selection inside the even scope.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 5);
    let selection_query = query(
        CollectionSurface::Knowledge,
        CollectionFilter::Scope {
            id: format!("{PACKAGE}:even"),
        },
    );
    let target_id = |index| CollectionItemId::Target {
        target_id: format!("entry-{index:03}"),
    };
    let command = |id: &str, items| CollectionSelectionCreate {
        command_id: id.into(),
        source: CollectionSelectionSource::Items {
            query: selection_query.clone(),
            items,
        },
    };

    // When identities are admitted against the native predicate, not trusted renderer rows.
    let selected = store
        .create_collection_selection(&command("explicit", vec![target_id(2), target_id(0)]))
        .unwrap();

    // Then exact membership and package identity persist, while invalid sets are atomic.
    assert_eq!(selected.target_count, 2);
    let page = store.collection_selection_page(&selected.id, None).unwrap();
    assert_eq!(
        page.items
            .iter()
            .map(|row| row.item.clone())
            .collect::<Vec<_>>(),
        vec![target_id(0), target_id(2)]
    );
    assert!(page.items.iter().all(|row| row.package_id == PACKAGE
        && row.package_revision.as_deref() == Some("revision-one")
        && row.material_revision.is_none()));
    for (id, items) in [
        ("filtered", vec![target_id(1)]),
        ("missing", vec![target_id(99)]),
        ("duplicate", vec![target_id(0), target_id(0)]),
        (
            "wrong-kind",
            vec![CollectionItemId::Material {
                id: MaterialId("entry-000".into()),
            }],
        ),
        ("oversized", vec![target_id(0); 257]),
    ] {
        assert!(
            store
                .create_collection_selection(&command(id, items))
                .is_err()
        );
    }
    assert!(matches!(
        store.create_collection_selection(&command("explicit", vec![target_id(4)])),
        Err(StorageError::Invalid(_))
    ));
}

#[test]
fn releasing_selection_frees_capacity_without_resurrecting_retry() {
    // Given eight retained native snapshots, including empty ones.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let command = |index| CollectionSelectionCreate {
        command_id: format!("selection-{index}"),
        source: CollectionSelectionSource::Matching {
            query: query(
                CollectionSurface::Material,
                CollectionFilter::All { filters: vec![] },
            ),
        },
    };
    let mut retained = vec![];
    for index in 0..8 {
        retained.push(store.create_collection_selection(&command(index)).unwrap());
    }
    assert!(store.create_collection_selection(&command(8)).is_err());

    // When an empty snapshot is released and the profile is reopened.
    store.release_collection_selection(&retained[0].id).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();

    // Then capacity returns, released handles fail, and retries cannot select new data.
    assert!(store.collection_selection(&retained[0].id).is_err());
    assert!(
        store
            .collection_selection_page(&retained[0].id, None)
            .is_err()
    );
    assert!(store.create_collection_selection(&command(0)).is_err());
    assert_eq!(store.collection_selections().unwrap().len(), 7);
    assert!(
        store
            .collection_selections()
            .unwrap()
            .iter()
            .all(|item| item.id != retained[0].id)
    );
    assert!(store.create_collection_selection(&command(8)).is_ok());
    store.release_collection_selection(&retained[0].id).unwrap();
}

#[test]
fn selecting_an_incomplete_catalog_or_page_cursor_does_not_freeze_a_prefix() {
    // Given one published row out of a four-row catalog.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite")).unwrap();
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 4)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![target(0)],
                next: Some("next".into()),
                total: 4,
            },
        )
        .unwrap();
    let mut selection_query = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All { filters: vec![] },
    );
    let command = |query| CollectionSelectionCreate {
        command_id: "not-a-prefix".into(),
        source: CollectionSelectionSource::Matching { query },
    };

    // When the incomplete collection or an opaque page cursor is used for selection.
    assert!(
        store
            .create_collection_selection(&command(selection_query.clone()))
            .is_err()
    );
    selection_query.after = Some("cursor".into());

    // Then neither input can establish partial collection membership.
    assert!(
        store
            .create_collection_selection(&command(selection_query))
            .is_err()
    );
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            1,
            Some("next"),
            &CollectionCatalogPage {
                items: (1..4).map(target).collect(),
                next: None,
                total: 4,
            },
        )
        .unwrap();
    let selected = store
        .create_collection_selection(&command(query(
            CollectionSurface::Knowledge,
            CollectionFilter::All { filters: vec![] },
        )))
        .unwrap();
    assert_eq!(selected.target_count, 4);
}

fn level(first: bool) -> InlineLevel {
    InlineLevel {
        scale_id: format!("{PACKAGE}:stage"),
        level: if first { "first" } else { "second" }.into(),
        label: if first { "First stage" } else { "Second stage" }.into(),
        rank: if first { 1 } else { 2 },
        attribution: "Collection test curriculum".into(),
    }
}

fn description() -> CollectionDescription {
    let label = |id: &str| LinguisticLabel {
        id: format!("{PACKAGE}:{id}"),
        label: id.into(),
        color: None,
        attribution: "Collection test curriculum".into(),
    };
    CollectionDescription {
        capabilities: vec![Capability {
            id: format!("{PACKAGE}:meaning"),
            label: "Meaning".into(),
        }],
        kinds: vec![label("lexeme")],
        scopes: vec![label("even"), label("third")],
        levels: vec![level(true), level(false)],
    }
}

fn target(index: u32) -> CollectionTarget {
    let mut scopes = Vec::new();
    if index % 2 == 0 {
        scopes.push(format!("{PACKAGE}:even"));
    }
    if index % 3 == 0 {
        scopes.push(format!("{PACKAGE}:third"));
    }
    CollectionTarget {
        summary: LexicalSummary {
            target_id: format!("entry-{index:03}"),
            headword: format!("Élément {:02}", index / 2),
            reading: None,
            summary: "Collection fixture".into(),
            presentation: Some(LinguisticPresentation {
                readings: vec![],
                labels: vec![],
                contours: vec![],
                levels: Some(vec![level(index < 35)]),
            }),
        },
        kind: format!("{PACKAGE}:lexeme"),
        capabilities: vec![format!("{PACKAGE}:meaning")],
        scopes,
        levels: vec![CollectionLevelMembership {
            scale_id: format!("{PACKAGE}:stage"),
            level: if index < 35 { "first" } else { "second" }.into(),
        }],
        extensions: BTreeMap::from([(
            "org.future:properties".into(),
            serde_json::json!({"schemaVersion": 7, "values": ["unfamiliar", {"x": 3}]}),
        )]),
    }
}

fn catalog(store: &mut ProfileStore, count: u32) {
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), count)
        .unwrap();
    let mut offset = 0;
    let mut cursor = None;
    while offset < count {
        let end = (offset + 64).min(count);
        store
            .put_collection_catalog_page(
                PACKAGE,
                "revision-one",
                offset,
                cursor.as_deref(),
                &CollectionCatalogPage {
                    items: (offset..end).map(target).collect(),
                    next: (end < count).then(|| format!("fixture/{end}")),
                    total: count,
                },
            )
            .unwrap();
        offset = end;
        cursor = (end < count).then(|| format!("fixture/{end}"));
    }
}

fn query(surface: CollectionSurface, filter: CollectionFilter) -> CollectionQuery {
    CollectionQuery {
        package_id: Some(PACKAGE.into()),
        surface,
        filter,
        sort: CollectionSort::Default,
        after: None,
    }
}

fn ready(store: &ProfileStore, query: &CollectionQuery) -> CollectionPage {
    match store.collection(query).unwrap() {
        CollectionResult::Ready { page } => page,
        other => panic!("Expected a prepared collection: {other:?}"),
    }
}

fn save(store: &mut ProfileStore, index: u32) {
    let value = target(index);
    let saved = store
        .create_material(&MaterialCreate {
            command_id: format!("capture-{index}"),
            distinct: false,
            media_imports: vec![],
            content: MaterialContent {
                package_id: PACKAGE.into(),
                target_id: Some(value.summary.target_id),
                package_revision: Some("revision-one".into()),
                sense: Some(LexicalSense {
                    heading: "Fixture".into(),
                    labels: vec![],
                    definitions: vec!["Collection fixture".into()],
                    notes: vec![],
                }),
                phrase: value.summary.headword.to_uppercase(),
                reading: "".into(),
                meaning: "Collection fixture".into(),
                context: "word".into(),
                notes: "".into(),
                examples: vec![],
                attachments: vec![],
                source: Some(SourceAnchor {
                    source_id: if index % 2 == 0 {
                        "source-one"
                    } else {
                        "source-two"
                    }
                    .into(),
                    content_revision: "source-v1".into(),
                    package_id: PACKAGE.into(),
                    package_version: "1".into(),
                    text: "word".into(),
                    locator: SourceLocator::Video {
                        subtitle_revision: Some("subtitle-v1".into()),
                        cue_index: Some(index),
                        selection_start: 0,
                        selection_end: 4,
                        position_ms: index * 1000,
                        subtitle_offset_ms: 0,
                        playback_rate: 1.0,
                    },
                }),
            },
        })
        .unwrap();
    if index == 8 {
        let material = match saved {
            MaterialWriteResult::Saved { material, .. } => material,
            other => panic!("{other:?}"),
        };
        store
            .update_material(&MaterialEdit {
                command_id: "exclude-eight".into(),
                id: material.id,
                expected_revision: material.revision,
                content: material.content,
                excluded: true,
                media_imports: vec![],
            })
            .unwrap();
    }
}

#[test]
fn saved_material_remains_readable_while_catalog_filters_are_preparing() {
    // Given saved content and a partially prepared package, not an empty library.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite")).unwrap();
    save(&mut store, 0);
    save(&mut store, 2);
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 4)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![target(0)],
                next: Some("fixture/1".into()),
                total: 4,
            },
        )
        .unwrap();

    // When browsing that package's saved Material during preparation.
    let page = ready(
        &store,
        &query(
            CollectionSurface::Material,
            CollectionFilter::Text {
                text: "Élément".into(),
            },
        ),
    );

    // Then authored rows stay readable, but metadata predicates cannot count a prefix.
    assert_eq!(page.count, 2);
    assert_eq!(page.items.len(), 2);
    assert!(
        page.items
            .iter()
            .all(|item| matches!(item, CollectionItem::Material { .. }))
    );
    assert_eq!(
        store
            .collection(&query(
                CollectionSurface::Material,
                CollectionFilter::Level {
                    scale_id: format!("{PACKAGE}:stage"),
                    level: "first".into(),
                },
            ))
            .unwrap(),
        CollectionResult::Preparing {
            processed: 1,
            total: 4
        },
    );
}

#[test]
fn catalog_resume_is_atomic_and_preserves_namespaced_metadata() {
    // Given an interrupted catalog with one committed page.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![target(0)],
                next: Some("lemma/漢字:2".into()),
                total: 2,
            },
        )
        .unwrap();
    let all = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All { filters: vec![] },
    );
    assert!(matches!(
        store.collection(&all).unwrap(),
        CollectionResult::Preparing {
            processed: 1,
            total: 2
        }
    ));
    let mut malformed = target(1);
    malformed.capabilities.push("other.package:injected".into());
    assert!(
        store
            .put_collection_catalog_page(
                PACKAGE,
                "revision-one",
                1,
                Some("lemma/漢字:2"),
                &CollectionCatalogPage {
                    items: vec![malformed],
                    next: None,
                    total: 2,
                }
            )
            .is_err()
    );
    drop(store);
    // When the real owner resumes after restart.
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
            .unwrap(),
        (1, Some("lemma/漢字:2".into()))
    );
    assert!(matches!(
        store.put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            1,
            Some("wrong/cursor"),
            &CollectionCatalogPage {
                items: vec![target(1)],
                next: None,
                total: 2
            }
        ),
        Err(StorageError::Conflict)
    ));
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            1,
            Some("lemma/漢字:2"),
            &CollectionCatalogPage {
                items: vec![target(1)],
                next: None,
                total: 2,
            },
        )
        .unwrap();
    // Then only the valid page is published and unfamiliar data is unchanged.
    let page = ready(&store, &all);
    assert_eq!(page.count, 2);
    assert_eq!(page.items.len(), 2);
    match &page.items[1] {
        CollectionItem::Target {
            target: actual,
            knowledge,
            material_count,
        } => {
            assert_eq!(actual, &target(1));
            assert_eq!(*material_count, 0);
            assert_eq!(knowledge[0].status, "untracked");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn metadata_only_catalog_targets_resume_without_implicit_knowledge() {
    // Given an interrupted catalog and a source target without learning capabilities.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![target(0)],
                next: Some("fixture/1".into()),
                total: 2,
            },
        )
        .unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
            .unwrap(),
        (1, Some("fixture/1".into()))
    );
    let mut metadata = target(1);
    metadata.capabilities.clear();

    // When the resumed publisher admits the metadata-only final page.
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            1,
            Some("fixture/1"),
            &CollectionCatalogPage {
                items: vec![metadata.clone()],
                next: None,
                total: 2,
            },
        )
        .unwrap();
    drop(store);

    // Then restart preserves browsable metadata without inventing learner keys.
    let store = ProfileStore::open(&path).unwrap();
    let all = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All { filters: vec![] },
    );
    let page = ready(&store, &all);
    assert_eq!((page.count, page.items.len()), (2, 2));
    match &page.items[1] {
        CollectionItem::Target {
            target,
            knowledge,
            material_count,
        } => {
            assert_eq!(target, &metadata);
            assert!(knowledge.is_empty());
            assert_eq!(*material_count, 0);
        }
        CollectionItem::Material { .. } => panic!("Expected catalog target"),
    }
    let tracked = ready(
        &store,
        &query(
            CollectionSurface::Knowledge,
            CollectionFilter::Capability {
                capability: format!("{PACKAGE}:meaning"),
                states: vec![CollectionKnowledgeState::Untracked],
            },
        ),
    );
    assert_eq!((tracked.count, tracked.items.len()), (1, 1));
    assert!(matches!(
        &tracked.items[0],
        CollectionItem::Target { target, knowledge, .. }
            if target.summary.target_id == "entry-000" && knowledge.len() == 1
    ));
}

#[test]
fn catalog_extension_fields_preserve_native_byte_bounded_contract_after_reopen() {
    // Given an admitted target with 33 small namespaced extension fields.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let mut expected = target(0);
    expected.extensions = (0..33)
        .map(|index| {
            (
                format!("{PACKAGE}:field-{index:02}"),
                serde_json::json!(index),
            )
        })
        .collect();
    assert!(serde_json::to_vec(&expected).unwrap().len() <= 16384);
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 1)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![expected.clone()],
                next: None,
                total: 1,
            },
        )
        .unwrap();
    drop(store);

    // When the native collection is read after reopening.
    let store = ProfileStore::open(&path).unwrap();
    let page = ready(
        &store,
        &query(
            CollectionSurface::Knowledge,
            CollectionFilter::All { filters: vec![] },
        ),
    );

    // Then every field survives without an additional key-count restriction.
    assert_eq!((page.count, page.items.len()), (1, 1));
    let CollectionItem::Target { target, .. } = &page.items[0] else {
        panic!("Expected catalog target");
    };
    assert_eq!(target.extensions.len(), 33);
    assert_eq!(target, &expected);
}

#[test]
fn level_filters_use_all_source_memberships_not_only_inline_display() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let mut both = target(0);
    both.levels.push(CollectionLevelMembership {
        scale_id: format!("{PACKAGE}:stage"),
        level: "second".into(),
    });
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![both.clone(), target(1)],
                next: None,
                total: 2,
            },
        )
        .unwrap();
    save(&mut store, 0);
    let mut selection = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All {
            filters: vec![
                CollectionFilter::Level {
                    scale_id: format!("{PACKAGE}:stage"),
                    level: "second".into(),
                },
                CollectionFilter::Scope {
                    id: format!("{PACKAGE}:even"),
                },
            ],
        },
    );
    let page = ready(&store, &selection);
    assert_eq!(page.count, 1);
    match &page.items[0] {
        CollectionItem::Target { target, .. } => {
            assert_eq!(target, &both);
            assert_eq!(
                target
                    .summary
                    .presentation
                    .as_ref()
                    .unwrap()
                    .levels
                    .as_ref()
                    .unwrap(),
                &vec![level(true)]
            );
        }
        other => panic!("{other:?}"),
    }
    selection.surface = CollectionSurface::Material;
    assert_eq!(ready(&store, &selection).count, 1);
    let mut invalid = target(0);
    invalid.levels[0].level = "undeclared".into();
    store
        .begin_collection_catalog(PACKAGE, "revision-two", &description(), 1)
        .unwrap();
    assert!(
        store
            .put_collection_catalog_page(
                PACKAGE,
                "revision-two",
                0,
                None,
                &CollectionCatalogPage {
                    items: vec![invalid],
                    next: None,
                    total: 1
                }
            )
            .is_err()
    );
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-two", &description(), 1)
            .unwrap(),
        (0, None)
    );
}

#[test]
fn opaque_catalog_progress_rejects_stalls_and_replayed_pages_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    store
        .begin_collection_catalog(PACKAGE, "revision-one", &description(), 3)
        .unwrap();
    let first = CollectionCatalogPage {
        items: vec![target(0)],
        next: Some("opaque/甲:7".into()),
        total: 3,
    };
    store
        .put_collection_catalog_page(PACKAGE, "revision-one", 0, None, &first)
        .unwrap();
    let stalled = CollectionCatalogPage {
        items: vec![target(1)],
        next: first.next.clone(),
        total: 3,
    };
    assert!(
        store
            .put_collection_catalog_page(
                PACKAGE,
                "revision-one",
                1,
                first.next.as_deref(),
                &stalled
            )
            .is_err()
    );
    assert!(matches!(
        store.put_collection_catalog_page(PACKAGE, "revision-one", 0, None, &first),
        Err(StorageError::Conflict)
    ));
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-one", &description(), 3)
            .unwrap(),
        (1, first.next.clone())
    );
    let second = CollectionCatalogPage {
        items: vec![target(1)],
        next: Some("opaque/乙:19".into()),
        total: 3,
    };
    store
        .put_collection_catalog_page(PACKAGE, "revision-one", 1, first.next.as_deref(), &second)
        .unwrap();
    store
        .put_collection_catalog_page(
            PACKAGE,
            "revision-one",
            2,
            second.next.as_deref(),
            &CollectionCatalogPage {
                items: vec![target(2)],
                next: None,
                total: 3,
            },
        )
        .unwrap();
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-one", &description(), 3)
            .unwrap(),
        (3, None)
    );
    assert_eq!(
        ready(
            &store,
            &query(
                CollectionSurface::Knowledge,
                CollectionFilter::All { filters: vec![] }
            )
        )
        .count,
        3
    );
}

#[test]
fn schema_twelve_catalog_rebuild_preserves_material_claims_and_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    catalog(&mut store, 2);
    save(&mut store, 0);
    let claim = ClaimChange {
        command_id: "retained-catalog-claim".into(),
        key: KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: "entry-000".into(),
            capability: format!("{PACKAGE}:meaning"),
        },
        claim: Some(true),
    };
    let projection = store.change_claim(&claim).unwrap();
    let material_query = MaterialQuery {
        after: None,
        query: String::new(),
        source_id: None,
        include_excluded: false,
    };
    let materials = store.materials(&material_query).unwrap().items;
    let preferences = store.preferences().unwrap();
    drop(store);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(
        "ALTER TABLE collection_catalogs DROP COLUMN package_cursor; PRAGMA user_version=12;",
    )
    .unwrap();
    drop(db);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.materials(&material_query).unwrap().items, materials);
    assert_eq!(store.change_claim(&claim).unwrap(), projection);
    assert_eq!(store.preferences().unwrap(), preferences);
    assert_eq!(
        store
            .begin_collection_catalog(PACKAGE, "revision-one", &description(), 2)
            .unwrap(),
        (0, None)
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        19
    );
}

#[test]
fn compound_counts_match_membership_on_both_surfaces() {
    // Given overlapping curriculum groups, independent claims and saved sources.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 70);
    for index in 0..=12 {
        save(&mut store, index);
        if index % 4 < 2 {
            store
                .change_claim(&ClaimChange {
                    command_id: format!("claim-{index}"),
                    key: KnowledgeKey {
                        package_id: PACKAGE.into(),
                        target_id: format!("entry-{index:03}"),
                        capability: format!("{PACKAGE}:meaning"),
                    },
                    claim: Some(index % 4 == 1),
                })
                .unwrap();
        }
    }
    let filter = CollectionFilter::All {
        filters: vec![
            CollectionFilter::Any {
                filters: vec![
                    CollectionFilter::Scope {
                        id: format!("{PACKAGE}:even"),
                    },
                    CollectionFilter::Scope {
                        id: format!("{PACKAGE}:third"),
                    },
                ],
            },
            CollectionFilter::Level {
                scale_id: format!("{PACKAGE}:stage"),
                level: "first".into(),
            },
            CollectionFilter::Capability {
                capability: format!("{PACKAGE}:meaning"),
                states: vec![
                    CollectionKnowledgeState::ClaimedUnknown,
                    CollectionKnowledgeState::Untracked,
                ],
            },
            CollectionFilter::Source {
                source_id: "source-one".into(),
            },
            CollectionFilter::Material {
                state: CollectionMaterialState::NotExcluded,
            },
            CollectionFilter::Not {
                filter: Box::new(CollectionFilter::Text {
                    text: "élément 02".into(),
                }),
            },
        ],
    };
    // When the identical native predicate selects Knowledge and Material.
    let expected = [
        "entry-000",
        "entry-002",
        "entry-006",
        "entry-010",
        "entry-012",
    ];
    for surface in [CollectionSurface::Knowledge, CollectionSurface::Material] {
        let page = ready(&store, &query(surface, filter.clone()));
        let actual = page
            .items
            .iter()
            .map(|item| match item {
                CollectionItem::Target { target, .. } => target.summary.target_id.clone(),
                CollectionItem::Material { material, .. } => {
                    material.content.target_id.clone().unwrap()
                }
            })
            .collect::<BTreeSet<_>>();
        // Then overlap is deduplicated and count and rows have identical meaning.
        assert_eq!(page.count, 5);
        assert_eq!(actual, expected.iter().map(|id| id.to_string()).collect());
    }
}

#[test]
fn negated_source_and_kind_filters_include_unlinked_material() {
    // Given source-linked entries and independently authored source-free content.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 2);
    save(&mut store, 0);
    save(&mut store, 1);
    let saved = store
        .create_material(&MaterialCreate {
            command_id: "source-free-material".into(),
            distinct: false,
            media_imports: vec![],
            content: MaterialContent {
                package_id: PACKAGE.into(),
                target_id: None,
                package_revision: None,
                sense: None,
                phrase: "Independent phrase".into(),
                reading: "".into(),
                meaning: "Authored without a catalog target or source".into(),
                context: "".into(),
                notes: "".into(),
                examples: vec![],
                attachments: vec![],
                source: None,
            },
        })
        .unwrap();
    let id = match saved {
        MaterialWriteResult::Saved { material, .. } => material.id,
        other => panic!("{other:?}"),
    };
    // When ordinary source and entity-kind predicates are negated.
    let pages = [
        CollectionFilter::Source {
            source_id: "source-one".into(),
        },
        CollectionFilter::EntityKind {
            id: format!("{PACKAGE}:lexeme"),
        },
    ]
    .map(|filter| {
        ready(
            &store,
            &query(
                CollectionSurface::Material,
                CollectionFilter::Not {
                    filter: Box::new(filter),
                },
            ),
        )
    });
    // Then absence is a non-match, so negation includes it with exact counts.
    assert_eq!(pages.each_ref().map(|page| page.count), [2, 1]);
    for page in pages {
        assert_eq!(page.items.len(), page.count as usize);
        assert!(page.items.iter().any(|item| matches!(item,
            CollectionItem::Material { material, .. } if material.id == id)));
    }
}

#[test]
fn tied_sort_pages_are_bounded_and_reject_changed_membership() {
    // Given more than two pages with repeated display labels.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 70);
    let mut selection = query(
        CollectionSurface::Knowledge,
        CollectionFilter::All { filters: vec![] },
    );
    selection.sort = CollectionSort::LabelAscending;
    let first = ready(&store, &selection);
    let mut ids = BTreeSet::new();
    // When every cursor is followed, under one unchanged native revision.
    for _ in 0..4 {
        let page = ready(&store, &selection);
        assert!(page.items.len() <= 24);
        assert!(serde_json::to_vec(&page).unwrap().len() <= 262144);
        assert_eq!(page.count, 70);
        for item in page.items {
            match item {
                CollectionItem::Target { target, .. } => {
                    assert!(ids.insert(target.summary.target_id))
                }
                other => panic!("{other:?}"),
            }
        }
        selection.after = page.next;
        if selection.after.is_none() {
            break;
        }
    }
    // Then no tied entry is lost or repeated.
    assert_eq!(ids.len(), 70);
    assert!(selection.after.is_none());
    store
        .change_claim(&ClaimChange {
            command_id: "change-during-page".into(),
            key: KnowledgeKey {
                package_id: PACKAGE.into(),
                target_id: "entry-000".into(),
                capability: format!("{PACKAGE}:meaning"),
            },
            claim: Some(true),
        })
        .unwrap();
    selection.after = first.next;
    assert!(matches!(
        store.collection(&selection),
        Err(StorageError::Conflict)
    ));
}

#[test]
fn material_bookmark_refresh_preserves_the_window_without_weakening_continuation() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 52);
    for index in 0..52 {
        save(&mut store, index);
    }
    let mut browse = query(
        CollectionSurface::Material,
        CollectionFilter::All { filters: vec![] },
    );
    browse.sort = CollectionSort::LabelAscending;
    browse.after = ready(&store, &browse).next;
    let original = ready(&store, &browse);
    let CollectionItem::Material { material, .. } = &original.items[0] else {
        panic!("Expected authored Material");
    };
    let mut content = material.content.clone();
    content.notes = "A durable edit in the originating window".into();
    store
        .update_material(&MaterialEdit {
            command_id: "edit-window".into(),
            id: material.id.clone(),
            expected_revision: material.revision,
            content,
            excluded: false,
            media_imports: vec![],
        })
        .unwrap();
    assert!(matches!(
        store.collection(&browse),
        Err(StorageError::Conflict)
    ));
    let CollectionResult::Ready { page: refreshed } =
        store.refresh_material_collection(&browse).unwrap()
    else {
        panic!("Expected the native refreshed window");
    };
    assert_eq!(refreshed.count, 52);
    assert_eq!(refreshed.items.len(), 24);
    assert!(serde_json::to_vec(&refreshed).unwrap().len() <= 262144);
    for (before, after) in original.items.iter().zip(&refreshed.items) {
        let (
            CollectionItem::Material {
                material: before, ..
            },
            CollectionItem::Material {
                material: after, ..
            },
        ) = (before, after)
        else {
            panic!("Expected only Material");
        };
        assert_eq!(before.id, after.id);
    }
    let CollectionItem::Material {
        material: edited, ..
    } = &refreshed.items[0]
    else {
        panic!("Expected edited Material");
    };
    assert_eq!(edited.revision, material.revision + 1);
    assert_eq!(
        edited.content.notes,
        "A durable edit in the originating window"
    );
    let mut following = browse.clone();
    following.after = refreshed.next;
    assert_eq!(ready(&store, &following).items.len(), 4);

    let mut foreign_query = browse.clone();
    foreign_query.sort = CollectionSort::LabelDescending;
    assert!(matches!(
        store.refresh_material_collection(&foreign_query),
        Err(StorageError::Conflict)
    ));
    let mut knowledge = browse.clone();
    knowledge.surface = CollectionSurface::Knowledge;
    assert!(matches!(
        store.refresh_material_collection(&knowledge),
        Err(StorageError::Invalid(_))
    ));
    store
        .change_claim(&ClaimChange {
            command_id: "change-window-knowledge".into(),
            key: KnowledgeKey {
                package_id: PACKAGE.into(),
                target_id: "entry-000".into(),
                capability: format!("{PACKAGE}:meaning"),
            },
            claim: Some(true),
        })
        .unwrap();
    assert!(matches!(
        store.refresh_material_collection(&browse),
        Err(StorageError::Conflict)
    ));
    browse.after = None;
    browse.after = ready(&store, &browse).next;
    store.evict_collection_catalog(PACKAGE).unwrap();
    assert!(matches!(
        store.refresh_material_collection(&browse),
        Err(StorageError::Conflict)
    ));
}

#[test]
fn unsupported_scope_is_not_broadened_by_negation() {
    // Given an installed catalog without the requested group.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 2);
    // When an unavailable scope occurs inside a negation.
    let selection = query(
        CollectionSurface::Knowledge,
        CollectionFilter::Not {
            filter: Box::new(CollectionFilter::Scope {
                id: format!("{PACKAGE}:withdrawn"),
            }),
        },
    );
    // Then it is unresolved, not substituted by the entire catalog.
    assert!(matches!(
        store.collection(&selection),
        Err(StorageError::Invalid(_))
    ));
}

#[test]
fn catalog_eviction_preserves_saved_content_and_learner_state() {
    // Given independent authored Material, a claim and a rebuildable catalog.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 2);
    save(&mut store, 0);
    let key = KnowledgeKey {
        package_id: PACKAGE.into(),
        target_id: "entry-000".into(),
        capability: format!("{PACKAGE}:meaning"),
    };
    store
        .change_claim(&ClaimChange {
            command_id: "claim-before-eviction".into(),
            key: key.clone(),
            claim: Some(false),
        })
        .unwrap();
    let material_query = query(
        CollectionSurface::Material,
        CollectionFilter::Text {
            text: "élément".into(),
        },
    );
    let before = ready(&store, &material_query);
    // When optional package metadata is evicted.
    store.evict_collection_catalog(PACKAGE).unwrap();
    let after = ready(&store, &material_query);
    // Then saved text remains readable without fabricated target metadata.
    assert_eq!(after.count, 1);
    assert_eq!(after.package_revision, None);
    match (&before.items[0], &after.items[0]) {
        (
            CollectionItem::Material {
                material: before, ..
            },
            CollectionItem::Material {
                material: after,
                target,
                knowledge,
            },
        ) => {
            assert_eq!(before, after);
            assert_eq!(target, &None);
            assert!(knowledge.is_empty());
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        store.knowledge(&[key]).unwrap()[0].status,
        "claimed_unknown"
    );
    assert_eq!(store.collection_description(PACKAGE).unwrap(), None);
    assert!(matches!(
        store
            .collection(&query(
                CollectionSurface::Knowledge,
                CollectionFilter::All { filters: vec![] },
            ))
            .unwrap(),
        CollectionResult::Unavailable { .. }
    ));
}

#[test]
fn material_browse_can_keep_all_languages_without_broadening_package_filters() {
    // Given saved content from two packages, including one without metadata.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    catalog(&mut store, 2);
    save(&mut store, 0);
    let first = store
        .materials(&MaterialQuery {
            after: None,
            query: String::new(),
            source_id: None,
            include_excluded: false,
        })
        .unwrap()
        .items
        .remove(0);
    let mut content = first.content;
    content.package_id = "other.language".into();
    content.target_id = None;
    content.package_revision = None;
    content.sense = None;
    content.source = None;
    store
        .create_material(&MaterialCreate {
            command_id: "other-language".into(),
            distinct: true,
            media_imports: vec![],
            content,
        })
        .unwrap();
    // When Browse has no language restriction, then explicitly selects one.
    let mut selection = query(
        CollectionSurface::Material,
        CollectionFilter::All { filters: vec![] },
    );
    selection.package_id = None;
    let all = ready(&store, &selection);
    selection.package_id = Some("other.language".into());
    let scoped = ready(&store, &selection);
    // Then all-language membership and the scoped count remain distinct.
    assert_eq!(all.count, 2);
    assert_eq!(scoped.count, 1);
    let packages = all
        .items
        .into_iter()
        .map(|item| match item {
            CollectionItem::Material { material, .. } => material.content.package_id,
            other => panic!("{other:?}"),
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        packages,
        BTreeSet::from([PACKAGE.into(), "other.language".into()])
    );
    match &scoped.items[0] {
        CollectionItem::Material {
            material,
            target,
            knowledge,
        } => {
            assert_eq!(material.content.package_id, "other.language");
            assert_eq!(target, &None);
            assert!(knowledge.is_empty());
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn legacy_search_index_is_normalized_without_rewriting_material() {
    // Given the pre-M10 search representation and unchanged authored content.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    save(&mut store, 0);
    let mut search = MaterialQuery {
        after: None,
        query: String::new(),
        source_id: Some("source-one".into()),
        include_excluded: false,
    };
    let original = store.materials(&search).unwrap().items.remove(0);
    drop(store);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE materials SET search_text=?2 WHERE id=?1",
        rusqlite::params![original.id.0, original.content.phrase],
    )
    .unwrap();
    db.pragma_update(None, "user_version", 11).unwrap();
    drop(db);
    // When startup rebuilds the old index and a differently cased query runs.
    let store = ProfileStore::open(&path).unwrap();
    search.query = "élément".into();
    let lower = store.materials(&search).unwrap();
    search.query = "ÉLÉMENT".into();
    let upper = store.materials(&search).unwrap();
    // Then both Unicode casings find the same unchanged authored item.
    assert_eq!(lower.items, vec![original.clone()]);
    assert_eq!(upper.items, vec![original]);
}

#[test]
fn due_sort_preserves_numeric_and_missing_membership_across_pages() {
    // Given real saved Material and serialized schedules spanning a page boundary.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    catalog(&mut store, 70);
    for index in 0..32 {
        save(&mut store, index);
    }
    let db = rusqlite::Connection::open(&path).unwrap();
    for index in 0..30 {
        let id: String = db
            .query_row(
                "SELECT id FROM materials WHERE package_id=?1 AND target_id=?2",
                rusqlite::params![PACKAGE, format!("entry-{index:03}")],
                |row| row.get(0),
            )
            .unwrap();
        let schedule = ReviewSchedule {
            due_at: i64::from(index) * 1000,
            interval_seconds: 60,
            revision: 1,
            owner_attempt: None,
        };
        db.execute(
            "INSERT INTO review_schedules VALUES(?1,'written',?2)",
            rusqlite::params![id, serde_json::to_string(&schedule).unwrap()],
        )
        .unwrap();
    }
    drop(db);
    // When ascending and descending due cursors cross both numeric and NULL rows.
    for sort in [CollectionSort::DueAscending, CollectionSort::DueDescending] {
        let mut selection = query(
            CollectionSurface::Knowledge,
            CollectionFilter::All { filters: vec![] },
        );
        selection.sort = sort;
        let mut actual = Vec::new();
        for _ in 0..4 {
            let page = ready(&store, &selection);
            assert_eq!(page.count, 70);
            for item in page.items {
                match item {
                    CollectionItem::Target { target, .. } => actual.push(target.summary.target_id),
                    other => panic!("{other:?}"),
                }
            }
            selection.after = page.next;
            if selection.after.is_none() {
                break;
            }
        }
        let mut scheduled = (0..30).filter(|index| *index != 8).collect::<Vec<_>>();
        let mut missing = (0..70)
            .filter(|index| *index >= 30 || *index == 8)
            .collect::<Vec<_>>();
        if sort == CollectionSort::DueDescending {
            scheduled.reverse();
            missing.reverse();
        }
        let expected = scheduled
            .into_iter()
            .chain(missing)
            .map(|index| format!("entry-{index:03}"))
            .collect::<Vec<_>>();
        // Then excluded/unmeasured targets stay present but do not gain a due date.
        assert_eq!(actual, expected);
        assert!(selection.after.is_none());
    }
}
