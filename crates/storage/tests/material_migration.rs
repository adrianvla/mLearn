use mlearn_core::*;
use mlearn_storage::ProfileStore;

fn create(command: &str) -> MaterialCreate {
    MaterialCreate {
        command_id: command.into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: "package".into(),
            target_id: None,
            package_revision: None,
            sense: None,
            phrase: "phrase".into(),
            reading: "".into(),
            meaning: "".into(),
            context: "".into(),
            notes: "".into(),
            examples: vec![],
            source: None,
            attachments: vec![],
        },
    }
}

#[test]
fn sequential_migrations_preserve_existing_state_and_reject_newer_versions() {
    // Given each supported historical schema with persisted settings.
    for version in 0..=3 {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p");
        if version > 0 {
            let mut store = ProfileStore::open(&path).unwrap();
            let theme = ThemeDocument {
                name: "retained".into(),
                ..Default::default()
            };
            store.save_theme(&theme, 0, "settings").unwrap();
            drop(store);
            let db = rusqlite::Connection::open(&path).unwrap();
            db.execute_batch("DROP TABLE material_assets; DROP TABLE materials; DROP TABLE authored_media; DROP TABLE capture_exclusions; DROP TABLE material_receipts; DROP TABLE view_preference_receipts; DROP TABLE view_preferences;").unwrap();
            if version < 3 {
                db.execute_batch("DROP TABLE install_receipts;").unwrap();
            }
            if version < 2 {
                db.execute_batch("DROP TABLE cues; DROP TABLE sources; DROP TABLE knowledge_revision; DROP TABLE claims; DROP TABLE claim_receipts;").unwrap();
            }
            db.pragma_update(None, "user_version", version).unwrap();
        }
        // When opened by the current owner.
        let mut store = ProfileStore::open(&path).unwrap();
        store.create_material(&create("new")).unwrap();
        // Then the current schema is durable and historical settings remain intact.
        if version > 0 {
            assert_eq!(store.preferences().unwrap().1.name, "retained");
        }
        drop(store);
        let db = rusqlite::Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            16
        );
        db.pragma_update(None, "user_version", 17).unwrap();
        drop(db);
        assert!(ProfileStore::open(&path).is_err());
    }
}
