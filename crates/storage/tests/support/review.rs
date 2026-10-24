use mlearn_core::*;
use mlearn_storage::ProfileStore;

pub fn key(capability: &str) -> KnowledgeKey {
    KnowledgeKey {
        package_id: "package".into(),
        target_id: "stable".into(),
        capability: capability.into(),
    }
}

pub fn practice(items: &[ReviewAdmission]) -> ReviewMode {
    ReviewMode::Practice {
        items: items
            .iter()
            .map(|item| PracticeItem {
                material_id: item.material_id.clone(),
                source: item.source.clone(),
            })
            .collect(),
    }
}

pub fn admission(store: &mut ProfileStore, command: &str) -> ReviewAdmission {
    let result = store
        .create_material(&MaterialCreate {
            command_id: command.into(),
            distinct: true,
            media_imports: vec![],
            content: MaterialContent {
                package_id: "package".into(),
                target_id: Some("stable".into()),
                package_revision: Some("revision".into()),
                sense: None,
                phrase: command.into(),
                reading: "".into(),
                meaning: "answer".into(),
                context: "".into(),
                notes: "".into(),
                examples: vec![],
                source: None,
                attachments: vec![],
            },
        })
        .unwrap();
    let material = match result {
        MaterialWriteResult::Saved { material, .. } => material,
        other => panic!("{other:?}"),
    };
    ReviewAdmission {
        work_id: ReviewWorkId(format!("work-{command}")),
        material_id: material.id,
        material_revision: 1,
        package_id: "package".into(),
        package_version: "1".into(),
        package_revision: "revision".into(),
        scheduler_version: REVIEW_POLICY_VERSION,
        source: Some(SourceAnchor {
            source_id: "source".into(),
            content_revision: "source-v1".into(),
            package_id: "package".into(),
            package_version: "1".into(),
            text: "original".into(),
            locator: SourceLocator::Video {
                subtitle_revision: Some("sub-v1".into()),
                cue_index: Some(2),
                selection_start: 0,
                selection_end: 8,
                position_ms: 2300,
                subtitle_offset_ms: 10,
                playback_rate: 1.0,
            },
        }),
        probe: ReviewProbe {
            id: "written".into(),
            contract_version: 1,
            direction: ReviewDirection::Written,
            cue: command.into(),
            answer: "answer".into(),
            targets: vec![
                ReviewTarget {
                    id: "meaning".into(),
                    label: "Meaning".into(),
                    mnemonic: None,
                    key: Some(key("meaning")),
                },
                ReviewTarget {
                    id: "reading".into(),
                    label: "Reading".into(),
                    mnemonic: None,
                    key: Some(key("reading")),
                },
            ],
            supplied: vec![],
            required_media: None,
        },
    }
}

pub fn start(
    store: &mut ProfileStore,
    id: &str,
    items: &[ReviewAdmission],
    mode: ReviewMode,
) -> ReviewSession {
    store
        .review_start(
            &ReviewStart {
                command_id: format!("start-{id}"),
                session_id: ReviewSessionId(id.into()),
                mode,
            },
            items,
            100,
        )
        .unwrap()
        .session
}

pub fn mutation(session: &ReviewSession, id: &str) -> ReviewMutation {
    ReviewMutation {
        command_id: id.into(),
        session_id: session.id.clone(),
        expected_revision: session.revision,
    }
}

pub fn reveal(store: &mut ProfileStore, session: &ReviewSession, id: &str) -> ReviewSession {
    store
        .review_apply(
            &ReviewCommand::Reveal {
                mutation: mutation(session, id),
                encounter_id: session.encounter.as_ref().unwrap().id.clone(),
            },
            101,
        )
        .unwrap()
        .session
}

pub fn response(session: &ReviewSession, quality: Option<AttemptQuality>) -> ReviewResponse {
    ReviewResponse {
        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
        grades: session
            .encounter
            .as_ref()
            .unwrap()
            .targets
            .iter()
            .map(|t| ReviewGrade {
                target_id: t.id.clone(),
                quality,
                method: ResponseMethod::Remembered,
                easy: false,
            })
            .collect(),
    }
}

pub fn submit(store: &mut ProfileStore, session: &ReviewSession, id: &str) -> ReviewSession {
    store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(session, id),
                response: response(session, Some(AttemptQuality::Fluent)),
            },
            102,
        )
        .unwrap()
        .session
}

pub fn schedule(store: &ProfileStore, admission: &ReviewAdmission) -> Option<ReviewSchedule> {
    store
        .review_due_materials(None, 100, 128)
        .unwrap()
        .into_iter()
        .find(|m| m.material.id == admission.material_id)
        .unwrap()
        .schedules
        .into_iter()
        .find(|(id, _)| id == &admission.probe.id)
        .map(|(_, s)| s)
}
