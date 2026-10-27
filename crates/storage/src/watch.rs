use crate::{ProfileStore, StorageError};
use mlearn_core::SourceRecord;
use rusqlite::{OptionalExtension, params};
use std::path::Path;

/// A live, read-only source view for media work independent of language execution.
pub struct SourceReader {
    connection: rusqlite::Connection,
}
impl SourceReader {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        let connection = rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { connection })
    }
    pub fn source(&self, id: &str) -> Result<SourceRecord, StorageError> {
        read_source(&self.connection, id)
    }
    pub fn document(&self, id: &str) -> Result<Option<mlearn_core::DocumentRecord>, StorageError> {
        crate::document_validation::bounded(id, 512)?;
        crate::document_read::read_record(&self.connection, id)
    }
    pub fn document_resource(
        &self,
        id: &str,
        resource_id: &str,
    ) -> Result<Option<mlearn_core::DocumentResourceLocation>, StorageError> {
        crate::document_read::read_resource(&self.connection, id, resource_id)
    }
    pub fn authored_media(
        &self,
        id: &mlearn_core::AuthoredMediaId,
    ) -> Result<mlearn_core::AuthoredMedia, StorageError> {
        crate::material_validation::bounded(&id.0, 512)?;
        crate::material_media::read_media(&self.connection, id)
    }
}
fn read_source(connection: &rusqlite::Connection, id: &str) -> Result<SourceRecord, StorageError> {
    let json: String =
        connection.query_row("SELECT document FROM sources WHERE id=?1", [id], |row| {
            row.get(0)
        })?;
    Ok(serde_json::from_str(&json)?)
}
impl ProfileStore {
    pub fn save_source(&self, source: &SourceRecord) -> Result<(), StorageError> {
        self.connection.execute("INSERT INTO sources(id,document,touched) VALUES(?1,?2,unixepoch('subsec')) ON CONFLICT(id) DO UPDATE SET document=excluded.document,touched=excluded.touched",params![source.id,serde_json::to_string(source)?])?;
        Ok(())
    }
    pub fn source(&self, id: &str) -> Result<SourceRecord, StorageError> {
        read_source(&self.connection, id)
    }
    pub fn recents(&self) -> Result<Vec<SourceRecord>, StorageError> {
        let mut stmt = self
            .connection
            .prepare("SELECT document FROM sources ORDER BY touched DESC,id LIMIT 20")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
}
impl ProfileStore {
    pub fn attach_cues(
        &mut self,
        source: &SourceRecord,
        cues: &[mlearn_core::Cue],
    ) -> Result<(), StorageError> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM cues WHERE source_id=?1", [&source.id])?;
        {
            let mut stmt = tx.prepare("INSERT INTO cues VALUES(?1,?2,?3,?4,?5)")?;
            for cue in cues {
                stmt.execute(params![
                    source.id,
                    cue.index,
                    cue.start_ms,
                    cue.end_ms,
                    cue.text
                ])?;
            }
        }
        tx.execute(
            "UPDATE sources SET document=?2,touched=unixepoch('subsec') WHERE id=?1",
            params![source.id, serde_json::to_string(source)?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn cue_window(
        &self,
        id: &str,
        time: u32,
    ) -> Result<(Vec<mlearn_core::Cue>, u32), StorageError> {
        let count: u32 = self.connection.query_row(
            "SELECT COUNT(*) FROM cues WHERE source_id=?1",
            [id],
            |r| r.get(0),
        )?;
        let anchor: u32 = self.connection.query_row(
            "SELECT COALESCE(MAX(cue_index),0) FROM cues WHERE source_id=?1 AND start_ms<=?2",
            params![id, time],
            |r| r.get(0),
        )?;
        let mut stmt=self.connection.prepare("SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND ((start_ms<=?3 AND end_ms>?3) OR (cue_index>=?2 AND cue_index<=?4)) ORDER BY cue_index LIMIT 17")?;
        let rows = stmt
            .query_map(
                params![id, anchor.saturating_sub(1), time, anchor.saturating_add(1)],
                |r| {
                    Ok(mlearn_core::Cue {
                        index: r.get(0)?,
                        start_ms: r.get(1)?,
                        end_ms: r.get(2)?,
                        text: r.get(3)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        if rows.len() > 16 {
            return Err(StorageError::Invalid(
                "Subtitle window exceeds 16 concurrent/context cues".into(),
            ));
        }
        Ok((rows, count))
    }
    pub fn transcript_page(
        &self,
        id: &str,
        after: Option<u32>,
        query: &str,
    ) -> Result<(Vec<mlearn_core::Cue>, Option<u32>), StorageError> {
        let mut stmt=self.connection.prepare("SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND (?2 IS NULL OR cue_index>?2) AND instr(text,?3)>0 ORDER BY cue_index LIMIT 17")?;
        let mut cues = stmt
            .query_map(params![id, after, query], |r| {
                Ok(mlearn_core::Cue {
                    index: r.get(0)?,
                    start_ms: r.get(1)?,
                    end_ms: r.get(2)?,
                    text: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let next = if cues.len() > 16 {
            cues.truncate(16);
            cues.last().map(|c| c.index)
        } else {
            None
        };
        Ok((cues, next))
    }
    pub fn cue(&self, id: &str, index: u32) -> Result<Option<mlearn_core::Cue>, StorageError> {
        Ok(self.connection.query_row("SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND cue_index=?2",params![id,index],|r|Ok(mlearn_core::Cue{index:r.get(0)?,start_ms:r.get(1)?,end_ms:r.get(2)?,text:r.get(3)?})).optional()?)
    }
    pub fn neighboring_cue(
        &self,
        id: &str,
        time: i64,
        direction: mlearn_core::SubtitleDirection,
    ) -> Result<Option<mlearn_core::Cue>, StorageError> {
        let cue = |r: &rusqlite::Row<'_>| {
            Ok(mlearn_core::Cue {
                index: r.get(0)?,
                start_ms: r.get(1)?,
                end_ms: r.get(2)?,
                text: r.get(3)?,
            })
        };
        match direction {
   mlearn_core::SubtitleDirection::Next=>Ok(self.connection.query_row(
    "SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND start_ms>?2 ORDER BY start_ms,cue_index LIMIT 1",
    params![id,time],cue).optional()?),
   mlearn_core::SubtitleDirection::Previous=>{
    let current=self.connection.query_row(
     "SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND start_ms<=?2 ORDER BY start_ms DESC,cue_index DESC LIMIT 1",
     params![id,time],cue).optional()?;
    match current {
     Some(current) if i64::from(current.end_ms)>time=>{
      // Coincident starts are one synchronization point: offset alone cannot
      // distinguish them. Never report a successful previous action that stays put.
      Ok(self.connection.query_row(
       "SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND start_ms<?2 ORDER BY start_ms DESC,cue_index DESC LIMIT 1",
       params![id,current.start_ms],cue).optional()?)
     }
     previous=>Ok(previous),
    }
   }
  }
    }
}

impl ProfileStore {
    pub fn find_source(&self, id: &str) -> Result<Option<SourceRecord>, StorageError> {
        let json: Option<String> = self
            .connection
            .query_row("SELECT document FROM sources WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        json.map(|s| serde_json::from_str(&s).map_err(StorageError::from))
            .transpose()
    }
}
