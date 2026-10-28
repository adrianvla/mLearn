#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::ProfileStore;
use support::*;

#[test]
fn removed_material_does_not_retire_admitted_audio_or_source_continuity() {
    // Given an active audio encounter which owns its admitted content and bytes.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let asset = AuthoredMedia {
        id: AuthoredMediaId("admitted-audio".into()),
        kind: MaterialMediaKind::Audio,
        name: "clip".into(),
        mime_type: "audio/wav".into(),
        byte_length: 123,
    };
    store.register_authored_media(&asset).unwrap();
    let mut item = admission(&mut store, "audio-card");
    let material = store.material(&item.material_id).unwrap();
    let mut content = material.content;
    content.attachments.push(MaterialAttachment {
        media_id: asset.id.clone(),
        segment: None,
        audio_binding: None,
    });
    store
        .update_material(&MaterialEdit {
            command_id: "attach-audio".into(),
            id: item.material_id.clone(),
            expected_revision: material.revision,
            content,
            excluded: false,
            media_imports: vec![],
        })
        .unwrap();
    item.material_revision += 1;
    item.probe.direction = ReviewDirection::Audio;
    item.probe.required_media = Some(asset.id.clone());
    let session = start(
        &mut store,
        "audio-session",
        &[item.clone()],
        ReviewMode::Continuous,
    );

    // When the final authored reference is removed and the profile restarts.
    store
        .remove_material(&MaterialRemove {
            command_id: "remove-audio-card".into(),
            id: item.material_id.clone(),
            expected_revision: item.material_revision,
        })
        .unwrap();
    drop(store);
    let store = ProfileStore::open(&path).unwrap();

    // Then the exact admitted encounter/source and required bytes remain recoverable.
    assert_eq!(store.review_session(&session.id).unwrap(), session);
    assert_eq!(store.authored_media(&asset.id).unwrap(), asset);
    assert!(store.unreferenced_authored_media(128).unwrap().is_empty());
    assert!(matches!(
        store.forget_authored_media(&asset.id),
        Err(mlearn_storage::StorageError::Conflict)
    ));
    assert!(store.material(&item.material_id).is_err());
}

#[test]
fn pause_interrupts_only_nonterminal_audio_and_resume_retains_exact_conditions() {
    for delivery in [
        ReviewDelivery::Pending,
        ReviewDelivery::Started,
        ReviewDelivery::Completed,
        ReviewDelivery::Interrupted,
        ReviewDelivery::Failed,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile");
        let mut store = ProfileStore::open(&path).unwrap();
        let mut item = admission(&mut store, "audio");
        item.probe.direction = ReviewDirection::Audio;
        item.probe.required_media = Some(AuthoredMediaId("audio".into()));
        let mut session = start(&mut store, "s", &[item], ReviewMode::Continuous);
        let encounter_id = session.encounter.as_ref().unwrap().id.clone();
        if matches!(
            delivery,
            ReviewDelivery::Started | ReviewDelivery::Completed
        ) {
            session = store
                .review_apply(
                    &ReviewCommand::Delivery {
                        mutation: mutation(&session, "started"),
                        encounter_id: encounter_id.clone(),
                        delivery: ReviewDelivery::Started,
                    },
                    100,
                )
                .unwrap()
                .session;
        }
        if delivery != ReviewDelivery::Pending && delivery != ReviewDelivery::Started {
            session = store
                .review_apply(
                    &ReviewCommand::Delivery {
                        mutation: mutation(&session, "terminal"),
                        encounter_id: encounter_id.clone(),
                        delivery,
                    },
                    100,
                )
                .unwrap()
                .session;
        }
        let mut expected = session.encounter.clone().unwrap();
        if matches!(delivery, ReviewDelivery::Pending | ReviewDelivery::Started) {
            expected.conditions.delivery = ReviewDelivery::Interrupted;
        }
        let pause = ReviewCommand::Pause {
            mutation: mutation(&session, "pause"),
        };
        let paused = store.review_apply(&pause, 101).unwrap().session;
        assert_eq!(paused.state, ReviewSessionState::Paused);
        assert_eq!(paused.encounter.as_ref(), Some(&expected));
        assert_eq!(store.review_apply(&pause, 102).unwrap().session, paused);
        drop(store);
        let mut reopened = ProfileStore::open(&path).unwrap();
        let resumed = reopened
            .review_apply(
                &ReviewCommand::Resume {
                    mutation: mutation(&paused, "resume"),
                },
                103,
            )
            .unwrap()
            .session;
        assert_eq!(resumed.state, ReviewSessionState::Active);
        assert_eq!(resumed.encounter.as_ref(), Some(&expected));
    }
}

#[test]
fn audio_replay_and_assistance_never_become_unassisted_assessment() {
    // Given an audio encounter whose actual delivery is interrupted then replayed.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let mut item = admission(&mut store, "audio");
    item.probe.direction = ReviewDirection::Audio;
    item.probe.required_media = Some(AuthoredMediaId("audio".into()));
    let mut session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    for (index, delivery) in [
        ReviewDelivery::Started,
        ReviewDelivery::Interrupted,
        ReviewDelivery::Pending,
        ReviewDelivery::Started,
        ReviewDelivery::Completed,
    ]
    .into_iter()
    .enumerate()
    {
        session = store
            .review_apply(
                &ReviewCommand::Delivery {
                    mutation: mutation(&session, &format!("delivery-{index}")),
                    encounter_id: session.encounter.as_ref().unwrap().id.clone(),
                    delivery,
                },
                100,
            )
            .unwrap()
            .session;
    }
    assert_eq!(
        session
            .encounter
            .as_ref()
            .unwrap()
            .conditions
            .exposure_count,
        2
    );
    assert!(
        session
            .encounter
            .as_ref()
            .unwrap()
            .conditions
            .assistance
            .contains(&ReviewAssistance::RepeatedExposure)
    );
    let session = reveal(&mut store, &session, "reveal");
    // When the learner self-reports Fluent after replay.
    submit(&mut store, &session, "submit");
    // Then the schedule changes, but replay never establishes independent assessment.
    assert!(schedule(&store, &item).is_some());
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        None
    );
}

#[test]
fn mixed_untested_worked_out_and_failed_delivery_remain_distinct() {
    // Given ordinary retrospective self-report under failed required delivery.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let mut item = admission(&mut store, "audio");
    item.probe.direction = ReviewDirection::Audio;
    item.probe.required_media = Some(AuthoredMediaId("audio".into()));
    let session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Finite { limit: 1 },
    );
    let session = store
        .review_apply(
            &ReviewCommand::Delivery {
                mutation: mutation(&session, "failed"),
                encounter_id: session.encounter.as_ref().unwrap().id.clone(),
                delivery: ReviewDelivery::Failed,
            },
            100,
        )
        .unwrap()
        .session;
    let session = reveal(&mut store, &session, "reveal");
    let mut report = response(&session, Some(AttemptQuality::Fluent));
    report.grades[0].method = ResponseMethod::WorkedOut;
    report.grades[1].quality = None;
    // When mixed outcomes are committed.
    let session = store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, "submit"),
                response: report,
            },
            102,
        )
        .unwrap()
        .session;
    // Then completion is honest about delivery and no untested capability is assessed.
    assert_eq!(session.state, ReviewSessionState::Complete);
    assert_eq!(
        store
            .knowledge(&[key("meaning"), key("reading")])
            .unwrap()
            .iter()
            .map(|p| p.assessed)
            .collect::<Vec<_>>(),
        vec![None, None]
    );
    assert!(schedule(&store, &item).is_some());
}

#[test]
fn unfinished_disclosure_survives_switching_sessions_and_due_races_rollback() {
    // Given one revealed unfinished task and another session on the same material.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let item = admission(&mut store, "one");
    let original = start(
        &mut store,
        "one",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    let original = reveal(&mut store, &original, "original-reveal");
    let peer = start(
        &mut store,
        "peer",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    assert!(
        peer.encounter
            .as_ref()
            .unwrap()
            .conditions
            .assistance
            .contains(&ReviewAssistance::PriorDisclosure)
    );
    let peer = reveal(&mut store, &peer, "peer-reveal");
    submit(&mut store, &peer, "peer-submit");
    // When a stale prepared candidate tries to start after the peer updates its schedule.
    let start = ReviewStart {
        command_id: "stale-start".into(),
        session_id: ReviewSessionId("stale".into()),
        mode: ReviewMode::Continuous,
    };
    assert!(
        store
            .review_start(&start, std::slice::from_ref(&item), 102)
            .is_err()
    );
    // Then no receipt/session appears and the existing unfinished task remains exact.
    assert!(
        store
            .review_receipt(&ReviewCommand::Start { start })
            .unwrap()
            .is_none()
    );
    assert_eq!(store.review_sessions().unwrap().len(), 2);
    assert_eq!(store.review_session(&original.id).unwrap(), original);
    assert!(schedule(&store, &item).is_some());
}
