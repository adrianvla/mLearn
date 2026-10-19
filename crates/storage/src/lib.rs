mod watch;
pub use watch::SourceReader;
use mlearn_core::{ThemeDocument, PackageInstallCommand, PluginSummary, Response};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Database operation failed: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("Stored data is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("Settings changed elsewhere; reload before saving")]
    Conflict,
}

/// One native owner. Call on a blocking worker, never on a renderer/UI thread.
pub struct ProfileStore { connection: Connection }

impl ProfileStore {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let version: u32 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 3 { return Err(StorageError::Invalid("Profile was created by a newer application".into())); }
        if version == 0 {
            transaction.execute_batch("CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, theme TEXT NOT NULL); CREATE TABLE receipts (sequence INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL UNIQUE, digest BLOB NOT NULL, revision INTEGER NOT NULL); CREATE TABLE plugins (id TEXT PRIMARY KEY, manifest TEXT NOT NULL); PRAGMA user_version=1;")?;
            transaction.execute("INSERT INTO preferences VALUES (1, 0, ?1)", [serde_json::to_string(&ThemeDocument::default())?])?;
        }
        if version < 2 {
            transaction.execute_batch("CREATE TABLE cues(source_id TEXT NOT NULL,cue_index INTEGER NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(source_id,cue_index)); CREATE INDEX cues_time ON cues(source_id,start_ms); CREATE TABLE sources(id TEXT PRIMARY KEY,document TEXT NOT NULL,touched REAL NOT NULL); CREATE TABLE knowledge_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL); INSERT INTO knowledge_revision VALUES(1,0); CREATE TABLE claims(package_id TEXT NOT NULL,target_id TEXT NOT NULL,capability TEXT NOT NULL,claim INTEGER,revision INTEGER NOT NULL,PRIMARY KEY(package_id,target_id,capability)); CREATE TABLE claim_receipts(command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,projection TEXT NOT NULL); PRAGMA user_version=2;")?;
        }
        if version < 3 {
            transaction.execute_batch("CREATE TABLE install_receipts(sequence INTEGER PRIMARY KEY AUTOINCREMENT,command_id TEXT NOT NULL UNIQUE,digest BLOB NOT NULL,outcome TEXT NOT NULL); PRAGMA user_version=3;")?;
        }
        // Schema version and initial row become durable together, including first startup.
        transaction.commit()?;
        let store = Self { connection };
        store.preferences()?;
        Ok(store)
    }

    pub fn preferences(&self) -> Result<(u32, ThemeDocument), StorageError> {
        let (revision, json): (u32, String) = self.connection.query_row("SELECT revision, theme FROM preferences WHERE id=1", [], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let theme: ThemeDocument = serde_json::from_str(&json)?;
        theme.validate().map_err(StorageError::Invalid)?;
        Ok((revision, theme))
    }

    pub fn save_theme(&mut self, theme: &ThemeDocument, expected: u32, command_id: &str) -> Result<u32, StorageError> {
        theme.validate().map_err(StorageError::Invalid)?;
        if command_id.is_empty() || command_id.len() > 128 { return Err(StorageError::Invalid("Invalid command identity".into())); }
        let encoded = serde_json::to_string(theme)?;
        let digest = Sha256::digest(format!("{expected}:{encoded}").as_bytes()).to_vec();
        let transaction = self.connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: Option<(Vec<u8>, u32)> = transaction.query_row("SELECT digest, revision FROM receipts WHERE command_id=?1", [command_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        if let Some((old_digest, revision)) = previous {
            if old_digest != digest { return Err(StorageError::Invalid("Command identity reused for different contents".into())); }
            return Ok(revision);
        }
        let revision: u32 = transaction.query_row("SELECT revision FROM preferences WHERE id=1", [], |row| row.get(0))?;
        if revision != expected { return Err(StorageError::Conflict); }
        let next = revision.checked_add(1).ok_or_else(|| StorageError::Invalid("Settings revision exhausted".into()))?;
        transaction.execute("UPDATE preferences SET revision=?1, theme=?2 WHERE id=1", params![next, encoded])?;
        transaction.execute("INSERT INTO receipts(command_id,digest,revision) VALUES (?1,?2,?3)", params![command_id, digest, next])?;
        transaction.execute("DELETE FROM receipts WHERE sequence <= (SELECT COALESCE(MAX(sequence),0)-256 FROM receipts)", [])?;
        transaction.commit()?;
        Ok(next)
    }

    pub fn plugin_manifests(&self) -> Result<Vec<(String, String)>, StorageError> {
        let mut statement = self.connection.prepare("SELECT id,manifest FROM plugins ORDER BY id")?;
        Ok(statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<Vec<_>, _>>()?)
    }
    pub fn activate_plugin(&mut self, id: &str, manifest: &str) -> Result<(), StorageError> {
        self.connection.execute("INSERT INTO plugins(id,manifest) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest", params![id, manifest])?;
        Ok(())
    }
    pub fn install_receipt(&self, command: &PackageInstallCommand) -> Result<Option<Response>, StorageError> {
        let previous: Option<(Vec<u8>, String)> = self.connection.query_row(
            "SELECT digest,outcome FROM install_receipts WHERE command_id=?1", [&command.command_id],
            |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        previous.map(|(digest, json)| {
            if digest != Sha256::digest(serde_json::to_vec(command)?).to_vec() {
                return Err(StorageError::Invalid("Command identity reused for different contents".into()));
            }
            let outcome: Response = serde_json::from_str(&json)?;
            if !matches!(outcome, Response::Installed { .. } | Response::Error { .. }) {
                return Err(StorageError::Invalid("Invalid package installation receipt".into()));
            }
            Ok(outcome)
        }).transpose()
    }
    pub fn activate_plugin_command(&mut self, command: &PackageInstallCommand, manifest: &str, plugin: PluginSummary) -> Result<(), StorageError> {
        let tx = self.connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO plugins(id,manifest) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest", params![command.plugin_id, manifest])?;
        write_install_receipt(&tx, command, &Response::Installed { plugin })?;
        tx.commit()?;
        Ok(())
    }
    pub fn record_install_failure(&mut self, command: &PackageInstallCommand, outcome: &Response) -> Result<(), StorageError> {
        let tx = self.connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        write_install_receipt(&tx, command, outcome)?;
        tx.commit()?;
        Ok(())
    }
}
fn write_install_receipt(tx: &rusqlite::Transaction<'_>, command: &PackageInstallCommand, outcome: &Response) -> Result<(), StorageError> {
    let digest = Sha256::digest(serde_json::to_vec(command)?).to_vec();
    tx.execute("INSERT INTO install_receipts(command_id,digest,outcome) VALUES (?1,?2,?3)", params![command.command_id, digest, serde_json::to_string(outcome)?])?;
    // Installation commands have the same bounded retry horizon as settings.
    tx.execute("DELETE FROM install_receipts WHERE sequence <= (SELECT COALESCE(MAX(sequence),0)-256 FROM install_receipts)", [])?;
    Ok(())
}
