use crate::{
    ProfileStore, StorageError,
    document_read::{read_record, read_resource},
    document_validation::{invalid, json},
    ocr_validation::{self as validate, OCR_BYTES},
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

struct CompletionJob {
    request: String,
    base: Option<u32>,
    state: String,
    previous_digest: Option<Vec<u8>>,
    committed_revision: Option<u32>,
}

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS ocr_jobs(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,
            request TEXT NOT NULL,plan TEXT NOT NULL,base_revision INTEGER,
            state TEXT NOT NULL CHECK(state IN ('pending','cancelled','completed')),
            result_digest BLOB,revision INTEGER);
         CREATE UNIQUE INDEX IF NOT EXISTS ocr_single_admission ON ocr_jobs(state) WHERE state='pending';
         CREATE TABLE IF NOT EXISTS ocr_pages(
            source_id TEXT NOT NULL,resource_id TEXT NOT NULL,revision INTEGER NOT NULL,
            page TEXT NOT NULL,evidence TEXT NOT NULL,
            PRIMARY KEY(source_id,resource_id,revision),
            FOREIGN KEY(source_id,resource_id) REFERENCES document_resources(source_id,resource_id));
         CREATE TABLE IF NOT EXISTS ocr_corrections(
            command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,source_id TEXT NOT NULL,
            resource_id TEXT NOT NULL,revision INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS image_reader_settings(
            source_id TEXT PRIMARY KEY REFERENCES documents(id),settings TEXT NOT NULL);
         PRAGMA user_version=7;",
    )?;
    Ok(())
}

pub(crate) fn migrate_pages(db: &Connection) -> Result<(), StorageError> {
    // A JSON expression index rejects a corrupted distant block even when the
    // reader does not load it. Keep bounded page lookup in a normalized registry.
    db.execute_batch(
        "DROP INDEX IF EXISTS document_source_pages;
         CREATE TABLE IF NOT EXISTS document_pages(
            source_id TEXT NOT NULL,page_index INTEGER NOT NULL,
            resource_id TEXT NOT NULL,block_id TEXT NOT NULL,
            PRIMARY KEY(source_id,page_index),
            FOREIGN KEY(source_id,resource_id,block_id)
                REFERENCES document_blocks(source_id,resource,block_id));
         CREATE INDEX IF NOT EXISTS document_pages_resource ON document_pages(source_id,resource_id);
         INSERT OR IGNORE INTO document_pages
            SELECT source_id,json_extract(block,'$.page'),resource,block_id
            FROM document_blocks WHERE json_valid(block) AND json_extract(block,'$.page') IS NOT NULL
            ORDER BY ordinal;
         CREATE TABLE IF NOT EXISTS ocr_cancellations(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE);
         PRAGMA user_version=8;",
    )?;
    Ok(())
}

fn read_page(
    db: &Connection,
    source: &str,
    resource: &str,
    revision: Option<u32>,
) -> Result<Option<OcrPage>, StorageError> {
    validate::field(source)?;
    validate::field(resource)?;
    let encoded = db
        .query_row(
            "SELECT page FROM ocr_pages WHERE source_id=?1 AND resource_id=?2
             AND (?3 IS NULL OR revision=?3) ORDER BY revision DESC LIMIT 1",
            params![source, resource, revision],
            |row| json(row, 0, OCR_BYTES),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            let page: OcrPage = serde_json::from_str(&encoded)?;
            validate::page(&page)?;
            Ok(page)
        })
        .transpose()
}

fn save_page(db: &Connection, page: &OcrPage, evidence: &OcrEvidence) -> Result<(), StorageError> {
    validate::page(page)?;
    let evidence = serde_json::to_string(evidence)?;
    if evidence.len() > OCR_BYTES {
        return Err(invalid("OCR evidence exceeds bounded storage row"));
    }
    db.execute(
        "INSERT INTO ocr_pages VALUES(?1,?2,?3,?4,?5)",
        params![
            page.source_id,
            page.resource_id,
            page.ocr_revision,
            serde_json::to_string(page)?,
            evidence
        ],
    )?;
    Ok(())
}

fn next_revision(previous: Option<&OcrPage>) -> Result<u32, StorageError> {
    previous
        .map_or(0, |page| page.ocr_revision)
        .checked_add(1)
        .ok_or_else(|| invalid("OCR revision exhausted"))
}

fn read_base_page(
    db: &Connection,
    source: &str,
    resource: &str,
) -> Result<Option<OcrPage>, StorageError> {
    validate::field(source)?;
    validate::field(resource)?;
    let revision: Option<u32> = db.query_row(
        "SELECT MAX(revision) FROM ocr_pages WHERE source_id=?1 AND resource_id=?2 AND json_extract(evidence,'$.package') IS NULL",
        params![source, resource], |row| row.get(0),
    )?;
    revision
        .map(|revision| read_page(db, source, resource, Some(revision)))
        .transpose()
        .map(Option::flatten)
}

fn source_revision(
    db: &Connection,
    source: &str,
    revision: &str,
    resource: &str,
) -> Result<(), StorageError> {
    let record = read_record(db, source)?.ok_or_else(|| invalid("OCR source is unavailable"))?;
    if record.content_revision != revision || read_resource(db, source, resource)?.is_none() {
        return Err(invalid("OCR source content or resource changed"));
    }
    Ok(())
}

impl ProfileStore {
    /// Latest provider/user projection, independent of package interpretation.
    pub fn ocr_base_page(
        &self,
        source: &str,
        resource: &str,
    ) -> Result<Option<OcrPage>, StorageError> {
        read_base_page(&self.connection, source, resource)
    }
    pub fn image_page(
        &self,
        source_id: &str,
        page_index: u32,
    ) -> Result<ImagePageDescriptor, StorageError> {
        validate::field(source_id)?;
        let record = read_record(&self.connection, source_id)?
            .ok_or_else(|| invalid("Image document is unavailable"))?;
        if page_index >= record.total_pages
            || !matches!(record.format, DocumentFormat::Pdf | DocumentFormat::Images)
        {
            return Err(invalid("Source page index is unavailable"));
        }
        let encoded = self
            .connection
            .query_row(
                "SELECT block FROM document_pages p JOIN document_blocks b
             ON b.source_id=p.source_id AND b.resource=p.resource_id AND b.block_id=p.block_id
             WHERE p.source_id=?1 AND p.page_index=?2",
                params![source_id, page_index],
                |row| json(row, 0, crate::document_validation::ROW_BYTES),
            )
            .optional()?
            .ok_or_else(|| invalid("Source page has no registered block"))?;
        let block: DocumentBlock = serde_json::from_str(&encoded)?;
        Ok(ImagePageDescriptor {
            source_id: source_id.into(),
            content_revision: record.content_revision,
            page_index,
            resource_id: block
                .image
                .as_ref()
                .map_or_else(|| block.resource.clone(), |image| image.resource_id.clone()),
            position: DocumentPosition {
                parser_revision: record.parser_revision,
                resource: block.resource,
                block_id: block.id,
                offset: 0,
            },
        })
    }

    pub fn image_page_for_resource(
        &self,
        source_id: &str,
        resource_id: &str,
    ) -> Result<ImagePageDescriptor, StorageError> {
        validate::field(source_id)?;
        validate::field(resource_id)?;
        let page_index: u32 = self
            .connection
            .query_row(
                "SELECT page_index FROM document_pages
             WHERE source_id=?1 AND resource_id=?2 ORDER BY page_index LIMIT 1",
                params![source_id, resource_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| invalid("Resource is not a registered source page"))?;
        let descriptor = self.image_page(source_id, page_index)?;
        if descriptor.resource_id != resource_id {
            return Err(invalid("Source page resource disagrees with registry"));
        }
        Ok(descriptor)
    }

    pub fn image_reader_settings(
        &self,
        source_id: &str,
    ) -> Result<ImageReaderSettings, StorageError> {
        validate::field(source_id)?;
        read_record(&self.connection, source_id)?
            .ok_or_else(|| invalid("Image document is unavailable"))?;
        let encoded = self
            .connection
            .query_row(
                "SELECT settings FROM image_reader_settings WHERE source_id=?1",
                [source_id],
                |row| json(row, 0, 2048),
            )
            .optional()?;
        encoded.map_or_else(
            || Ok(ImageReaderSettings::default()),
            |encoded| Ok(serde_json::from_str(&encoded)?),
        )
    }

    pub fn save_image_reader_settings(
        &mut self,
        source_id: &str,
        settings: &ImageReaderSettings,
    ) -> Result<(), StorageError> {
        validate::field(source_id)?;
        read_record(&self.connection, source_id)?
            .ok_or_else(|| invalid("Image document is unavailable"))?;
        self.connection.execute("INSERT INTO image_reader_settings VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET settings=excluded.settings",
            params![source_id, serde_json::to_string(settings)?])?;
        Ok(())
    }
    /// A process restart cannot resume an in-flight host SDK callback.
    pub fn interrupt_ocr(&mut self) -> Result<(), StorageError> {
        self.connection.execute(
            "UPDATE ocr_jobs SET state='cancelled' WHERE state='pending'",
            [],
        )?;
        Ok(())
    }

    pub fn ocr_page(
        &self,
        source: &str,
        resource: &str,
        revision: Option<u32>,
    ) -> Result<Option<OcrPage>, StorageError> {
        read_page(&self.connection, source, resource, revision)
    }

    pub fn ocr_evidence(
        &self,
        source: &str,
        resource: &str,
        revision: u32,
    ) -> Result<OcrEvidence, StorageError> {
        validate::field(source)?;
        validate::field(resource)?;
        let encoded = self.connection.query_row(
            "SELECT evidence FROM ocr_pages WHERE source_id=?1 AND resource_id=?2 AND revision=?3",
            params![source, resource, revision], |row| json(row, 0, OCR_BYTES),
        ).optional()?.ok_or_else(|| invalid("OCR evidence revision is unavailable"))?;
        Ok(serde_json::from_str(&encoded)?)
    }

    pub fn ocr_plan(&self, id: &str) -> Result<OcrPlan, StorageError> {
        validate::field(id)?;
        let encoded = self
            .connection
            .query_row(
                "SELECT plan FROM ocr_jobs WHERE request_id=?1 AND state!='cancelled'",
                [id],
                |row| json(row, 0, 16384),
            )
            .optional()?
            .ok_or_else(|| invalid("OCR request is cancelled, interrupted or unavailable"))?;
        Ok(serde_json::from_str(&encoded)?)
    }

    pub fn ocr_recovery(&self, request: &OcrRequest) -> Result<OcrRecovery, StorageError> {
        validate::request(request)?;
        let previous: Option<(String, String, Option<u32>)> = self
            .connection
            .query_row(
                "SELECT request,state,revision FROM ocr_jobs WHERE request_id=?1",
                [&request.request_id],
                |row| Ok((json(row, 0, 16384)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((original, state, revision)) = previous {
            if original != serde_json::to_string(request)? {
                return Err(invalid(
                    "OCR request identity reused for different contents",
                ));
            }
            return match state.as_str() {
                "pending" => Ok(OcrRecovery::Pending),
                "cancelled" => Ok(OcrRecovery::Cancelled),
                "completed" => {
                    let revision =
                        revision.ok_or_else(|| invalid("Completed OCR revision is missing"))?;
                    let page = self
                        .ocr_page(&request.source_id, &request.resource_id, Some(revision))?
                        .ok_or_else(|| invalid("Completed OCR result is unavailable"))?;
                    Ok(OcrRecovery::Completed {
                        page: Box::new(page),
                    })
                }
                _ => Err(invalid("Invalid saved OCR action state")),
            };
        }
        let cancelled: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM ocr_cancellations WHERE request_id=?1)",
            [&request.request_id],
            |row| row.get(0),
        )?;
        Ok(if cancelled {
            OcrRecovery::Cancelled
        } else {
            OcrRecovery::Unknown
        })
    }

    pub fn plan_ocr(
        &mut self,
        request: &OcrRequest,
        plan: &OcrPlan,
    ) -> Result<OcrPlan, StorageError> {
        validate::request(request)?;
        let expected = OcrRequest {
            request_id: plan.request_id.clone(),
            source_id: plan.source_id.clone(),
            content_revision: plan.content_revision.clone(),
            resource_id: plan.resource_id.clone(),
            provider_id: plan.provider_id.clone(),
            recognition_languages: plan.recognition_languages.clone(),
            crop: plan.crop.clone(),
        };
        if request != &expected || plan.path.len() > 4096 {
            return Err(invalid("OCR plan does not match its admitted request"));
        }
        let encoded = serde_json::to_string(request)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let cancelled: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM ocr_cancellations WHERE request_id=?1)",
            [&request.request_id],
            |row| row.get(0),
        )?;
        if cancelled {
            return Err(invalid(
                "OCR request was cancelled before admission; retry with a new action identity",
            ));
        }
        source_revision(
            &tx,
            &request.source_id,
            &request.content_revision,
            &request.resource_id,
        )?;
        let previous: Option<(String, String)> = tx
            .query_row(
                "SELECT request,state FROM ocr_jobs WHERE request_id=?1",
                [&request.request_id],
                |row| Ok((json(row, 0, 16384)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((old, state)) = previous {
            if old != encoded {
                return Err(invalid(
                    "OCR request identity reused for different contents",
                ));
            }
            if state == "cancelled" {
                return Err(invalid(
                    "OCR request was cancelled; retry with a new action identity",
                ));
            }
            let another: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM ocr_jobs WHERE state='pending' AND request_id!=?1)",
                [&request.request_id],
                |row| row.get(0),
            )?;
            if another {
                return Err(invalid("Another OCR action is already admitted"));
            }
            tx.execute(
                "UPDATE ocr_jobs SET plan=?2 WHERE request_id=?1",
                params![request.request_id, serde_json::to_string(plan)?],
            )?;
            tx.commit()?;
            return Ok(plan.clone());
        }
        let busy: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM ocr_jobs WHERE state='pending')",
            [],
            |row| row.get(0),
        )?;
        if busy {
            return Err(invalid(
                "OCR is busy; cancel the admitted request before retrying",
            ));
        }
        let current = read_page(&tx, &request.source_id, &request.resource_id, None)?;
        tx.execute("INSERT INTO ocr_jobs(request_id,request,plan,base_revision,state) VALUES(?1,?2,?3,?4,'pending')",
            params![request.request_id, encoded, serde_json::to_string(plan)?, current.map(|page| page.ocr_revision)])?;
        tx.execute("DELETE FROM ocr_jobs WHERE state!='pending' AND sequence<=(SELECT COALESCE(MAX(sequence),0)-256 FROM ocr_jobs)", [])?;
        tx.commit()?;
        Ok(plan.clone())
    }

    pub fn cancel_ocr(&mut self, id: &str) -> Result<(), StorageError> {
        validate::field(id)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE ocr_jobs SET state='cancelled' WHERE request_id=?1 AND state='pending'",
            [id],
        )?;
        // A cancel may beat its queued plan across the native bridge. Keep a
        // bounded tombstone so that delayed transport cannot resurrect it.
        tx.execute("INSERT INTO ocr_cancellations(request_id) VALUES(?1) ON CONFLICT(request_id) DO NOTHING", [id])?;
        tx.execute("DELETE FROM ocr_cancellations WHERE sequence<=(SELECT COALESCE(MAX(sequence),0)-256 FROM ocr_cancellations)", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn complete_ocr(&mut self, result: &OcrNativeResult) -> Result<OcrPage, StorageError> {
        validate::field(&result.request_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let job = tx.query_row(
            "SELECT request,base_revision,state,result_digest,revision FROM ocr_jobs WHERE request_id=?1",
            [&result.request_id], |row| Ok(CompletionJob {
                request:json(row, 0, 16384)?,base:row.get(1)?,state:row.get(2)?,
                previous_digest:row.get(3)?,committed_revision:row.get(4)?,
            }),
        ).optional()?;
        let CompletionJob {
            request,
            base,
            state,
            previous_digest,
            committed_revision,
        } = job.ok_or_else(|| invalid("OCR request was not admitted"))?;
        let request: OcrRequest = serde_json::from_str(&request)?;
        let digest = Sha256::digest(serde_json::to_vec(result)?).to_vec();
        if state == "completed" {
            if previous_digest.as_ref() != Some(&digest) {
                return Err(invalid(
                    "OCR completion identity reused for different evidence",
                ));
            }
            return read_page(
                &tx,
                &request.source_id,
                &request.resource_id,
                committed_revision,
            )?
            .ok_or_else(|| invalid("Committed OCR revision is unavailable"));
        }
        if state != "pending" {
            return Err(invalid("Cancelled OCR completion cannot publish"));
        }
        source_revision(
            &tx,
            &request.source_id,
            &request.content_revision,
            &request.resource_id,
        )?;
        let previous = read_page(&tx, &request.source_id, &request.resource_id, None)?;
        if previous.as_ref().map(|page| page.ocr_revision) != base {
            return Err(invalid("OCR completion is stale after another page edit"));
        }
        validate::provider(&result.provider)?;
        validate::regions(&result.regions)?;
        validate::stages(result)?;
        if result
            .regions
            .iter()
            .any(|r| r.context_region_ids.is_some())
        {
            return Err(invalid(
                "Nearby OCR context must be assigned by package projection or explicit correction",
            ));
        }
        if result.provider.id != request.provider_id
            || request
                .recognition_languages
                .iter()
                .any(|language| !result.provider.languages.contains(language))
            || result
                .regions
                .iter()
                .any(|region| region.reading_of.is_some())
            || request.crop.is_some() != result.crop.is_some()
        {
            return Err(invalid(
                "OCR provider evidence does not match admitted capability or crop",
            ));
        }
        if let (Some(requested), Some(actual)) = (&request.crop, &result.crop) {
            validate::rect(actual)?;
            let epsilon_x = 1.01 / f64::from(result.width.max(1));
            let epsilon_y = 1.01 / f64::from(result.height.max(1));
            if (requested.x - actual.x).abs() > epsilon_x
                || (requested.y - actual.y).abs() > epsilon_y
                || (requested.x + requested.width - actual.x - actual.width).abs() > epsilon_x
                || (requested.y + requested.height - actual.y - actual.height).abs() > epsilon_y
            {
                return Err(invalid(
                    "OCR physical crop differs from admitted source bounds",
                ));
            }
        }
        let revision = next_revision(previous.as_ref())?;
        let mut regions = result.regions.clone();
        if let Some(crop) = &result.crop {
            if result
                .regions
                .iter()
                .any(|region| !validate::intersects(region, crop))
            {
                return Err(invalid(
                    "OCR crop observations must intersect the actual source crop",
                ));
            }
            if let Some(previous) = read_base_page(&tx, &request.source_id, &request.resource_id)? {
                if previous.width != result.width
                    || previous.height != result.height
                    || previous.provider.id != result.provider.id
                    || previous.provider.revision != result.provider.revision
                {
                    return Err(invalid(
                        "Crop replacement requires the same source dimensions and provider revision",
                    ));
                }
                let mut retained: Vec<_> = previous
                    .regions
                    .iter()
                    .filter(|region| !validate::intersects(region, crop))
                    .cloned()
                    .collect();
                // Provider observation IDs are local to its actual request. The
                // raw result keeps them; projection IDs namespace crop additions.
                for region in &mut regions {
                    region.id = format!("{revision}:{}", region.id);
                }
                let retained_ids: std::collections::BTreeSet<_> =
                    retained.iter().map(|region| region.id.clone()).collect();
                for region in &mut retained {
                    if region
                        .reading_of
                        .as_ref()
                        .is_some_and(|id| !retained_ids.contains(id))
                    {
                        region.reading_of = None;
                    }
                    if region
                        .context_region_ids
                        .as_ref()
                        .is_some_and(|ids| ids.iter().any(|id| !retained_ids.contains(id)))
                    {
                        region.context_region_ids = None;
                    }
                }
                retained.extend(regions);
                regions = retained;
            }
        }
        let page = OcrPage {
            source_id: request.source_id.clone(),
            content_revision: request.content_revision.clone(),
            resource_id: request.resource_id.clone(),
            ocr_revision: revision,
            provider: result.provider.clone(),
            width: result.width,
            height: result.height,
            crop: result.crop.clone(),
            regions,
        };
        let evidence = OcrEvidence {
            source_id: page.source_id.clone(),
            resource_id: page.resource_id.clone(),
            ocr_revision: revision,
            parent_revision: base,
            request: Some(request),
            result: Some(result.clone()),
            correction: None,
            package: None,
        };
        save_page(&tx, &page, &evidence)?;
        tx.execute("UPDATE ocr_jobs SET state='completed',result_digest=?2,revision=?3 WHERE request_id=?1",
            params![result.request_id, digest, revision])?;
        tx.commit()?;
        Ok(page)
    }

    pub fn correct_ocr(&mut self, command: &OcrCorrection) -> Result<OcrPage, StorageError> {
        validate::field(&command.command_id)?;
        let digest = Sha256::digest(serde_json::to_vec(command)?).to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let receipt: Option<(Vec<u8>, String, String, u32)> = tx.query_row(
            "SELECT digest,source_id,resource_id,revision FROM ocr_corrections WHERE command_id=?1", [&command.command_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional()?;
        if let Some((old, source, resource, revision)) = receipt {
            if old != digest {
                return Err(invalid(
                    "OCR correction identity reused for different contents",
                ));
            }
            return read_page(&tx, &source, &resource, Some(revision))?
                .ok_or_else(|| invalid("OCR correction revision unavailable"));
        }
        source_revision(
            &tx,
            &command.source_id,
            &command.content_revision,
            &command.resource_id,
        )?;
        let mut page = read_page(&tx, &command.source_id, &command.resource_id, None)?
            .ok_or_else(|| invalid("Recognize this page before correcting a region"))?;
        if page.ocr_revision != command.expected_revision {
            return Err(StorageError::Conflict);
        }
        let next = next_revision(Some(&page))?;
        // User edits apply to provider/user data, never bake package-derived
        // interpretation into the package-independent cache.
        page = read_base_page(&tx, &command.source_id, &command.resource_id)?
            .ok_or_else(|| invalid("Original OCR provider page is unavailable"))?;
        let region = page
            .regions
            .iter_mut()
            .find(|region| region.id == command.region.id)
            .ok_or_else(|| invalid("OCR correction region is unavailable"))?;
        if region.candidates != command.region.candidates {
            return Err(invalid(
                "A user correction cannot rewrite raw provider candidates",
            ));
        }
        *region = command.region.clone();
        page.ocr_revision = next;
        let evidence = OcrEvidence {
            source_id: page.source_id.clone(),
            resource_id: page.resource_id.clone(),
            ocr_revision: page.ocr_revision,
            parent_revision: Some(command.expected_revision),
            request: None,
            result: None,
            correction: Some(command.clone()),
            package: None,
        };
        save_page(&tx, &page, &evidence)?;
        tx.execute(
            "INSERT INTO ocr_corrections VALUES(?1,?2,?3,?4,?5)",
            params![
                command.command_id,
                digest,
                page.source_id,
                page.resource_id,
                page.ocr_revision
            ],
        )?;
        tx.commit()?;
        Ok(page)
    }

    pub fn project_ocr(
        &mut self,
        original: &OcrPage,
        regions: &[OcrRegion],
        package: &OcrPackageProjection,
    ) -> Result<OcrPage, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut page = read_page(&tx, &original.source_id, &original.resource_id, None)?
            .ok_or_else(|| invalid("OCR page is unavailable"))?;
        if &page != original
            && read_base_page(&tx, &original.source_id, &original.resource_id)?.as_ref()
                != Some(original)
        {
            return Err(StorageError::Conflict);
        }
        let current_evidence: String = tx.query_row(
            "SELECT evidence FROM ocr_pages WHERE source_id=?1 AND resource_id=?2 AND revision=?3",
            params![page.source_id, page.resource_id, page.ocr_revision],
            |row| json(row, 0, OCR_BYTES),
        )?;
        let current_evidence: OcrEvidence = serde_json::from_str(&current_evidence)?;
        if current_evidence.package.as_ref() == Some(package) && page.regions == regions {
            return Ok(page);
        }
        let record =
            read_record(&tx, &page.source_id)?.ok_or_else(|| invalid("OCR source unavailable"))?;
        if record.package_id != package.package_id
            || record.package_version != package.package_version
        {
            return Err(invalid("OCR package selection changed"));
        }
        if regions.len() != original.regions.len()
            || regions.iter().any(|new| {
                original
                    .regions
                    .iter()
                    .find(|old| old.id == new.id)
                    .is_none_or(|old| {
                        new.quad != old.quad
                            || new.candidates != old.candidates
                            || new.text != old.text
                    })
            })
        {
            return Err(invalid(
                "OCR package must preserve observation identity, geometry and candidates",
            ));
        }
        page.regions = regions.to_vec();
        page.ocr_revision = next_revision(Some(&page))?;
        save_page(
            &tx,
            &page,
            &OcrEvidence {
                source_id: page.source_id.clone(),
                resource_id: page.resource_id.clone(),
                ocr_revision: page.ocr_revision,
                parent_revision: Some(original.ocr_revision),
                request: None,
                result: None,
                correction: None,
                package: Some(package.clone()),
            },
        )?;
        tx.commit()?;
        Ok(page)
    }
}
