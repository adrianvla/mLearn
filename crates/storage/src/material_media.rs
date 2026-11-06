use crate::{ProfileStore, StorageError, material_validation::bounded};
use mlearn_core::{
    AuthoredMedia, AuthoredMediaId, MaterialAttachment, MaterialContent, MaterialMediaImport,
    MaterialMediaKind, MediaSegment,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::borrow::Cow;

// Private, retained Review admissions own their required media independently
// of the authored Material, including after removal of the final card reference.
const MEDIA_REFERENCED: &str = "EXISTS(SELECT 1 FROM material_assets r WHERE r.media_id=a.id)
    OR EXISTS(SELECT 1 FROM review_work w WHERE json_extract(w.admission,'$.probe.requiredMedia')=a.id)";

pub struct PreparedAuthoredMedia {
    pub media: AuthoredMedia,
    pub segment: Option<MediaSegment>,
}

pub(crate) fn prepared_content<'a>(
    content: &'a MaterialContent,
    requested: &[MaterialMediaImport],
    prepared: &[PreparedAuthoredMedia],
) -> Result<Cow<'a, MaterialContent>, StorageError> {
    if requested.len() != prepared.len()
        || prepared.len() > 8
        || content.attachments.len() > 8usize.saturating_sub(prepared.len())
    {
        return Err(StorageError::Invalid(
            "Material media preparation does not match the request".into(),
        ));
    }
    if prepared.is_empty() {
        return Ok(Cow::Borrowed(content));
    }
    let mut content = content.clone();
    for (request, asset) in requested.iter().zip(prepared) {
        if request.kind != asset.media.kind || request.segment != asset.segment {
            return Err(StorageError::Invalid(
                "Prepared media changed kind or source origin".into(),
            ));
        }
        content.attachments.push(MaterialAttachment {
            media_id: asset.media.id.clone(),
            segment: asset.segment.clone(),
            audio_binding: request.audio_binding.clone(),
        });
    }
    Ok(Cow::Owned(content))
}

pub(crate) fn read_media(
    db: &Connection,
    id: &AuthoredMediaId,
) -> Result<AuthoredMedia, StorageError> {
    let json: String = db.query_row(
        "SELECT document FROM authored_media WHERE id=?1",
        [&id.0],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

pub(crate) fn replace_references(
    db: &Connection,
    id: &str,
    content: &MaterialContent,
) -> Result<(), StorageError> {
    // Check before deleting; the enclosing write transaction makes both changes atomic.
    for attachment in &content.attachments {
        let media = read_media(db, &attachment.media_id)?;
        if attachment.audio_binding.is_some() && media.kind != MaterialMediaKind::Audio {
            return Err(StorageError::Invalid(
                "Only audio can bind a Review target".into(),
            ));
        }
        if let Some(segment) = &attachment.segment
            && segment.start_ms == segment.end_ms
            && media.kind != MaterialMediaKind::Image
        {
            return Err(StorageError::Invalid(
                "Audio and video segments require a positive duration".into(),
            ));
        }
    }
    db.execute("DELETE FROM material_assets WHERE material_id=?1", [id])?;
    for attachment in &content.attachments {
        db.execute(
            "INSERT INTO material_assets(material_id,media_id) VALUES(?1,?2)",
            params![id, attachment.media_id.0],
        )?;
    }
    Ok(())
}

impl ProfileStore {
    pub fn register_authored_media(&self, media: &AuthoredMedia) -> Result<(), StorageError> {
        register_media(&self.connection, media)
    }

    pub fn find_authored_media(
        &self,
        id: &AuthoredMediaId,
    ) -> Result<Option<AuthoredMedia>, StorageError> {
        bounded(&id.0, 512)?;
        let json: Option<String> = self
            .connection
            .query_row(
                "SELECT document FROM authored_media WHERE id=?1",
                [&id.0],
                |r| r.get(0),
            )
            .optional()?;
        json.map(|json| serde_json::from_str(&json).map_err(StorageError::from))
            .transpose()
    }

    pub fn authored_media(&self, id: &AuthoredMediaId) -> Result<AuthoredMedia, StorageError> {
        bounded(&id.0, 512)?;
        read_media(&self.connection, id)
    }

    pub fn unreferenced_authored_media(
        &self,
        limit: u32,
    ) -> Result<Vec<AuthoredMedia>, StorageError> {
        if limit > 128 {
            return Err(StorageError::Invalid(
                "Authored media batch exceeds 128".into(),
            ));
        }
        let mut statement = self.connection.prepare(&format!(
            "SELECT document FROM authored_media a WHERE NOT ({MEDIA_REFERENCED}) ORDER BY id LIMIT ?1"))?;
        statement
            .query_map([limit], |r| r.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect()
    }

    pub fn forget_authored_media(&self, id: &AuthoredMediaId) -> Result<(), StorageError> {
        bounded(&id.0, 512)?;
        let count = self.connection.execute(
            &format!("DELETE FROM authored_media AS a WHERE id=?1 AND NOT ({MEDIA_REFERENCED})"),
            [&id.0],
        )?;
        if count == 0 {
            let referenced: bool = self.connection.query_row(
                &format!("SELECT {MEDIA_REFERENCED} FROM authored_media AS a WHERE id=?1"),
                [&id.0],
                |r| r.get(0),
            ).optional()?.unwrap_or(false);
            if referenced {
                return Err(StorageError::Conflict);
            }
        }
        Ok(())
    }
}

pub(crate) fn register_media(db: &Connection, media: &AuthoredMedia) -> Result<(), StorageError> {
    bounded(&media.id.0, 512)?;
    bounded(&media.name, 2048)?;
    bounded(&media.mime_type, 512)?;
    let encoded = serde_json::to_string(media)?;
    let old: Option<String> = db
        .query_row(
            "SELECT document FROM authored_media WHERE id=?1",
            [&media.id.0],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = old {
        if serde_json::from_str::<AuthoredMedia>(&old)? != *media {
            return Err(StorageError::Invalid(
                "Authored media identity already registered".into(),
            ));
        }
        return Ok(());
    }
    db.execute(
        "INSERT INTO authored_media(id,document) VALUES(?1,?2)",
        params![media.id.0, encoded],
    )?;
    Ok(())
}
