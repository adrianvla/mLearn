use crate::{ProfileStore, StorageError, material_media::read_media, material_validation::bounded};
use mlearn_core::{
    CaptureAvailability, Material, MaterialContent, MaterialEligibility, MaterialId, MaterialPage,
    MaterialQuery, MaterialTarget,
};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn read_material(db: &Connection, id: &MaterialId) -> Result<Material, StorageError> {
    let (revision, excluded, json): (u32, bool, String) = db.query_row(
        "SELECT revision,excluded,content FROM materials WHERE id=?1",
        [&id.0],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let content: MaterialContent = serde_json::from_str(&json)?;
    let media = content
        .attachments
        .iter()
        .map(|attachment| read_media(db, &attachment.media_id))
        .collect::<Result<_, _>>()?;
    Ok(Material {
        id: id.clone(),
        revision,
        excluded,
        content,
        media,
    })
}

pub(crate) fn eligibility(
    db: &Connection,
    target: &MaterialTarget,
) -> Result<MaterialEligibility, StorageError> {
    let excluded: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM capture_exclusions WHERE package_id=?1 AND target_id=?2 AND excluded=1)",
        params![target.package_id, target.target_id], |r| r.get(0))?;
    let existing: Option<String> = db
        .query_row(
            "SELECT id FROM materials WHERE package_id=?1 AND target_id=?2 ORDER BY id LIMIT 1",
            params![target.package_id, target.target_id],
            |r| r.get(0),
        )
        .optional()?;
    let availability = match existing {
        Some(id) => CaptureAvailability::Existing {
            material_id: MaterialId(id),
            excluded,
        },
        None => {
            if excluded {
                CaptureAvailability::Excluded
            } else {
                CaptureAvailability::Eligible
            }
        }
    };
    Ok(MaterialEligibility {
        target: target.clone(),
        availability,
    })
}

impl ProfileStore {
    pub fn material(&self, id: &MaterialId) -> Result<Material, StorageError> {
        bounded(&id.0, 512)?;
        read_material(&self.connection, id)
    }

    pub fn capture_eligibility(
        &self,
        targets: &[MaterialTarget],
    ) -> Result<Vec<MaterialEligibility>, StorageError> {
        if targets.len() > 128 {
            return Err(StorageError::Invalid(
                "Capture batch exceeds 128 targets".into(),
            ));
        }
        targets
            .iter()
            .map(|target| {
                crate::material_validation::target(target)?;
                eligibility(&self.connection, target)
            })
            .collect()
    }

    pub fn materials(&self, query: &MaterialQuery) -> Result<MaterialPage, StorageError> {
        if query.query.len() > 2048 {
            return Err(StorageError::Invalid(
                "Material search exceeds bounds".into(),
            ));
        }
        if let Some(id) = &query.after {
            bounded(&id.0, 512)?;
        }
        if let Some(id) = &query.source_id {
            bounded(id, 512)?;
        }
        // Choose the source index when scoped, the primary-key cursor otherwise.
        let sql = match query.source_id {
            Some(_) => {
                "SELECT id FROM materials WHERE source_id=?1 AND id>?2 AND (?3 OR excluded=0) AND instr(search_text,?4)>0 ORDER BY id LIMIT 25"
            }
            None => {
                "SELECT id FROM materials WHERE id>?2 AND (?3 OR excluded=0) AND instr(search_text,?4)>0 AND ?1 IS NULL ORDER BY id LIMIT 25"
            }
        };
        let mut statement = self.connection.prepare(sql)?;
        let ids = statement
            .query_map(
                params![
                    query.source_id,
                    query.after.as_ref().map(|id| id.0.as_str()).unwrap_or(""),
                    query.include_excluded,
                    query.query
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let mut page = MaterialPage {
            items: Vec::new(),
            next: None,
        };
        for (index, id) in ids.iter().enumerate() {
            if page.items.len() == 24 {
                break;
            }
            let item = read_material(&self.connection, &MaterialId(id.clone()))?;
            page.items.push(item);
            // Include the real cursor overhead in the encoded wire bound.
            page.next = if index + 1 < ids.len() {
                Some(MaterialId(id.clone()))
            } else {
                None
            };
            if serde_json::to_vec(&page)?.len() > 262144 {
                page.items.pop();
                page.next = page.items.last().map(|item| item.id.clone());
                if page.items.is_empty() {
                    return Err(StorageError::Invalid(
                        "Material exceeds page wire budget".into(),
                    ));
                }
                break;
            }
        }
        Ok(page)
    }
}
