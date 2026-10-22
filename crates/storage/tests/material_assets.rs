use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};

fn media(id: &str) -> AuthoredMedia {
    AuthoredMedia {
        id: AuthoredMediaId(id.into()),
        kind: MaterialMediaKind::Audio,
        name: "clip".into(),
        mime_type: "audio/wav".into(),
        byte_length: 123,
    }
}

fn create(command: &str, media_id: &str) -> MaterialCreate {
    MaterialCreate {
        command_id: command.into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: "package".into(),
            target_id: None,
            package_revision: None,
            sense: None,
            phrase: command.into(),
            reading: "".into(),
            meaning: "".into(),
            context: "".into(),
            notes: "".into(),
            examples: vec![],
            source: None,
            attachments: vec![MaterialAttachment {
                media_id: AuthoredMediaId(media_id.into()),
                segment: Some(MediaSegment {
                    source_id: command.into(),
                    content_revision: "v1".into(),
                    start_ms: 10,
                    end_ms: 20,
                }),
            }],
        },
    }
}

fn saved(result: MaterialWriteResult) -> Material {
    match result {
        MaterialWriteResult::Saved { material, .. } => *material,
        other => panic!("{other:?}"),
    }
}

fn change(item: &Material) -> MaterialEdit {
    MaterialEdit {
        media_imports: vec![],
        command_id: "edit".into(),
        id: item.id.clone(),
        expected_revision: item.revision,
        content: item.content.clone(),
        excluded: false,
    }
}

#[test]
fn shared_asset_references_survive_replacement_and_restart() {
    // Given two uses of identical bytes with different segment origins.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    let mut store = ProfileStore::open(&path).unwrap();
    let shared = media("shared");
    let replacement = media("replacement");
    store.register_authored_media(&shared).unwrap();
    store.register_authored_media(&shared).unwrap();
    store.register_authored_media(&replacement).unwrap();
    let one = saved(store.create_material(&create("one", "shared")).unwrap());
    let two = saved(store.create_material(&create("two", "shared")).unwrap());
    assert_ne!(
        one.content.attachments[0].segment,
        two.content.attachments[0].segment
    );
    let mut edit = change(&one);
    edit.content.attachments[0].media_id = replacement.id.clone();
    // When one use replaces its bytes.
    store.update_material(&edit).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    // Then the other durable reference protects the shared catalog record.
    assert_eq!(store.material(&two.id).unwrap().media, vec![shared.clone()]);
    assert!(matches!(
        store.forget_authored_media(&shared.id),
        Err(StorageError::Conflict)
    ));
    assert!(store.unreferenced_authored_media(128).unwrap().is_empty());
    let mut remove = change(&two);
    remove.command_id = "remove-last-use".into();
    remove.content.attachments.clear();
    store.update_material(&remove).unwrap();
    assert_eq!(
        store.unreferenced_authored_media(1).unwrap(),
        vec![shared.clone()]
    );
    store.forget_authored_media(&shared.id).unwrap();
    assert_eq!(store.authored_media(&replacement.id).unwrap(), replacement);
}

#[test]
fn unknown_asset_and_cas_conflicts_rollback_content_references_and_receipts() {
    // Given a saved material using a registered asset.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let asset = media("shared");
    store.register_authored_media(&asset).unwrap();
    let original = saved(store.create_material(&create("one", "shared")).unwrap());
    let mut invalid = change(&original);
    invalid.content.attachments[0].media_id = AuthoredMediaId("unknown".into());
    invalid.content.notes = "must rollback".into();
    // When an edit references unknown metadata.
    assert!(store.update_material(&invalid).is_err());
    // Then no partial revision, content, references or receipt survives.
    assert_eq!(store.material(&original.id).unwrap(), original);
    assert!(store.material_edit_receipt(&invalid).unwrap().is_none());
    assert!(store.unreferenced_authored_media(128).unwrap().is_empty());
    let mut valid = change(&original);
    valid.content.notes = "committed".into();
    let updated = saved(store.update_material(&valid).unwrap());
    let mut stale = change(&original);
    stale.command_id = "stale".into();
    stale.content.attachments.clear();
    assert!(matches!(
        store.update_material(&stale),
        Err(StorageError::Conflict)
    ));
    assert_eq!(store.material(&original.id).unwrap(), updated);
    assert!(store.material_edit_receipt(&stale).unwrap().is_none());
    assert!(matches!(
        store.forget_authored_media(&asset.id),
        Err(StorageError::Conflict)
    ));
}

#[test]
fn invalid_content_and_failed_creates_leave_no_asset_ownership() {
    // Given a registered asset and a create with repeated attachment IDs.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let asset = media("shared");
    store.register_authored_media(&asset).unwrap();
    let mut command = create("bad", "shared");
    command
        .content
        .attachments
        .push(command.content.attachments[0].clone());
    // When storage validates it.
    assert!(store.create_material(&command).is_err());
    // Then it owns no asset and can be corrected under the same uncommitted command.
    assert_eq!(
        store.unreferenced_authored_media(1).unwrap(),
        vec![asset.clone()]
    );
    command.content.attachments.pop();
    let item = saved(store.create_material(&command).unwrap());
    let mut changed = asset.clone();
    changed.byte_length = 999;
    assert!(store.register_authored_media(&changed).is_err());
    assert_eq!(store.material(&item.id).unwrap().media, vec![asset]);
}

#[test]
fn frame_capture_without_subtitles_preserves_an_empty_source_selection() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let mut image = media("frame");
    image.kind = MaterialMediaKind::Image;
    image.mime_type = "image/png".into();
    store.register_authored_media(&image).unwrap();
    let mut command = create("no-subtitles", "frame");
    command.content.attachments[0].segment = None;
    command.content.source = Some(SourceAnchor {
        source_id: "video".into(),
        content_revision: "revision".into(),
        package_id: "package".into(),
        package_version: "1".into(),
        text: String::new(),
        locator: SourceLocator::Video {
            subtitle_revision: None,
            cue_index: None,
            selection_start: 0,
            selection_end: 0,
            position_ms: 5000,
            subtitle_offset_ms: 0,
            playback_rate: 1.0,
        },
    });
    let item = saved(store.create_material(&command).unwrap());
    assert_eq!(item.content.source, command.content.source);
    assert_eq!(store.material(&item.id).unwrap().media, vec![image]);
}

#[test]
fn instant_frame_capture_requires_an_image_not_an_audio_or_video_segment() {
    for (index, kind) in [
        MaterialMediaKind::Image,
        MaterialMediaKind::Audio,
        MaterialMediaKind::Video,
    ]
    .into_iter()
    .enumerate()
    {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
        let mut asset = media("instant");
        asset.kind = kind;
        asset.mime_type = match kind {
            MaterialMediaKind::Image => "image/png",
            MaterialMediaKind::Audio => "audio/wav",
            MaterialMediaKind::Video => "video/mp4",
        }
        .into();
        store.register_authored_media(&asset).unwrap();
        let mut command = create(&format!("instant-{index}"), "instant");
        let segment = command.content.attachments[0].segment.as_mut().unwrap();
        segment.end_ms = segment.start_ms;
        let result = store.create_material(&command);
        match kind {
            MaterialMediaKind::Image => {
                let item = saved(result.unwrap());
                assert_eq!(item.content.attachments, command.content.attachments);
            }
            MaterialMediaKind::Audio | MaterialMediaKind::Video => {
                assert!(matches!(result, Err(StorageError::Invalid(_))));
                assert!(store.material_create_receipt(&command).unwrap().is_none());
            }
        }
    }
}
