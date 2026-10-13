use mlearn_core::ThemeDocument;
use mlearn_storage::{ProfileStore, StorageError};

#[test]
fn writes_survive_restart_and_same_command_has_one_effect() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite3");
    let mut theme = ThemeDocument::default();
    theme.name = "My own theme".into();
    theme.extensions.insert("test::future".into(), serde_json::json!({"x": [1, 2]}));
    {
        let mut store = ProfileStore::open(&path).unwrap();
        assert_eq!(store.save_theme(&theme, 0, "command-a").unwrap(), 1);
        assert_eq!(store.save_theme(&theme, 0, "command-a").unwrap(), 1);
        assert_eq!(store.preferences().unwrap(), (1, theme.clone()));
        assert!(matches!(store.save_theme(&theme, 0, "command-b"), Err(StorageError::Conflict)));
    }
    assert_eq!(ProfileStore::open(&path).unwrap().preferences().unwrap(), (1, theme));
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
    db.execute("UPDATE preferences SET theme='broken'", []).unwrap();
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
