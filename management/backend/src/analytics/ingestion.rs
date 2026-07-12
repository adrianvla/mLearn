use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    analytics::rollups::rebuild_daily_rollups_in_transaction,
    error::AppError,
    identity::{IdentityType, Principal},
};

const MAX_BATCH: usize = 100;
const MAX_ID: usize = 256;
const MAX_TITLE: usize = 512;
const MAX_AGE_SECONDS: i64 = 90 * 24 * 60 * 60;
const MAX_FUTURE_SECONDS: i64 = 5 * 60;
const MAX_PAGE: i64 = 10_000_000;
const MAX_DURATION_MILLIS: i64 = 7 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IngestionBatch {
    pub schema_version: u8,
    pub events: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityEvent {
    pub schema_version: u8,
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: String,
    pub source_id: String,
    pub active_group_id: String,
    pub policy_version_id: String,
    pub sequence: i64,
    pub occurred_at: String,
    pub activity: Activity,
    pub context: ActivityContext,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Activity {
    Idle,
    Reader {
        #[serde(rename = "workName")]
        work_name: String,
        #[serde(rename = "currentPage")]
        current_page: i64,
        #[serde(rename = "totalPages")]
        total_pages: i64,
    },
    Video {
        #[serde(rename = "workName")]
        work_name: String,
        #[serde(rename = "currentTimeSeconds")]
        current_time_seconds: f64,
        #[serde(rename = "durationSeconds")]
        duration_seconds: Option<f64>,
    },
    Flashcards,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityContext {
    pub content_id: Option<String>,
    pub language: Option<String>,
    pub privacy: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IngestionResult {
    pub accepted_ids: Vec<String>,
    pub duplicate_ids: Vec<String>,
    pub rejected: Vec<RejectedEvent>,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RejectedEvent {
    pub id: String,
    pub code: &'static str,
    pub retryable: bool,
}

#[derive(Clone)]
pub struct AnalyticsIngestionService {
    pool: SqlitePool,
}
impl AnalyticsIngestionService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
    pub async fn ingest(
        &self,
        principal: &Principal,
        batch: IngestionBatch,
    ) -> Result<IngestionResult, AppError> {
        if principal.service_key_id.is_some() || principal.identity_type != IdentityType::Learner {
            return Err(AppError::Forbidden("learner session required".into()));
        }
        if batch.events.is_empty() || batch.events.len() > MAX_BATCH {
            return Err(AppError::BadRequest(
                "analytics batch must contain 1 to 100 events".into(),
            ));
        }
        let mut id_counts = HashMap::new();
        for raw in &batch.events {
            let id = raw
                .get("id")
                .and_then(serde_json::Value::as_str)
                .filter(|id| identifier(id))
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "every analytics event requires a bounded nonempty id".into(),
                    )
                })?;
            *id_counts.entry(id.to_owned()).or_insert(0_usize) += 1;
        }
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        let (group_id, ancestry) = live_scope(&mut tx, principal).await?;
        let retention_days = crate::policy::compiler::compile_in_transaction(&mut tx, &group_id)
            .await?
            .document
            .governance
            .activity_retention_days;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let mut result = IngestionResult {
            accepted_ids: vec![],
            duplicate_ids: vec![],
            rejected: vec![],
        };
        let mut seen_ids = HashSet::new();
        for raw in batch.events {
            let id = raw
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_owned();
            if !seen_ids.insert(id.clone()) {
                continue;
            }
            if id_counts.get(&id).copied().unwrap_or_default() > 1 {
                result.rejected.push(RejectedEvent {
                    id,
                    code: "duplicate_in_batch",
                    retryable: false,
                });
                continue;
            }
            let event: ActivityEvent = match serde_json::from_value(raw) {
                Ok(event) => event,
                Err(_) => {
                    result.rejected.push(RejectedEvent {
                        id,
                        code: "invalid_event",
                        retryable: false,
                    });
                    continue;
                }
            };
            let normalized = match normalize(batch.schema_version, event, &group_id, now) {
                Ok(value) => value,
                Err(code) => {
                    result.rejected.push(RejectedEvent {
                        id,
                        code,
                        retryable: false,
                    });
                    continue;
                }
            };
            if !policy_existed(
                &mut tx,
                &ancestry,
                &normalized.policy_version_id,
                normalized.occurred_at,
            )
            .await?
            {
                result.rejected.push(RejectedEvent {
                    id,
                    code: "invalid_scope",
                    retryable: false,
                });
                continue;
            }
            match insert_event(
                &mut tx,
                principal,
                &ancestry,
                &normalized,
                now,
                retention_days,
            )
            .await?
            {
                InsertOutcome::Accepted => result.accepted_ids.push(id),
                InsertOutcome::Duplicate => result.duplicate_ids.push(id),
                InsertOutcome::IdConflict => result.rejected.push(RejectedEvent {
                    id,
                    code: "id_conflict",
                    retryable: false,
                }),
                InsertOutcome::SequenceConflict => result.rejected.push(RejectedEvent {
                    id,
                    code: "sequence_conflict",
                    retryable: false,
                }),
            }
        }
        // Opportunistic, bounded cleanup for this learner. Daily aggregate rows are
        // intentionally independent and survive raw-event expiry.
        sqlx::query("INSERT OR IGNORE INTO analytics_retention_delete_queue(event_row_id) SELECT id FROM activity_events WHERE user_id=? AND retained_until<=? ORDER BY retained_until,id LIMIT 25")
            .bind(&principal.user_id).bind(now.saturating_mul(1_000)).execute(&mut *tx).await.map_err(db)?;
        sqlx::query("DELETE FROM activity_events WHERE id IN (SELECT event_row_id FROM analytics_retention_delete_queue)").execute(&mut *tx).await.map_err(db)?;
        sqlx::query("DELETE FROM analytics_retention_delete_queue")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
}

async fn live_scope(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
) -> Result<(String, Vec<String>), AppError> {
    let expected = principal
        .active_group_id
        .as_deref()
        .ok_or_else(|| AppError::InvalidActiveGroup("active group required".into()))?;
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let live: Option<String> = sqlx::query_scalar("SELECT s.active_group_id FROM sessions s JOIN users u ON u.id=s.user_id JOIN groups g ON g.id=s.active_group_id JOIN group_memberships m ON m.group_id=g.id AND m.user_id=u.id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.active_group_id=? AND u.status='active' AND u.identity_type='learner' AND g.status='active' AND m.status='active'")
        .bind(&principal.session_id).bind(&principal.user_id).bind(now).bind(expected).fetch_optional(&mut **tx).await.map_err(db)?;
    let group = live.ok_or(AppError::Unauthorized)?;
    let rows = sqlx::query("WITH RECURSIVE chain(id,parent_id,depth) AS (SELECT id,parent_id,0 FROM groups WHERE id=? AND status='active' UNION ALL SELECT g.id,g.parent_id,chain.depth+1 FROM groups g JOIN chain ON chain.parent_id=g.id WHERE g.status='active') SELECT id,parent_id FROM chain ORDER BY depth DESC")
        .bind(&group).fetch_all(&mut **tx).await.map_err(db)?;
    let chain: Vec<(String, Option<String>)> = rows
        .into_iter()
        .map(|r| (r.get("id"), r.get("parent_id")))
        .collect();
    if chain.is_empty()
        || chain.first().is_some_and(|row| row.1.is_some())
        || chain.last().map_or(true, |row| row.0 != group)
        || chain
            .windows(2)
            .any(|pair| pair[1].1.as_deref() != Some(pair[0].0.as_str()))
    {
        return Err(AppError::Unauthorized);
    }
    let ancestry = chain.into_iter().map(|row| row.0).collect();
    Ok((group, ancestry))
}

struct Normalized {
    id: String,
    event_type: String,
    session_id: String,
    source_id: String,
    policy_version_id: String,
    sequence: i64,
    occurred_at: i64,
    kind: &'static str,
    privacy: String,
    content_id: Option<String>,
    language: Option<String>,
    title: Option<String>,
    current_page: Option<i64>,
    total_pages: Option<i64>,
    current_time_millis: Option<i64>,
    duration_millis: Option<i64>,
    payload_hash: String,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
fn opaque_identifier(value: &str) -> bool {
    identifier(value)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}
fn normalize(
    batch_schema: u8,
    e: ActivityEvent,
    group: &str,
    now: i64,
) -> Result<Normalized, &'static str> {
    if batch_schema != 1 || e.schema_version != 1 {
        return Err("invalid_schema");
    }
    if ![
        &e.id,
        &e.session_id,
        &e.source_id,
        &e.active_group_id,
        &e.policy_version_id,
    ]
    .into_iter()
    .all(|v| identifier(v))
        || e.sequence <= 0
        || e.sequence > 9_007_199_254_740_991
    {
        return Err("invalid_event");
    }
    if e.active_group_id != group {
        return Err("active_group_mismatch");
    }
    if !matches!(
        e.event_type.as_str(),
        "activity.started" | "activity.progressed" | "activity.completed" | "activity.stopped"
    ) {
        return Err("invalid_event");
    }
    if e.context.privacy != "title-and-progress" && e.context.privacy != "progress-only" {
        return Err("invalid_event");
    }
    if e.context
        .content_id
        .as_deref()
        .is_some_and(|v| !opaque_identifier(v))
        || e.context
            .language
            .as_deref()
            .is_some_and(|v| !identifier(v))
    {
        return Err("invalid_event");
    }
    let parsed = OffsetDateTime::parse(&e.occurred_at, &Rfc3339).map_err(|_| "invalid_event")?;
    let occurred =
        i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).map_err(|_| "invalid_event")?;
    let now_millis = now.saturating_mul(1_000);
    if occurred < now_millis - MAX_AGE_SECONDS * 1_000 {
        return Err("event_too_old");
    }
    if occurred > now_millis + MAX_FUTURE_SECONDS * 1_000 {
        return Err("event_too_new");
    }
    let (kind, title, page, total, current, duration) = match &e.activity {
        Activity::Idle => ("idle", None, None, None, None, None),
        Activity::Flashcards => ("flashcards", None, None, None, None, None),
        Activity::Reader {
            work_name,
            current_page,
            total_pages,
        } => {
            if (work_name.is_empty() && e.context.privacy != "progress-only")
                || work_name.len() > MAX_TITLE
                || work_name.chars().any(char::is_control)
            {
                return Err(if work_name.len() > MAX_TITLE {
                    "title_too_long"
                } else {
                    "invalid_activity"
                });
            }
            if *current_page < 1
                || *total_pages < 1
                || current_page > total_pages
                || *total_pages > MAX_PAGE
            {
                return Err("invalid_progress");
            }
            (
                "reader",
                Some(work_name.clone()),
                Some(*current_page),
                Some(*total_pages),
                None,
                None,
            )
        }
        Activity::Video {
            work_name,
            current_time_seconds,
            duration_seconds,
        } => {
            if (work_name.is_empty() && e.context.privacy != "progress-only")
                || work_name.len() > MAX_TITLE
                || work_name.chars().any(char::is_control)
            {
                return Err(if work_name.len() > MAX_TITLE {
                    "title_too_long"
                } else {
                    "invalid_activity"
                });
            }
            if !current_time_seconds.is_finite()
                || *current_time_seconds < 0.0
                || duration_seconds.is_some_and(|d| {
                    !d.is_finite()
                        || d <= 0.0
                        || d > MAX_DURATION_MILLIS as f64 / 1000.0
                        || *current_time_seconds > d
                })
            {
                return Err("invalid_progress");
            }
            let current = (*current_time_seconds * 1000.0).round();
            if current > MAX_DURATION_MILLIS as f64 {
                return Err("invalid_progress");
            }
            (
                "video",
                Some(work_name.clone()),
                None,
                None,
                Some(current as i64),
                duration_seconds.map(|d| (d * 1000.0).round() as i64),
            )
        }
    };
    let title = if e.context.privacy == "progress-only" {
        None
    } else {
        title
    };
    let canonical = serde_json::json!({"schemaVersion":1,"id":e.id,"type":e.event_type,"sessionId":e.session_id,"sourceId":e.source_id,"activeGroupId":e.active_group_id,"policyVersionId":e.policy_version_id,"sequence":e.sequence,"occurredAt":occurred,"kind":kind,"privacy":e.context.privacy,"contentId":e.context.content_id,"language":e.context.language,"title":title,"currentPage":page,"totalPages":total,"currentTimeMillis":current,"durationMillis":duration});
    let payload_hash = hex::encode(Sha256::digest(
        serde_json_canonicalizer::to_vec(&canonical).map_err(|_| "invalid_event")?,
    ));
    Ok(Normalized {
        id: e.id,
        event_type: e.event_type,
        session_id: e.session_id,
        source_id: e.source_id,
        policy_version_id: e.policy_version_id,
        sequence: e.sequence,
        occurred_at: occurred,
        kind,
        privacy: e.context.privacy,
        content_id: e.context.content_id,
        language: e.context.language,
        title,
        current_page: page,
        total_pages: total,
        current_time_millis: current,
        duration_millis: duration,
        payload_hash,
    })
}

async fn policy_existed(
    tx: &mut Transaction<'_, Sqlite>,
    ancestry: &[String],
    wanted: &str,
    occurred: i64,
) -> Result<bool, AppError> {
    let occurred_seconds = occurred.div_euclid(1_000);
    for group in ancestry.iter().rev() {
        let rows = sqlx::query("SELECT id,parent_version_ids_json FROM policy_versions WHERE group_id=? AND created_at<=?")
            .bind(group).bind(occurred_seconds).fetch_all(&mut **tx).await.map_err(db)?;
        for row in rows {
            let id: String = row.get("id");
            let json: String = row.get("parent_version_ids_json");
            let parents: Vec<String> = serde_json::from_str(&json)
                .map_err(|_| AppError::Internal("invalid policy ancestry".into()))?;
            let mut ids = parents.clone();
            ids.push(id);
            if hex::encode(Sha256::digest(ids.join("\n").as_bytes())) != wanted {
                continue;
            }
            let mut previous_index = None;
            let mut referenced_groups = HashSet::new();
            let mut exact = true;
            for (position, version_id) in ids.iter().enumerate() {
                let version = sqlx::query("SELECT group_id,parent_version_ids_json,created_at FROM policy_versions WHERE id=?")
                    .bind(version_id).fetch_optional(&mut **tx).await.map_err(db)?;
                let Some(version) = version else {
                    exact = false;
                    break;
                };
                let version_group: String = version.get("group_id");
                let Some(index) = ancestry.iter().position(|value| value == &version_group) else {
                    exact = false;
                    break;
                };
                let captured: String = version.get("parent_version_ids_json");
                let captured: Vec<String> = serde_json::from_str(&captured)
                    .map_err(|_| AppError::Internal("invalid policy ancestry".into()))?;
                if captured != ids[..position]
                    || version.get::<i64, _>("created_at") > occurred_seconds
                    || previous_index.is_some_and(|previous| index <= previous)
                {
                    exact = false;
                    break;
                }
                previous_index = Some(index);
                referenced_groups.insert(version_group);
            }
            for ancestor in ancestry {
                let had_policy = sqlx::query_scalar::<_, i64>(
                    "SELECT 1 FROM policy_versions WHERE group_id=? AND created_at<=? LIMIT 1",
                )
                .bind(ancestor)
                .bind(occurred_seconds)
                .fetch_optional(&mut **tx)
                .await
                .map_err(db)?
                .is_some();
                if had_policy && !referenced_groups.contains(ancestor) {
                    exact = false;
                    break;
                }
            }
            if exact {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

enum InsertOutcome {
    Accepted,
    Duplicate,
    IdConflict,
    SequenceConflict,
}
async fn insert_event(
    tx: &mut Transaction<'_, Sqlite>,
    p: &Principal,
    ancestry: &[String],
    e: &Normalized,
    now: i64,
    retention_days: u16,
) -> Result<InsertOutcome, AppError> {
    if let Some(hash) = sqlx::query_scalar::<_, String>(
        "SELECT payload_hash FROM activity_events WHERE user_id=? AND event_id=?",
    )
    .bind(&p.user_id)
    .bind(&e.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    {
        return Ok(if hash == e.payload_hash {
            InsertOutcome::Duplicate
        } else {
            InsertOutcome::IdConflict
        });
    }
    if sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM activity_events WHERE user_id=? AND activity_session_id=? AND sequence=?",
    )
    .bind(&p.user_id)
    .bind(&e.session_id)
    .bind(e.sequence)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .is_some()
    {
        return Ok(InsertOutcome::SequenceConflict);
    }
    let retained_until = e
        .occurred_at
        .saturating_add(i64::from(retention_days) * 86_400_000);
    let result=sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,content_id,language,title,current_page,total_pages,current_time_millis,duration_millis,retention_days,retained_until) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&e.id).bind(&p.user_id).bind(p.active_group_id.as_deref()).bind(&e.policy_version_id).bind(&e.payload_hash).bind(&e.event_type).bind(e.kind).bind(&e.privacy).bind(&e.session_id).bind(&e.source_id).bind(e.sequence).bind(e.occurred_at).bind(now).bind(&e.content_id).bind(&e.language).bind(&e.title).bind(e.current_page).bind(e.total_pages).bind(e.current_time_millis).bind(e.duration_millis).bind(i64::from(retention_days)).bind(retained_until).execute(&mut **tx).await.map_err(db)?;
    let row_id = result.last_insert_rowid();
    for (ordinal, group) in ancestry.iter().enumerate() {
        sqlx::query(
            "INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,?,?)",
        )
        .bind(row_id)
        .bind(ordinal as i64)
        .bind(group)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    }
    sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
        .bind(row_id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    rebuild_daily_rollups_in_transaction(tx, row_id).await?;
    Ok(InsertOutcome::Accepted)
}
fn db(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("analytics database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    struct Fixture {
        pool: SqlitePool,
        principal: Principal,
        group: String,
        policy: String,
    }

    impl Fixture {
        async fn new() -> Self {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            Self::from_pool(pool).await
        }
        async fn from_pool(pool: SqlitePool) -> Self {
            sqlx::migrate!("./migrations").run(&pool).await.unwrap();
            let now = OffsetDateTime::now_utc().unix_timestamp();
            sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','Learner','active','learner',0,?,?)").bind(now).bind(now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('class',NULL,'Class','class','active',?)").bind(now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('membership','class','learner','active',?)").bind(now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at,active_group_id) VALUES('http-session','learner',?,?,?,'class')").bind(now+3600).bind(now).bind(now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('v1','class','{}','d','c','learner','test','[]',?)").bind(now-10).execute(&pool).await.unwrap();
            let policy = hex::encode(Sha256::digest(b"v1"));
            Self {
                pool,
                principal: Principal {
                    user_id: "learner".into(),
                    service_key_id: None,
                    session_id: "http-session".into(),
                    device_id: "device".into(),
                    active_group_id: Some("class".into()),
                    identity_type: IdentityType::Learner,
                    is_root: false,
                },
                group: "class".into(),
                policy,
            }
        }
        fn event(&self, id: &str, sequence: i64) -> ActivityEvent {
            ActivityEvent {
                schema_version: 1,
                id: id.into(),
                event_type: "activity.progressed".into(),
                session_id: "watch-session".into(),
                source_id: "reader".into(),
                active_group_id: self.group.clone(),
                policy_version_id: self.policy.clone(),
                sequence,
                occurred_at: OffsetDateTime::now_utc().format(&Rfc3339).unwrap(),
                activity: Activity::Reader {
                    work_name: "Book".into(),
                    current_page: 2,
                    total_pages: 10,
                },
                context: ActivityContext {
                    content_id: Some("opaque-book".into()),
                    language: Some("de".into()),
                    privacy: "title-and-progress".into(),
                },
            }
        }
        async fn ingest(&self, events: Vec<ActivityEvent>) -> Result<IngestionResult, AppError> {
            AnalyticsIngestionService::new(self.pool.clone())
                .ingest(
                    &self.principal,
                    IngestionBatch {
                        schema_version: 1,
                        events: events
                            .into_iter()
                            .map(|event| serde_json::to_value(event).unwrap())
                            .collect(),
                    },
                )
                .await
        }
    }

    #[tokio::test]
    async fn duplicate_reordered_and_conflicting_batches_are_stable() {
        let f = Fixture::new().await;
        let two = f.event("two", 2);
        let one = f.event("one", 1);
        let first = f.ingest(vec![two.clone(), one.clone()]).await.unwrap();
        assert_eq!(first.accepted_ids, vec!["two", "one"]);
        let retry = f.ingest(vec![one, two]).await.unwrap();
        assert_eq!(retry.duplicate_ids, vec!["one", "two"]);
        let conflict = f.ingest(vec![f.event("different-id", 1)]).await.unwrap();
        assert_eq!(conflict.rejected[0].code, "sequence_conflict");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM activity_events")
                .fetch_one(&f.pool)
                .await
                .unwrap(),
            2
        );
    }

    #[tokio::test]
    async fn concurrent_windows_converge_on_one_stored_event() {
        let f = Fixture::new().await;
        let raw = serde_json::to_value(f.event("shared", 1)).unwrap();
        let service = AnalyticsIngestionService::new(f.pool.clone());
        let first = service.ingest(
            &f.principal,
            IngestionBatch {
                schema_version: 1,
                events: vec![raw.clone()],
            },
        );
        let second = service.ingest(
            &f.principal,
            IngestionBatch {
                schema_version: 1,
                events: vec![raw],
            },
        );
        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();
        assert_eq!(first.accepted_ids.len() + second.accepted_ids.len(), 1);
        assert_eq!(first.duplicate_ids.len() + second.duplicate_ids.len(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM activity_events")
                .fetch_one(&f.pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn repeated_ids_are_one_rejection_and_commit_no_row_for_that_id() {
        let f = Fixture::new().await;
        let repeated = serde_json::to_value(f.event("repeated", 1)).unwrap();
        let valid = serde_json::to_value(f.event("valid", 2)).unwrap();
        let result = AnalyticsIngestionService::new(f.pool.clone())
            .ingest(
                &f.principal,
                IngestionBatch {
                    schema_version: 1,
                    events: vec![repeated.clone(), valid, repeated],
                },
            )
            .await
            .unwrap();
        assert_eq!(result.accepted_ids, vec!["valid"]);
        assert_eq!(
            result.rejected,
            vec![RejectedEvent {
                id: "repeated".into(),
                code: "duplicate_in_batch",
                retryable: false
            }]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM activity_events WHERE event_id='repeated'"
            )
            .fetch_one(&f.pool)
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn missing_event_id_is_an_uncorrelatable_whole_batch_error() {
        let f = Fixture::new().await;
        let valid = serde_json::to_value(f.event("valid", 1)).unwrap();
        let result = AnalyticsIngestionService::new(f.pool.clone())
            .ingest(
                &f.principal,
                IngestionBatch {
                    schema_version: 1,
                    events: vec![serde_json::json!({"type":"activity.started"}), valid],
                },
            )
            .await;
        assert!(matches!(result, Err(AppError::BadRequest(_))));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM activity_events")
                .fetch_one(&f.pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn subsecond_timestamp_changes_are_payload_conflicts() {
        let f = Fixture::new().await;
        let mut first = f.event("same", 1);
        let base = OffsetDateTime::now_utc();
        first.occurred_at = base.format(&Rfc3339).unwrap();
        let mut changed = first.clone();
        changed.occurred_at = (base + time::Duration::milliseconds(1))
            .format(&Rfc3339)
            .unwrap();
        assert_eq!(
            f.ingest(vec![first]).await.unwrap().accepted_ids,
            vec!["same"]
        );
        assert_eq!(
            f.ingest(vec![changed]).await.unwrap().rejected[0].code,
            "id_conflict"
        );
    }

    #[tokio::test]
    async fn partial_invalid_rows_do_not_abort_and_progress_only_drops_titles() {
        let f = Fixture::new().await;
        let mut invalid = f.event("bad", 2);
        invalid.activity = Activity::Reader {
            work_name: "Book".into(),
            current_page: 20,
            total_pages: 10,
        };
        let mut hidden = f.event("hidden", 1);
        hidden.context.privacy = "progress-only".into();
        let result = f.ingest(vec![invalid, hidden]).await.unwrap();
        assert_eq!(result.accepted_ids, vec!["hidden"]);
        assert_eq!(result.rejected[0].code, "invalid_progress");
        let title: Option<String> =
            sqlx::query_scalar("SELECT title FROM activity_events WHERE event_id='hidden'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        assert!(title.is_none());
        let stored: String =
            sqlx::query_scalar("SELECT content_id FROM activity_events WHERE event_id='hidden'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        assert_eq!(stored, "opaque-book");
    }

    #[tokio::test]
    async fn unknown_and_spoofed_fields_are_row_rejections_without_raw_storage() {
        let f = Fixture::new().await;
        let mut spoofed = serde_json::to_value(f.event("spoofed", 2)).unwrap();
        spoofed["userId"] = serde_json::json!("other-user");
        spoofed["activity"]["secretText"] = serde_json::json!("private subtitle");
        let valid = serde_json::to_value(f.event("valid", 1)).unwrap();
        let result = AnalyticsIngestionService::new(f.pool.clone())
            .ingest(
                &f.principal,
                IngestionBatch {
                    schema_version: 1,
                    events: vec![spoofed, valid],
                },
            )
            .await
            .unwrap();
        assert_eq!(result.accepted_ids, vec!["valid"]);
        assert_eq!(
            result.rejected,
            vec![RejectedEvent {
                id: "spoofed".into(),
                code: "invalid_event",
                retryable: false
            }]
        );
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('activity_events')")
                .fetch_all(&f.pool)
                .await
                .unwrap();
        assert!(!columns
            .iter()
            .any(|name| name.contains("json") || name.contains("raw") || name.contains("text")));
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT user_id FROM activity_events")
                .fetch_one(&f.pool)
                .await
                .unwrap(),
            "learner"
        );
    }

    #[tokio::test]
    async fn progress_only_title_never_reaches_database_or_wal_bytes() {
        let path =
            std::env::temp_dir().join(format!("analytics-private-{}.db", uuid::Uuid::now_v7()));
        let options = crate::db::sqlite_connect_options(path.to_str().unwrap()).unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let f = Fixture::from_pool(pool).await;
        let mut hidden = f.event("hidden", 1);
        hidden.context.privacy = "progress-only".into();
        hidden.activity = Activity::Reader {
            work_name: "Private Secret Title".into(),
            current_page: 1,
            total_pages: 2,
        };
        f.ingest(vec![hidden]).await.unwrap();
        sqlx::query("PRAGMA wal_checkpoint(PASSIVE)")
            .execute(&f.pool)
            .await
            .unwrap();
        f.pool.close().await;
        for candidate in [path.clone(), path.with_extension("db-wal")] {
            if let Ok(bytes) = std::fs::read(&candidate) {
                assert!(!bytes
                    .windows(b"Private Secret Title".len())
                    .any(|window| window == b"Private Secret Title"));
            }
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[tokio::test]
    async fn previously_issued_policy_remains_valid_after_current_policy_changes() {
        let f = Fixture::new().await;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('v2','class','{}','d2','c2','learner','new','[]',?)").bind(now-5).execute(&f.pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies(group_id,policy_version_id,activated_at) VALUES('class','v2',?)").bind(now-5).execute(&f.pool).await.unwrap();
        assert_eq!(
            f.ingest(vec![f.event("offline", 1)])
                .await
                .unwrap()
                .accepted_ids,
            vec!["offline"]
        );
    }

    #[tokio::test]
    async fn policy_chain_must_match_every_current_ancestor_in_order() {
        let mut f = Fixture::new().await;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('child','class','Child','child','active',?)").bind(now).execute(&f.pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('child-member','child','learner','active',?)").bind(now).execute(&f.pool).await.unwrap();
        sqlx::query("UPDATE sessions SET active_group_id='child' WHERE id='http-session'")
            .execute(&f.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('child-v','child','{}','dc','cc','learner','child','[\"v1\"]',?)").bind(now-1).execute(&f.pool).await.unwrap();
        f.group = "child".into();
        f.principal.active_group_id = Some("child".into());
        f.policy = hex::encode(Sha256::digest(b"v1\nchild-v"));
        assert_eq!(
            f.ingest(vec![f.event("valid-chain", 1)])
                .await
                .unwrap()
                .accepted_ids,
            vec!["valid-chain"]
        );

        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('bad-child','child','{}','db','cb','learner','bad','[]',?)").bind(now-1).execute(&f.pool).await.unwrap();
        f.policy = hex::encode(Sha256::digest(b"bad-child"));
        assert_eq!(
            f.ingest(vec![f.event("omitted-parent", 2)])
                .await
                .unwrap()
                .rejected[0]
                .code,
            "invalid_scope"
        );

        sqlx::query("UPDATE groups SET status='archived' WHERE id='class'")
            .execute(&f.pool)
            .await
            .unwrap();
        assert!(matches!(
            f.ingest(vec![f.event("archived-parent", 3)]).await,
            Err(AppError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn revoked_session_and_nonlearner_are_whole_request_failures() {
        let f = Fixture::new().await;
        sqlx::query("UPDATE sessions SET revoked_at=1")
            .execute(&f.pool)
            .await
            .unwrap();
        assert!(matches!(
            f.ingest(vec![f.event("one", 1)]).await,
            Err(AppError::Unauthorized)
        ));
        let mut teacher = f.principal.clone();
        teacher.identity_type = IdentityType::Teacher;
        assert!(matches!(
            AnalyticsIngestionService::new(f.pool)
                .ingest(
                    &teacher,
                    IngestionBatch {
                        schema_version: 1,
                        events: vec![]
                    }
                )
                .await,
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn event_and_ancestry_rows_reject_direct_updates() {
        let f = Fixture::new().await;
        f.ingest(vec![f.event("one", 1)]).await.unwrap();
        assert!(sqlx::query("UPDATE activity_events SET user_id='spoof'")
            .execute(&f.pool)
            .await
            .is_err());
        assert!(
            sqlx::query("UPDATE activity_event_ancestry SET group_id='spoof'")
                .execute(&f.pool)
                .await
                .is_err()
        );
        assert!(sqlx::query("DELETE FROM activity_event_ancestry")
            .execute(&f.pool)
            .await
            .is_err());
        assert!(sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) SELECT id,1,'class' FROM activity_events").execute(&f.pool).await.is_err());
        sqlx::query("DELETE FROM activity_events")
            .execute(&f.pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM activity_event_ancestry")
                .fetch_one(&f.pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn incomplete_building_ancestry_cannot_finalize() {
        let f = Fixture::new().await;
        f.ingest(vec![f.event("template", 1)]).await.unwrap();
        sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at) SELECT 'building',user_id,group_id,policy_version_id,'other',schema_version,event_type,activity_kind,privacy,'building-session',source_id,2,occurred_at,ingested_at FROM activity_events WHERE event_id='template'").execute(&f.pool).await.unwrap();
        assert!(sqlx::query(
            "UPDATE activity_events SET ancestry_state='finalized' WHERE event_id='building'"
        )
        .execute(&f.pool)
        .await
        .is_err());
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('reassignment-child','class','Child','reassignment-child','active',1)").execute(&f.pool).await.unwrap();
        let building: i64 =
            sqlx::query_scalar("SELECT id FROM activity_events WHERE event_id='building'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        let finalized: i64 =
            sqlx::query_scalar("SELECT id FROM activity_events WHERE event_id='template'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'reassignment-child')").bind(building).execute(&f.pool).await.unwrap();
        assert!(sqlx::query(
            "UPDATE activity_event_ancestry SET event_row_id=? WHERE event_row_id=?"
        )
        .bind(finalized)
        .bind(building)
        .execute(&f.pool)
        .await
        .is_err());
    }

    #[tokio::test]
    async fn reordered_and_sibling_building_ancestry_cannot_finalize() {
        let f = Fixture::new().await;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        for id in ["child", "sibling"] {
            sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES(?,'class',?,?,'active',?)").bind(id).bind(id).bind(id).bind(now).execute(&f.pool).await.unwrap();
        }
        f.ingest(vec![f.event("template", 1)]).await.unwrap();
        for (event_id, sequence) in [("reordered", 2), ("sibling-chain", 3)] {
            sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at) SELECT ?,user_id,'child',policy_version_id,?,schema_version,event_type,activity_kind,privacy,?,source_id,?,occurred_at,ingested_at FROM activity_events WHERE event_id='template'").bind(event_id).bind(format!("hash-{event_id}")).bind(format!("session-{event_id}")).bind(sequence).execute(&f.pool).await.unwrap();
        }
        let reordered: i64 =
            sqlx::query_scalar("SELECT id FROM activity_events WHERE event_id='reordered'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'child'),(?,1,'class')")
            .bind(reordered)
            .bind(reordered)
            .execute(&f.pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
                .bind(reordered)
                .execute(&f.pool)
                .await
                .is_err()
        );
        let sibling: i64 =
            sqlx::query_scalar("SELECT id FROM activity_events WHERE event_id='sibling-chain'")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'class'),(?,1,'sibling')")
            .bind(sibling)
            .bind(sibling)
            .execute(&f.pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
                .bind(sibling)
                .execute(&f.pool)
                .await
                .is_err()
        );
    }
}
