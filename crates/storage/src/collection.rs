use crate::{
    ProfileStore, StorageError, knowledge, material_read::read_material,
    material_validation::bounded, review_read,
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Serialize, Deserialize)]
enum CursorValue {
    Text(String),
    Due(Option<i64>),
}

impl CursorValue {
    fn sql(&self) -> Value {
        match self {
            Self::Text(value) => Value::Text(value.clone()),
            Self::Due(Some(value)) => Value::Integer(*value),
            Self::Due(None) => Value::Null,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Cursor {
    fingerprint: String,
    package_revision: Option<String>,
    knowledge_revision: u32,
    material_revision: u32,
    value: CursorValue,
    id: String,
}

struct FilterSql<'a> {
    metadata: &'a CollectionDescription,
    surface: CollectionSurface,
    values: Vec<Value>,
    nodes: u32,
    catalog_filter: bool,
}

impl FilterSql<'_> {
    fn bind(&mut self, value: String) -> String {
        self.values.push(Value::Text(value));
        format!("?{}", self.values.len())
    }

    fn filter(&mut self, filter: &CollectionFilter, depth: u32) -> Result<String, StorageError> {
        self.nodes += 1;
        if self.nodes > 64 || depth > 8 {
            return Err(StorageError::Invalid(
                "Collection filter exceeds bounds".into(),
            ));
        }
        let material = matches!(self.surface, CollectionSurface::Material);
        let target_materials = "SELECT 1 FROM materials fm WHERE fm.package_id=t.package_id AND fm.target_id=t.target_id";
        match filter {
            CollectionFilter::All { filters } | CollectionFilter::Any { filters } => {
                let all = matches!(filter, CollectionFilter::All { .. });
                let mut parts = Vec::with_capacity(filters.len().min(64));
                for child in filters {
                    parts.push(self.filter(child, depth + 1)?);
                }
                if parts.is_empty() {
                    return Ok(if all { "1" } else { "0" }.into());
                }
                Ok(format!(
                    "({})",
                    parts.join(if all { " AND " } else { " OR " })
                ))
            }
            CollectionFilter::Not { filter } => {
                Ok(format!("NOT ({})", self.filter(filter, depth + 1)?))
            }
            CollectionFilter::Text { text } => {
                if text.len() > 2048 {
                    return Err(StorageError::Invalid(
                        "Collection search exceeds bounds".into(),
                    ));
                }
                let value = self.bind(text.trim().to_lowercase());
                Ok(format!(
                    "instr({}, {value})>0",
                    if material {
                        "m.search_text"
                    } else {
                        "t.search_text"
                    }
                ))
            }
            CollectionFilter::Scope { id } => {
                self.catalog_filter = true;
                if !self.metadata.scopes.iter().any(|scope| &scope.id == id) {
                    return Err(StorageError::Invalid(
                        "Collection scope is unavailable".into(),
                    ));
                }
                let value = self.bind(id.clone());
                Ok(format!(
                    "EXISTS(SELECT 1 FROM collection_scopes f WHERE f.package_id=t.package_id AND f.target_id=t.target_id AND f.scope_id={value})"
                ))
            }
            CollectionFilter::Level { scale_id, level } => {
                self.catalog_filter = true;
                if !self
                    .metadata
                    .levels
                    .iter()
                    .any(|value| &value.scale_id == scale_id && &value.level == level)
                {
                    return Err(StorageError::Invalid(
                        "Collection level is unavailable".into(),
                    ));
                }
                let scale = self.bind(scale_id.clone());
                let level = self.bind(level.clone());
                Ok(format!(
                    "EXISTS(SELECT 1 FROM collection_levels f WHERE f.package_id=t.package_id AND f.target_id=t.target_id AND f.scale_id={scale} AND f.level={level})"
                ))
            }
            CollectionFilter::Capability { capability, states } => {
                self.catalog_filter = true;
                if states.is_empty()
                    || states.len() > 5
                    || !self
                        .metadata
                        .capabilities
                        .iter()
                        .any(|value| &value.id == capability)
                {
                    return Err(StorageError::Invalid(
                        "Collection capability is unavailable".into(),
                    ));
                }
                let capability = self.bind(capability.clone());
                let mut seen = BTreeSet::new();
                let mut values = Vec::with_capacity(states.len());
                for state in states {
                    let name = match state {
                        CollectionKnowledgeState::Untracked => "untracked",
                        CollectionKnowledgeState::ClaimedKnown => "claimed_known",
                        CollectionKnowledgeState::ClaimedUnknown => "claimed_unknown",
                        CollectionKnowledgeState::AssessedKnown => "assessed_known",
                        CollectionKnowledgeState::AssessedUnknown => "assessed_unknown",
                    };
                    if !seen.insert(name) {
                        return Err(StorageError::Invalid("Duplicate collection state".into()));
                    }
                    values.push(self.bind(name.into()));
                }
                let state = knowledge::state_sql("t.package_id", "t.target_id", &capability);
                Ok(format!(
                    "(EXISTS(SELECT 1 FROM collection_capabilities f WHERE f.package_id=t.package_id AND f.target_id=t.target_id AND f.capability={capability}) AND ({state}) IN ({}))",
                    values.join(",")
                ))
            }
            CollectionFilter::Material { state } => {
                let exists = format!("EXISTS({target_materials})");
                let excluded = if material {
                    "m.excluded=1".into()
                } else {
                    format!("EXISTS({target_materials} AND fm.excluded=1)")
                };
                Ok(match state {
                    CollectionMaterialState::Saved if material => "1".into(),
                    CollectionMaterialState::Unsaved if material => "0".into(),
                    CollectionMaterialState::Saved => exists,
                    CollectionMaterialState::Unsaved => format!("NOT ({exists})"),
                    CollectionMaterialState::Excluded => excluded,
                    CollectionMaterialState::NotExcluded => format!("NOT ({excluded})"),
                })
            }
            CollectionFilter::Source { source_id } => {
                bounded(source_id, 512)?;
                let source = self.bind(source_id.clone());
                // This is saved-Material provenance, not an assertion that an
                // entire source has been linguistically indexed.
                // Nullable predicates must return false, not SQL NULL, so NOT
                // includes independently authored Material without that value.
                Ok(if material {
                    format!("m.source_id IS {source}")
                } else {
                    format!("EXISTS({target_materials} AND fm.source_id={source})")
                })
            }
            CollectionFilter::EntityKind { id } => {
                self.catalog_filter = true;
                if !self.metadata.kinds.iter().any(|kind| &kind.id == id) {
                    return Err(StorageError::Invalid(
                        "Collection target kind is unavailable".into(),
                    ));
                }
                let kind = self.bind(id.clone());
                Ok(format!("t.entity_kind IS {kind}"))
            }
        }
    }
}

fn item(
    db: &Connection,
    surface: CollectionSurface,
    package_id: &str,
    id: &str,
) -> Result<CollectionItem, StorageError> {
    let material = match surface {
        CollectionSurface::Knowledge => None,
        CollectionSurface::Material => Some(read_material(db, &MaterialId(id.into()))?),
    };
    let target_id = match &material {
        Some(material) => material.content.target_id.as_deref(),
        None => Some(id),
    };
    let target: Option<CollectionTarget> = match target_id {
        Some(target_id) => db
            .query_row(
                "SELECT t.document FROM collection_targets t JOIN collection_catalogs c ON c.package_id=t.package_id WHERE t.package_id=?1 AND t.target_id=?2 AND c.processed=c.total",
                params![package_id, target_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|json| serde_json::from_str(&json))
            .transpose()?,
        None => None,
    };
    let mut knowledge = Vec::new();
    if let Some(target) = &target {
        for capability in &target.capabilities {
            knowledge.push(review_read::projection(
                db,
                &KnowledgeKey {
                    package_id: package_id.into(),
                    target_id: target.summary.target_id.clone(),
                    capability: capability.clone(),
                },
            )?);
        }
    }
    match material {
        Some(material) => Ok(CollectionItem::Material {
            material: Box::new(material),
            target,
            knowledge,
        }),
        None => {
            let target =
                target.ok_or_else(|| StorageError::Invalid("Catalog target is missing".into()))?;
            let material_count = db.query_row(
                "SELECT COUNT(*) FROM materials WHERE package_id=?1 AND target_id=?2",
                params![package_id, target.summary.target_id],
                |r| r.get(0),
            )?;
            Ok(CollectionItem::Target {
                target,
                knowledge,
                material_count,
            })
        }
    }
}

impl ProfileStore {
    pub fn collection_catalog_revision(
        &self,
        package_id: &str,
    ) -> Result<Option<String>, StorageError> {
        bounded(package_id, 512)?;
        Ok(self
            .connection
            .query_row(
                "SELECT revision FROM collection_catalogs WHERE package_id=?1",
                [package_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn collection_description(
        &self,
        package_id: &str,
    ) -> Result<Option<CollectionDescription>, StorageError> {
        bounded(package_id, 512)?;
        self.connection
            .query_row(
                "SELECT description FROM collection_catalogs WHERE package_id=?1",
                [package_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|json| Ok(serde_json::from_str(&json)?))
            .transpose()
    }

    pub fn evict_collection_catalog(&mut self, package_id: &str) -> Result<(), StorageError> {
        bounded(package_id, 512)?;
        self.connection.execute(
            "DELETE FROM collection_catalogs WHERE package_id=?1",
            [package_id],
        )?;
        Ok(())
    }

    pub fn collection(&self, query: &CollectionQuery) -> Result<CollectionResult, StorageError> {
        if let Some(package_id) = &query.package_id {
            bounded(package_id, 512)?;
        }
        let tx = self.connection.unchecked_transaction()?;
        let catalog: Option<(String,String,u32,u32)> = match &query.package_id {
            Some(package_id) => tx.query_row(
                "SELECT revision,description,processed,total FROM collection_catalogs WHERE package_id=?1",
                [package_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
            ).optional()?,
            None => None,
        };
        let mut preparing = None;
        let (package_revision, metadata) = match catalog {
            Some((revision, json, processed, total)) => {
                if processed != total {
                    preparing = Some((processed, total));
                }
                (
                    Some(revision),
                    serde_json::from_str::<CollectionDescription>(&json)?,
                )
            }
            None => match query.surface {
                CollectionSurface::Knowledge => {
                    return Ok(CollectionResult::Unavailable {
                        message: "This package has no prepared collection catalog".into(),
                    });
                }
                CollectionSurface::Material => (
                    None,
                    CollectionDescription {
                        capabilities: Vec::new(),
                        kinds: Vec::new(),
                        scopes: Vec::new(),
                        levels: Vec::new(),
                    },
                ),
            },
        };
        let mut filter = FilterSql {
            metadata: &metadata,
            surface: query.surface,
            values: vec![match &query.package_id {
                Some(package_id) => Value::Text(package_id.clone()),
                None => Value::Null,
            }],
            nodes: 0,
            catalog_filter: false,
        };
        let predicate = filter.filter(&query.filter, 0)?;
        if let Some((processed, total)) = preparing
            && (query.surface == CollectionSurface::Knowledge || filter.catalog_filter)
        {
            return Ok(CollectionResult::Preparing { processed, total });
        }
        let (from, id, package, due, label) = match query.surface {
            CollectionSurface::Knowledge => (
                "collection_targets t",
                "t.target_id",
                "t.package_id",
                "(SELECT MIN(json_extract(s.document,'$.dueAt')) FROM review_schedules s JOIN materials sm ON sm.id=s.material_id WHERE sm.package_id=t.package_id AND sm.target_id=t.target_id AND sm.excluded=0)",
                "t.sort_label",
            ),
            CollectionSurface::Material => (
                "materials m LEFT JOIN collection_targets t ON t.package_id=m.package_id AND t.target_id=m.target_id",
                "m.id",
                "m.package_id",
                "(SELECT MIN(json_extract(s.document,'$.dueAt')) FROM review_schedules s WHERE s.material_id=m.id)",
                "json_extract(m.content,'$.phrase')",
            ),
        };
        let sort = match query.sort {
            CollectionSort::Default => id,
            CollectionSort::LabelAscending | CollectionSort::LabelDescending => label,
            CollectionSort::DueAscending | CollectionSort::DueDescending => due,
        };
        let descending = matches!(
            query.sort,
            CollectionSort::LabelDescending | CollectionSort::DueDescending
        );
        let direction = if descending { "DESC" } else { "ASC" };
        let comparison = if descending { "<" } else { ">" };
        let package_filter = match query.package_id {
            Some(_) => format!("{package}=?1"),
            None => "?1 IS NULL".into(),
        };
        let membership = format!("FROM {from} WHERE {package_filter} AND ({predicate})");
        let count = tx.query_row(
            &format!("SELECT COUNT(*) {membership}"),
            params_from_iter(&filter.values),
            |r| r.get(0),
        )?;
        let knowledge_revision: u32 = tx.query_row(
            "SELECT revision FROM knowledge_revision WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        let material_revision: u32 = tx.query_row(
            "SELECT revision FROM collection_revision WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                &query.package_id,
                query.surface,
                &query.filter,
                query.sort,
            ))?)
        );
        let continuation = if let Some(after) = &query.after {
            bounded(after, 8192)?;
            let cursor: Cursor = serde_json::from_str(after)?;
            let due = matches!(
                query.sort,
                CollectionSort::DueAscending | CollectionSort::DueDescending
            );
            if cursor.fingerprint != fingerprint
                || cursor.package_revision != package_revision
                || cursor.knowledge_revision != knowledge_revision
                || cursor.material_revision != material_revision
                || matches!(&cursor.value, CursorValue::Due(_)) != due
            {
                return Err(StorageError::Conflict);
            }
            let key = cursor.value.sql();
            let missing = i64::from(matches!(key, Value::Null));
            filter.values.push(Value::Integer(missing));
            let missing_parameter = filter.values.len();
            filter.values.push(key);
            let key_parameter = filter.values.len();
            filter.values.push(Value::Text(cursor.id));
            let id_parameter = filter.values.len();
            format!(
                "WHERE ((sort_key IS NULL)>?{missing_parameter} OR ((sort_key IS NULL)=?{missing_parameter} AND (sort_key {comparison} ?{key_parameter} OR (sort_key IS ?{key_parameter} AND item_id {comparison} ?{id_parameter}))))"
            )
        } else {
            String::new()
        };
        let sql = format!(
            "SELECT item_id,sort_key,item_package FROM (SELECT {id} AS item_id,{sort} AS sort_key,{package} AS item_package {membership}) {continuation} ORDER BY (sort_key IS NULL) ASC,sort_key {direction},item_id {direction} LIMIT 25"
        );
        let rows = {
            let mut statement = tx.prepare(&sql)?;
            statement
                .query_map(params_from_iter(&filter.values), |r| {
                    let value = match r.get::<_, Value>(1)? {
                        Value::Text(value) => CursorValue::Text(value),
                        Value::Integer(value) => CursorValue::Due(Some(value)),
                        Value::Null => CursorValue::Due(None),
                        value => {
                            return Err(rusqlite::Error::InvalidColumnType(
                                1,
                                "sort_key".into(),
                                value.data_type(),
                            ));
                        }
                    };
                    Ok((r.get::<_, String>(0)?, value, r.get::<_, String>(2)?))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut page = CollectionPage {
            items: Vec::new(),
            count,
            next: None,
            package_revision: package_revision.clone(),
            knowledge_revision,
            material_revision,
        };
        for (index, (id, value, package_id)) in rows.iter().take(24).enumerate() {
            let previous = page.next.clone();
            page.items.push(item(&tx, query.surface, package_id, id)?);
            page.next = if index + 1 < rows.len() {
                Some(serde_json::to_string(&Cursor {
                    fingerprint: fingerprint.clone(),
                    package_revision: package_revision.clone(),
                    knowledge_revision,
                    material_revision,
                    id: id.clone(),
                    value: value.clone(),
                })?)
            } else {
                None
            };
            if serde_json::to_vec(&page)?.len() > 262144 {
                page.items.pop();
                page.next = previous;
                if page.items.is_empty() {
                    return Err(StorageError::Invalid(
                        "Collection item exceeds page wire budget".into(),
                    ));
                }
                break;
            }
        }
        tx.commit()?;
        Ok(CollectionResult::Ready { page })
    }
}
