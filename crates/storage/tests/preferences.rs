use mlearn_core::{PackageInstallCommand, PluginSummary, Response, ThemeDocument};
use mlearn_storage::{ProfileStore, StorageError};

#[test]
fn writes_survive_restart_and_same_command_has_one_effect() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut theme = ThemeDocument::default();
    theme.name = "My own theme".into();
    theme
        .extensions
        .insert("test::future".into(), serde_json::json!({"x": [1, 2]}));
    {
        let mut store = ProfileStore::open(&path).unwrap();
        assert_eq!(store.save_theme(&theme, 0, "command-a").unwrap(), 1);
        assert_eq!(store.save_theme(&theme, 0, "command-a").unwrap(), 1);
        assert_eq!(store.preferences().unwrap(), (1, theme.clone()));
        assert!(matches!(
            store.save_theme(&theme, 0, "command-b"),
            Err(StorageError::Conflict)
        ));
    }
    assert_eq!(
        ProfileStore::open(&path).unwrap().preferences().unwrap(),
        (1, theme)
    );
}

#[test]
fn invalid_writes_do_not_mutate_profile_and_corruption_is_not_reset() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut store = ProfileStore::open(&path).unwrap();
    let original = store.preferences().unwrap();
    let mut bad = original.1.clone();
    bad.colors.text = "not a color".into();
    assert!(store.save_theme(&bad, 0, "bad").is_err());
    assert_eq!(store.preferences().unwrap(), original);
    drop(store);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE preferences SET theme='broken'", [])
        .unwrap();
    drop(db);
    assert!(ProfileStore::open(&path).is_err());
}

#[test]
fn command_id_cannot_be_reused_for_another_change() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    let mut theme = ThemeDocument::default();
    store.save_theme(&theme, 0, "same-id").unwrap();
    theme.name = "Different".into();
    assert!(store.save_theme(&theme, 0, "same-id").is_err());
}

#[test]
fn inline_scale_is_durable_idempotent_and_changes_no_learner_or_theme_tables() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut store = ProfileStore::open(&path).unwrap();
    store
        .save_theme(&ThemeDocument::default(), 0, "theme")
        .unwrap();
    store
        .change_claim(&mlearn_core::ClaimChange {
            key: mlearn_core::KnowledgeKey {
                package_id: "org.example".into(),
                target_id: "word".into(),
                capability: "org.example:meaning".into(),
            },
            claim: Some(true),
            command_id: "known".into(),
        })
        .unwrap();
    // Include every existing domain table, including review sessions, schedules,
    // evidence, progress and exclusions, rather than a selected list of owners.
    fn domain_rows(path: &std::path::Path) -> Vec<(String, Vec<String>)> {
        let db = rusqlite::Connection::open(path).unwrap();
        let tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('view_preferences','view_preference_receipts','sqlite_sequence') ORDER BY name")
            .unwrap().query_map([], |row| row.get::<_,String>(0)).unwrap()
            .collect::<Result<Vec<_>,_>>().unwrap();
        tables
            .into_iter()
            .map(|name| {
                let mut statement = db
                    .prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))
                    .unwrap();
                let columns = statement.column_count();
                let mut values = statement
                    .query_map([], |row| {
                        Ok((0..columns)
                            .map(|column| format!("{:?}", row.get_ref(column).unwrap()))
                            .collect::<Vec<_>>()
                            .join("|"))
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                values.sort();
                (name, values)
            })
            .collect()
    }
    let before = domain_rows(&path);
    assert_eq!(store.view_preferences().unwrap().inline_level_scale, None);
    assert_eq!(
        store
            .save_inline_level_scale(Some("org.example:course-a"), 0, "scale-a")
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .save_inline_level_scale(Some("org.example:course-a"), 0, "scale-a")
            .unwrap(),
        1
    );
    assert!(
        store
            .save_inline_level_scale(Some("org.example:course-b"), 0, "scale-a")
            .is_err()
    );
    assert!(matches!(
        store.save_inline_level_scale(None, 0, "stale"),
        Err(StorageError::Conflict)
    ));
    assert!(
        store
            .save_inline_level_scale(Some("not namespaced"), 1, "invalid")
            .is_err()
    );
    assert_eq!(
        store
            .save_inline_level_scale(Some("org.example:course-b"), 1, "scale-b")
            .unwrap(),
        2
    );
    assert_eq!(domain_rows(&path), before);
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(
        store.view_preferences().unwrap(),
        mlearn_core::ViewPreferences {
            revision: 2,
            inline_level_scale: Some("org.example:course-b".into()),
            star_collapse: mlearn_core::StarCollapse::Auto,
        }
    );
    assert_eq!(
        store
            .save_inline_level_scale(None, 2, "hide-stars")
            .unwrap(),
        3
    );
    assert_eq!(domain_rows(&path), before);
    for (expected, mode, command) in [
        (3, mlearn_core::StarCollapse::Always, "compact"),
        (4, mlearn_core::StarCollapse::Never, "expanded"),
        (5, mlearn_core::StarCollapse::Auto, "automatic"),
    ] {
        assert_eq!(
            store.save_star_collapse(mode, expected, command).unwrap(),
            expected + 1
        );
        assert_eq!(
            store.save_star_collapse(mode, expected, command).unwrap(),
            expected + 1
        );
        assert!(
            store
                .save_inline_level_scale(None, expected, command)
                .is_err()
        );
        assert_eq!(store.view_preferences().unwrap().star_collapse, mode);
        assert_eq!(domain_rows(&path), before);
    }
}

#[test]
fn schema_ten_scale_and_retry_receipt_survive_collapse_migration() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut store = ProfileStore::open(&path).unwrap();
    store
        .save_inline_level_scale(Some("org.example:course"), 0, "scale-before-collapse")
        .unwrap();
    drop(store);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(
        "ALTER TABLE view_preferences DROP COLUMN star_collapse; PRAGMA user_version=10;",
    )
    .unwrap();
    drop(db);
    let mut store = ProfileStore::open(&path).unwrap();
    let view = store.view_preferences().unwrap();
    assert_eq!(
        view.inline_level_scale.as_deref(),
        Some("org.example:course")
    );
    assert_eq!(view.revision, 1);
    assert_eq!(view.star_collapse, mlearn_core::StarCollapse::Auto);
    assert_eq!(
        store
            .save_inline_level_scale(Some("org.example:course"), 0, "scale-before-collapse")
            .unwrap(),
        1
    );
    store
        .save_star_collapse(mlearn_core::StarCollapse::Always, 1, "compact")
        .unwrap();
    drop(store);
    assert_eq!(
        ProfileStore::open(&path)
            .unwrap()
            .view_preferences()
            .unwrap()
            .star_collapse,
        mlearn_core::StarCollapse::Always
    );
}

#[test]
fn version_two_migration_and_install_receipt_commit_preserve_accepted_state() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut store = ProfileStore::open(&path).unwrap();
    let theme = ThemeDocument {
        name: "Retained theme".into(),
        ..Default::default()
    };
    store.save_theme(&theme, 0, "before-migration").unwrap();
    store
        .activate_plugin("example.hello", r#"{"id":"example.hello","version":"one"}"#)
        .unwrap();
    drop(store);
    // The pre-M02 schema has these same tables, without installation receipts.
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE install_receipts; DROP TABLE view_preference_receipts; DROP TABLE view_preferences; PRAGMA user_version=2;")
        .unwrap();
    drop(db);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.preferences().unwrap(), (1, theme));
    assert_eq!(
        store.plugin_manifests().unwrap()[0].1,
        r#"{"id":"example.hello","version":"one"}"#
    );
    let command = PackageInstallCommand {
        plugin_id: "example.hello".into(),
        command_id: "durable-install".into(),
    };
    let plugin = PluginSummary {
        id: command.plugin_id.clone(),
        display_name: None,
        version: "two".into(),
        capabilities: vec!["example::hello".into()],
    };
    let manifest = r#"{"id":"example.hello","version":"two"}"#;
    store
        .activate_plugin_command(&command, manifest, plugin)
        .unwrap();
    // A duplicate receipt failure must roll back the associated activation.
    let replacement = PluginSummary {
        id: command.plugin_id.clone(),
        display_name: None,
        version: "three".into(),
        capabilities: vec!["example::hello".into()],
    };
    assert!(
        store
            .activate_plugin_command(
                &command,
                r#"{"id":"example.hello","version":"three"}"#,
                replacement
            )
            .is_err()
    );
    assert_eq!(store.plugin_manifests().unwrap()[0].1, manifest);
    drop(store);
    let store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.plugin_manifests().unwrap()[0].1, manifest);
    match store.install_receipt(&command).unwrap().unwrap() {
        Response::Installed { plugin } => assert_eq!(plugin.version, "two"),
        other => panic!("Wrong durable outcome: {other:?}"),
    }
    assert!(
        store
            .install_receipt(&PackageInstallCommand {
                plugin_id: "different.package".into(),
                ..command
            })
            .is_err()
    );
}
