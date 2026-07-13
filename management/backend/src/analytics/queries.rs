use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Datelike, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqlitePool};
use std::collections::{HashMap, HashSet};

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
};

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub active_learners: i64,
    pub sessions: i64,
    pub watch_seconds: i64,
    pub completions: i64,
    pub reader_pages: i64,
    pub flashcard_events: i64,
    pub llm_requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_micros: i64,
    pub policy_blocks: i64,
    /// Sum of request latency only for terminal requests that recorded it.
    /// This is intentionally not an inferred duration.
    pub latency_ms: i64,
    /// Requests with a recorded terminal error code.
    pub llm_errors: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage: Option<Coverage>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalyticsMetric {
    ActiveLearners,
    Sessions,
    WatchSeconds,
    Completions,
    ReaderPages,
    FlashcardEvents,
    LlmRequests,
    InputTokens,
    OutputTokens,
    TotalTokens,
    CostMicros,
    PolicyBlocks,
    LatencyMs,
    LlmErrors,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalyticsGranularity {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ComparisonMode {
    None,
    PreviousPeriod,
    PreviousYear,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Coverage {
    Complete,
    Partial,
    Missing,
    RawExpired,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalAnalyticsQuery {
    pub from: i64,
    pub to: i64,
    pub granularity: AnalyticsGranularity,
    #[serde(default)]
    pub metrics: Vec<AnalyticsMetric>,
    pub comparison: ComparisonMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalBucket {
    pub start: i64,
    pub end: i64,
    pub coverage: Coverage,
    pub values: Option<AnalyticsSummary>,
}

pub type PeriodComparison = Vec<HistoricalBucket>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalSeries {
    pub timezone: String,
    pub granularity: AnalyticsGranularity,
    pub primary: Vec<HistoricalBucket>,
    pub comparison: Option<PeriodComparison>,
}
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmAnalytics {
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_micros: i64,
    pub latency_ms: i64,
    pub errors: i64,
    pub breakdown: Vec<LlmUsageBreakdown>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsageBreakdown {
    pub provider_id: String,
    pub model_id: String,
    pub group_id: String,
    pub requests: i64,
    pub cost_micros: i64,
    pub latency_ms: i64,
    pub errors: i64,
}
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PolicyBlockAnalytics {
    pub blocks: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeseriesPoint {
    pub day_start: i64,
    #[serde(flatten)]
    pub summary: AnalyticsSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerAnalytics {
    pub learner_id: String,
    pub display_name: String,
    pub last_activity_at: i64,
    #[serde(flatten)]
    pub summary: AnalyticsSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionAnalytics {
    pub key: String,
    pub title: Option<String>,
    pub last_activity_at: i64,
    #[serde(flatten)]
    pub summary: AnalyticsSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

/// A retention-aware, factual event record for analytics drill-downs.
///
/// This deliberately excludes conversation messages, prompts, tool payloads, and
/// provider request metadata beyond the fact that a request or policy block occurred.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: String,
    pub occurred_at: i64,
    pub learner_id: Option<String>,
    pub activity_kind: String,
    pub event_type: String,
    pub content_title: Option<String>,
    pub reader_page: Option<i64>,
    pub video_time_millis: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEventPage {
    pub from: i64,
    pub to: i64,
    pub coverage: Coverage,
    pub total: i64,
    pub items: Vec<HistoryEvent>,
    pub next_cursor: Option<String>,
}

/// Retention-aware daily activity for one selected user. These are activity and
/// gateway facts only; they deliberately contain no learner assessment or inference.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserDailyActivity {
    pub start: i64,
    pub end: i64,
    pub coverage: Coverage,
    pub values: Option<UserDailyActivityValues>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserDailyActivityValues {
    pub sessions: i64,
    pub reader_pages: i64,
    pub video_seconds: i64,
    pub flashcard_sessions: i64,
    pub llm_requests: i64,
    pub cost_micros: i64,
    pub policy_blocks: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserDailyHistory {
    pub timezone: String,
    pub daily: Vec<UserDailyActivity>,
    pub devices: Vec<UserDeviceHistory>,
    pub membership_changes: Vec<UserMembershipHistory>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserDeviceHistory {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub first_recorded_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserMembershipHistory {
    pub membership_id: String,
    pub group_id: String,
    pub group_name: String,
    pub action: String,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageDay {
    pub start: i64,
    pub end: i64,
    pub coverage: Coverage,
    pub values: Option<Vec<ProviderModelUsage>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelUsage {
    pub model_id: String,
    pub model_key: String,
    pub group_id: String,
    pub requests: i64,
    pub cost_micros: i64,
    pub latency_ms: i64,
    pub errors: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthCheckHistory {
    pub id: String,
    pub actor_user_id: String,
    pub configuration_valid: bool,
    pub network_check_performed: bool,
    pub outcome: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHistory {
    pub timezone: String,
    pub usage: Vec<ProviderUsageDay>,
    pub health_checks: Vec<ProviderHealthCheckHistory>,
}

#[derive(Clone)]
pub struct AnalyticsQueryService {
    pool: SqlitePool,
}
impl AnalyticsQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn timezone(&self, principal: &Principal, group: &str) -> Result<String, AppError> {
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::GroupView)
            .await?;
        let timezone = school_timezone(&mut tx, group).await?.name().to_string();
        tx.commit().await.map_err(db)?;
        Ok(timezone)
    }
    pub async fn run_retention(
        &self,
        principal: &Principal,
        group: &str,
        limit: i64,
    ) -> Result<i64, AppError> {
        if !principal.is_root || principal.service_key_id.is_some() {
            return Err(AppError::Forbidden(
                "root administrator required for analytics retention".into(),
            ));
        }
        if !(1..=1_000).contains(&limit) {
            return Err(AppError::BadRequest(
                "retention limit must be between 1 and 1000".into(),
            ));
        }
        let mut c = self.pool.acquire().await.map_err(db)?;
        let mut tx = c.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let root: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM groups WHERE id=? AND parent_id IS NULL)",
        )
        .bind(group)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if root != 1 {
            return Err(AppError::Forbidden(
                "retention maintenance requires the school root".into(),
            ));
        }
        sqlx::query("INSERT OR IGNORE INTO analytics_retention_delete_queue(event_row_id) SELECT e.id FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.retained_until<=? ORDER BY e.retained_until,e.id LIMIT ?").bind(group).bind(time::OffsetDateTime::now_utc().unix_timestamp()*1000).bind(limit).execute(&mut *tx).await.map_err(db)?;
        let watermarks = sqlx::query("SELECT a.group_id,MAX(e.occurred_at) latest_deleted_at FROM activity_events e JOIN analytics_retention_delete_queue q ON q.event_row_id=e.id JOIN activity_event_ancestry a ON a.event_row_id=e.id GROUP BY a.group_id")
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        for watermark in watermarks {
            let group_id: String = watermark.get("group_id");
            let retained_from: i64 = watermark
                .get::<i64, _>("latest_deleted_at")
                .saturating_add(1);
            sqlx::query("INSERT INTO analytics_raw_retention_watermarks(group_id,retained_from,updated_at) VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET retained_from=MAX(analytics_raw_retention_watermarks.retained_from,excluded.retained_from),updated_at=excluded.updated_at")
                .bind(group_id)
                .bind(retained_from)
                .bind(now)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM analytics_retention_delete_queue")
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        sqlx::query("DELETE FROM activity_events WHERE id IN (SELECT event_row_id FROM analytics_retention_delete_queue)").execute(&mut *tx).await.map_err(db)?;
        sqlx::query("DELETE FROM analytics_retention_delete_queue")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        sqlx::query("INSERT INTO analytics_retention_runs(id,root_group_id,deleted_events,cutoff_at,actor_user_id,created_at) VALUES(?,?,?,?,?,?)").bind(uuid::Uuid::now_v7().to_string()).bind(group).bind(count).bind(time::OffsetDateTime::now_utc().unix_timestamp()*1000).bind(&principal.user_id).bind(time::OffsetDateTime::now_utc().unix_timestamp()).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(count)
    }

    async fn authorized_events(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<Event>, AppError> {
        if from < 0 || to <= from || to - from > 366 * 86_400_000 {
            return Err(AppError::BadRequest(
                "analytics date range must be positive and at most 366 days".into(),
            ));
        }
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let rows = sqlx::query("SELECT e.id,e.user_id,e.activity_session_id,e.event_type,e.activity_kind,e.occurred_at,e.content_id,e.language,e.title,e.privacy,e.current_page,e.current_time_millis FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? AND e.retained_until>? ORDER BY e.user_id,e.activity_session_id,e.sequence,e.id")
            .bind(group).bind(from).bind(to).bind(time::OffsetDateTime::now_utc().unix_timestamp()*1000).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(rows
            .into_iter()
            .map(|r| Event {
                user: r.get("user_id"),
                session: r.get("activity_session_id"),
                event_type: r.get("event_type"),
                kind: r.get("activity_kind"),
                at: r.get("occurred_at"),
                content: r.get("content_id"),
                language: r.get("language"),
                title: r.get("title"),
                privacy: r.get("privacy"),
                page: r.get("current_page"),
                media: r.get("current_time_millis"),
            })
            .collect())
    }

    pub async fn summary(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<AnalyticsSummary, AppError> {
        // Aggregate cards and CSV must use the same durable daily material used by
        // the historical charts. Raw events are only used for a selected partial
        // school day, where a rollup cannot represent the requested boundary.
        let history = self
            .history(
                principal,
                group,
                HistoricalAnalyticsQuery {
                    from,
                    to,
                    granularity: AnalyticsGranularity::Daily,
                    metrics: Vec::new(),
                    comparison: ComparisonMode::None,
                },
            )
            .await?;
        let mut summary = history
            .primary
            .iter()
            .filter_map(|bucket| bucket.values.as_ref())
            .fold(AnalyticsSummary::default(), |mut aggregate, values| {
                add_summary(&mut aggregate, values);
                aggregate
            });
        summary.coverage = Some(summary_coverage(&history.primary));
        Ok(summary)
    }

    pub async fn history(
        &self,
        principal: &Principal,
        group: &str,
        query: HistoricalAnalyticsQuery,
    ) -> Result<HistoricalSeries, AppError> {
        validate_history_range(query.from, query.to)?;

        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;

        let timezone = school_timezone(&mut tx, group).await?;
        let primary_boundaries =
            history_bucket_boundaries(timezone, query.from, query.to, query.granularity)?;
        let primary = self
            .history_buckets(&mut tx, group, &primary_boundaries, query.from, query.to)
            .await?;
        let comparison = match query.comparison {
            ComparisonMode::None => None,
            ComparisonMode::PreviousPeriod => {
                let boundaries =
                    previous_period_boundaries(timezone, &primary_boundaries, query.granularity)?;
                Some(
                    self.history_buckets(&mut tx, group, &boundaries, i64::MIN, i64::MAX)
                        .await?,
                )
            }
            ComparisonMode::PreviousYear => {
                let boundaries = previous_year_boundaries(timezone, &primary_boundaries)?;
                Some(
                    self.history_buckets(&mut tx, group, &boundaries, i64::MIN, i64::MAX)
                        .await?,
                )
            }
        };
        tx.commit().await.map_err(db)?;

        Ok(HistoricalSeries {
            timezone: timezone.name().to_string(),
            granularity: query.granularity,
            primary,
            comparison,
        })
    }

    pub async fn history_events(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<HistoryEventPage, AppError> {
        validate_history_range(from, to)?;
        if !(1..=200).contains(&limit) {
            return Err(AppError::BadRequest(
                "analytics limit must be between 1 and 200".into(),
            ));
        }
        let cursor = decode_cursor(cursor)?;
        let now_millis = time::OffsetDateTime::now_utc().unix_timestamp() * 1_000;
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;

        let coverage = raw_history_coverage(&mut tx, group, from, now_millis).await?;
        let total: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT (SELECT COUNT(*) FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? AND e.retained_until>?) + (SELECT COUNT(*) FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE request.created_at*1000>=? AND request.created_at*1000<?) + (SELECT COUNT(*) FROM llm_policy_block_events event JOIN descendants d ON d.id=event.owner_group_id WHERE event.created_at*1000>=? AND event.created_at*1000<?)")
            .bind(group)
            .bind(group)
            .bind(from)
            .bind(to)
            .bind(now_millis)
            .bind(from)
            .bind(to)
            .bind(from)
            .bind(to)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        let (cursor_at, cursor_id) = cursor.unwrap_or((i64::MAX, "~".into()));
        let rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id), events AS (SELECT 'activity:' || e.id id,e.occurred_at,e.user_id learner_id,e.activity_kind,e.event_type,CASE WHEN e.privacy='title-and-progress' THEN e.title ELSE NULL END content_title,e.current_page reader_page,e.current_time_millis video_time_millis FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? AND e.retained_until>? UNION ALL SELECT 'llm:' || request.id,request.created_at*1000,conversation.learner_user_id,'llm','llm.request',NULL,NULL,NULL FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE request.created_at*1000>=? AND request.created_at*1000<? UNION ALL SELECT 'policy-block:' || event.id,event.created_at*1000,event.learner_user_id,'llm','llm.policyBlocked',NULL,NULL,NULL FROM llm_policy_block_events event JOIN descendants d ON d.id=event.owner_group_id WHERE event.created_at*1000>=? AND event.created_at*1000<?) SELECT id,occurred_at,learner_id,activity_kind,event_type,content_title,reader_page,video_time_millis FROM events WHERE occurred_at<? OR (occurred_at=? AND id<?) ORDER BY occurred_at DESC,id DESC LIMIT ?")
            .bind(group)
            .bind(group)
            .bind(from)
            .bind(to)
            .bind(now_millis)
            .bind(from)
            .bind(to)
            .bind(from)
            .bind(to)
            .bind(cursor_at)
            .bind(cursor_at)
            .bind(cursor_id)
            .bind(limit + 1)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;

        let has_more = rows.len() > limit as usize;
        let items: Vec<HistoryEvent> = rows
            .into_iter()
            .take(limit as usize)
            .map(|row| HistoryEvent {
                id: row.get("id"),
                occurred_at: row.get("occurred_at"),
                learner_id: row.get("learner_id"),
                activity_kind: row.get("activity_kind"),
                event_type: row.get("event_type"),
                content_title: row.get("content_title"),
                reader_page: row.get("reader_page"),
                video_time_millis: row.get("video_time_millis"),
            })
            .collect();
        let next_cursor = has_more
            .then(|| {
                items
                    .last()
                    .map(|event| encode_cursor(event.occurred_at, &event.id))
            })
            .flatten();
        Ok(HistoryEventPage {
            from,
            to,
            coverage,
            total,
            items,
            next_cursor,
        })
    }

    pub async fn user_history(
        &self,
        principal: &Principal,
        group: &str,
        user_id: &str,
        from: i64,
        to: i64,
    ) -> Result<UserDailyHistory, AppError> {
        validate_history_range(from, to)?;
        let now_millis = time::OffsetDateTime::now_utc().unix_timestamp() * 1_000;
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let in_scope: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT EXISTS(SELECT 1 FROM group_memberships membership JOIN descendants d ON d.id=membership.group_id WHERE membership.user_id=? AND membership.status='active')")
            .bind(group)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if in_scope == 0 {
            return Err(AppError::NotFound(
                "user not found in selected group".into(),
            ));
        }
        let timezone = school_timezone(&mut tx, group).await?;
        let rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT e.user_id,e.activity_session_id,e.event_type,e.activity_kind,e.occurred_at,e.content_id,e.language,e.title,e.privacy,e.current_page,e.current_time_millis,e.retained_until FROM activity_events e JOIN descendants d ON d.id=e.group_id WHERE e.user_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? ORDER BY e.activity_session_id,e.sequence,e.id")
            .bind(group)
            .bind(user_id)
            .bind(from)
            .bind(to)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        let mut activity: HashMap<i64, Vec<Event>> = HashMap::new();
        let mut flashcards: HashMap<i64, HashSet<String>> = HashMap::new();
        let mut expired_activity_days = HashSet::new();
        for row in rows {
            let at: i64 = row.get("occurred_at");
            let day = day_start_for_timestamp(timezone, at)?;
            if row.get::<i64, _>("retained_until") <= now_millis {
                expired_activity_days.insert(day);
                continue;
            }
            if row.get::<String, _>("activity_kind") == "flashcards" {
                flashcards
                    .entry(day)
                    .or_default()
                    .insert(row.get("activity_session_id"));
            }
            activity.entry(day).or_default().push(Event {
                user: row.get("user_id"),
                session: row.get("activity_session_id"),
                event_type: row.get("event_type"),
                kind: row.get("activity_kind"),
                at,
                content: row.get("content_id"),
                language: row.get("language"),
                title: row.get("title"),
                privacy: row.get("privacy"),
                page: row.get("current_page"),
                media: row.get("current_time_millis"),
            });
        }
        let mut days: HashMap<i64, UserDailyActivityValues> = activity
            .into_iter()
            .map(|(day_start, events)| {
                let summary = summarize(&events);
                (
                    day_start,
                    UserDailyActivityValues {
                        sessions: summary.sessions,
                        reader_pages: summary.reader_pages,
                        video_seconds: summary.watch_seconds,
                        flashcard_sessions: flashcards
                            .get(&day_start)
                            .map_or(0, |sessions| sessions.len() as i64),
                        llm_requests: 0,
                        cost_micros: 0,
                        policy_blocks: 0,
                    },
                )
            })
            .collect();
        let usage = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT request.created_at,COUNT(*) requests,COALESCE(SUM(COALESCE(request.cost_micros,0)),0) cost_micros FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE conversation.learner_user_id=? AND request.created_at*1000>=? AND request.created_at*1000<? GROUP BY request.created_at")
            .bind(group)
            .bind(user_id)
            .bind(from)
            .bind(to)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        for row in usage {
            let day = day_start_for_timestamp(timezone, row.get::<i64, _>("created_at") * 1_000)?;
            let entry = days.entry(day).or_insert_with(empty_user_values);
            entry.llm_requests += row.get::<i64, _>("requests");
            entry.cost_micros += row.get::<i64, _>("cost_micros");
        }
        let blocks = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT event.created_at,COUNT(*) blocks FROM llm_policy_block_events event JOIN descendants d ON d.id=event.owner_group_id WHERE event.learner_user_id=? AND event.created_at*1000>=? AND event.created_at*1000<? GROUP BY event.created_at")
            .bind(group)
            .bind(user_id)
            .bind(from)
            .bind(to)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        for row in blocks {
            let day = day_start_for_timestamp(timezone, row.get::<i64, _>("created_at") * 1_000)?;
            days.entry(day)
                .or_insert_with(empty_user_values)
                .policy_blocks += row.get::<i64, _>("blocks");
        }
        let boundaries =
            history_bucket_boundaries(timezone, from, to, AnalyticsGranularity::Daily)?;
        let mut daily = Vec::with_capacity(boundaries.len());
        for (start, end) in boundaries {
            let partial = start < from || end > to;
            let raw_expired = expired_activity_days.contains(&start)
                || raw_history_coverage_descendants(&mut tx, group, start.max(from), now_millis)
                    .await?
                    == Coverage::RawExpired;
            let values = days.remove(&start);
            let coverage = if raw_expired {
                Coverage::RawExpired
            } else if partial {
                Coverage::Partial
            } else if values.is_some() {
                Coverage::Complete
            } else {
                Coverage::Missing
            };
            daily.push(UserDailyActivity {
                start,
                end,
                coverage,
                values: (!raw_expired).then_some(values).flatten(),
            });
        }
        let devices = sqlx::query("SELECT id,name,platform,created_at,last_seen_at FROM devices WHERE user_id=? AND (created_at*1000<? OR last_seen_at*1000>=?) ORDER BY created_at DESC,id DESC")
            .bind(user_id).bind(to).bind(from).fetch_all(&mut *tx).await.map_err(db)?
            .into_iter().map(|row| UserDeviceHistory { id: row.get("id"), name: row.get("name"), platform: row.get("platform"), first_recorded_at: row.get("created_at"), last_seen_at: row.get("last_seen_at") }).collect();
        let membership_changes = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT event.target_id membership_id,membership.group_id,groups.name group_name,event.action,event.created_at FROM audit_events event JOIN group_memberships membership ON membership.id=event.target_id JOIN groups ON groups.id=membership.group_id JOIN descendants d ON d.id=membership.group_id WHERE event.target_type='group_membership' AND membership.user_id=? AND event.created_at>=? AND event.created_at<? ORDER BY event.created_at DESC,event.id DESC")
            .bind(group).bind(user_id).bind(from.div_euclid(1000)).bind(to.div_euclid(1000)).fetch_all(&mut *tx).await.map_err(db)?
            .into_iter().map(|row| UserMembershipHistory { membership_id: row.get("membership_id"), group_id: row.get("group_id"), group_name: row.get("group_name"), action: row.get("action"), occurred_at: row.get("created_at") }).collect();
        tx.commit().await.map_err(db)?;
        Ok(UserDailyHistory {
            timezone: timezone.name().to_string(),
            daily,
            devices,
            membership_changes,
        })
    }

    pub async fn provider_history(
        &self,
        principal: &Principal,
        group: &str,
        provider_id: &str,
        from: i64,
        to: i64,
    ) -> Result<ProviderHistory, AppError> {
        validate_history_range(from, to)?;
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let provider_in_scope: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT EXISTS(SELECT 1 FROM llm_providers provider JOIN descendants d ON d.id=provider.group_id WHERE provider.id=?)")
            .bind(group)
            .bind(provider_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if provider_in_scope == 0 {
            return Err(AppError::NotFound(
                "provider not found in selected group".into(),
            ));
        }
        let timezone = school_timezone(&mut tx, group).await?;
        let usage_rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT request.created_at,request.model_id,COALESCE(model.model_key,request.model_id) model_key,conversation.owner_group_id group_id,COUNT(*) requests,COALESCE(SUM(COALESCE(request.cost_micros,0)),0) cost_micros,COALESCE(SUM(request.latency_ms),0) latency_ms,COALESCE(SUM(CASE WHEN request.error_code IS NOT NULL THEN 1 ELSE 0 END),0) errors FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id LEFT JOIN llm_models model ON model.id=request.model_id WHERE request.provider_id=? AND request.created_at*1000>=? AND request.created_at*1000<? GROUP BY request.created_at,request.model_id,model.model_key,conversation.owner_group_id ORDER BY request.created_at,request.model_id,conversation.owner_group_id")
            .bind(group)
            .bind(provider_id)
            .bind(from)
            .bind(to)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        let mut usage_by_day: HashMap<i64, Vec<ProviderModelUsage>> = HashMap::new();
        for row in usage_rows {
            let day_start =
                day_start_for_timestamp(timezone, row.get::<i64, _>("created_at") * 1_000)?;
            let model_id: String = row.get("model_id");
            let model_key: String = row.get("model_key");
            let usage = usage_by_day.entry(day_start).or_default();
            let group_id: String = row.get("group_id");
            if let Some(model) = usage
                .iter_mut()
                .find(|model| model.model_id == model_id && model.group_id == group_id)
            {
                model.requests += row.get::<i64, _>("requests");
                model.cost_micros += row.get::<i64, _>("cost_micros");
                model.latency_ms += row.get::<i64, _>("latency_ms");
                model.errors += row.get::<i64, _>("errors");
            } else {
                usage.push(ProviderModelUsage {
                    model_id,
                    model_key,
                    group_id,
                    requests: row.get("requests"),
                    cost_micros: row.get("cost_micros"),
                    latency_ms: row.get("latency_ms"),
                    errors: row.get("errors"),
                });
            }
        }
        let usage = provider_usage_buckets(timezone, from, to, &usage_by_day)?;
        let health_checks = sqlx::query("SELECT id,actor_user_id,configuration_valid,network_check_performed,outcome,created_at FROM provider_health_checks WHERE provider_id=? AND created_at*1000>=? AND created_at*1000<? ORDER BY created_at DESC,id DESC")
            .bind(provider_id)
            .bind(from)
            .bind(to)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?
            .into_iter()
            .map(|row| ProviderHealthCheckHistory {
                id: row.get("id"),
                actor_user_id: row.get("actor_user_id"),
                configuration_valid: row.get::<i64, _>("configuration_valid") != 0,
                network_check_performed: row.get::<i64, _>("network_check_performed") != 0,
                outcome: row.get("outcome"),
                created_at: row.get("created_at"),
            })
            .collect();
        tx.commit().await.map_err(db)?;
        Ok(ProviderHistory {
            timezone: timezone.name().to_string(),
            usage,
            health_checks,
        })
    }

    async fn history_buckets(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        group: &str,
        boundaries: &[(i64, i64)],
        requested_from: i64,
        requested_to: i64,
    ) -> Result<Vec<HistoricalBucket>, AppError> {
        let mut buckets = Vec::with_capacity(boundaries.len());
        for &(start, end) in boundaries {
            let partial = start < requested_from || end > requested_to;
            let from = start.max(requested_from);
            let to = end.min(requested_to);
            let values = aggregate_history_bucket(tx, group, from, to, partial).await?;
            let has_recorded_data = values.0 > 0;
            let coverage = if values.2 {
                Coverage::RawExpired
            } else if partial {
                Coverage::Partial
            } else if !has_recorded_data {
                Coverage::Missing
            } else {
                Coverage::Complete
            };
            buckets.push(HistoricalBucket {
                start,
                end,
                coverage,
                values: (!values.2 && has_recorded_data).then_some(values.1),
            });
        }
        Ok(buckets)
    }
    pub async fn llm_summary(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<LlmAnalytics, AppError> {
        if from < 0 || to <= from || to - from > 366 * 86_400_000 {
            return Err(AppError::BadRequest(
                "analytics date range must be positive and at most 366 days".into(),
            ));
        }
        let mut s = AnalyticsSummary::default();
        self.add_llm(principal, group, from, to, &mut s).await?;
        Ok(LlmAnalytics {
            requests: s.llm_requests,
            input_tokens: s.input_tokens,
            output_tokens: s.output_tokens,
            total_tokens: s.total_tokens,
            cost_micros: s.cost_micros,
            latency_ms: s.latency_ms,
            errors: s.llm_errors,
            breakdown: self.llm_breakdown(principal, group, from, to).await?,
        })
    }
    pub async fn policy_blocks(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<PolicyBlockAnalytics, AppError> {
        if from < 0 || to <= from || to - from > 366 * 86_400_000 {
            return Err(AppError::BadRequest(
                "analytics date range must be positive and at most 366 days".into(),
            ));
        }
        let mut s = AnalyticsSummary::default();
        self.add_llm(principal, group, from, to, &mut s).await?;
        Ok(PolicyBlockAnalytics {
            blocks: s.policy_blocks,
        })
    }
    pub async fn timeseries(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<TimeseriesPoint>, AppError> {
        let history = self
            .history(
                principal,
                group,
                HistoricalAnalyticsQuery {
                    from,
                    to,
                    granularity: AnalyticsGranularity::Daily,
                    metrics: Vec::new(),
                    comparison: ComparisonMode::None,
                },
            )
            .await?;
        Ok(history
            .primary
            .into_iter()
            .filter_map(|bucket| {
                bucket.values.map(|summary| TimeseriesPoint {
                    day_start: bucket.start,
                    summary,
                })
            })
            .collect())
    }
    pub async fn learners(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<Page<LearnerAnalytics>, AppError> {
        let events = self.authorized_events(principal, group, from, to).await?;
        let mut by: HashMap<String, Vec<Event>> = HashMap::new();
        for e in events {
            by.entry(e.user.clone()).or_default().push(e)
        }
        let mut items = Vec::new();
        for (user, ev) in by {
            let name: Option<String> =
                sqlx::query_scalar("SELECT display_name FROM users WHERE id=?")
                    .bind(&user)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(db)?;
            let mut summary = summarize(&ev);
            self.add_llm_for(principal, group, from, to, Some(&user), &mut summary)
                .await?;
            items.push(LearnerAnalytics {
                learner_id: user,
                display_name: name.unwrap_or_else(|| "Learner".into()),
                last_activity_at: ev.iter().map(|event| event.at).max().unwrap_or(0),
                summary,
            });
        }
        items.sort_by(|a, b| {
            b.last_activity_at
                .cmp(&a.last_activity_at)
                .then(a.learner_id.cmp(&b.learner_id))
        });
        let cursor = decode_cursor(cursor)?;
        if let Some((at, id)) = cursor {
            items.retain(|item| {
                item.last_activity_at < at || (item.last_activity_at == at && item.learner_id > id)
            });
        }
        let has_more = items.len() > limit as usize;
        items.truncate(limit as usize);
        let next_cursor = has_more
            .then(|| {
                items
                    .last()
                    .map(|item| encode_cursor(item.last_activity_at, &item.learner_id))
            })
            .flatten();
        Ok(Page { items, next_cursor })
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn dimensions(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
        language: bool,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<Page<DimensionAnalytics>, AppError> {
        let events = self.authorized_events(principal, group, from, to).await?;
        let mut by: HashMap<String, Vec<Event>> = HashMap::new();
        for e in events {
            let key = if language {
                e.language.clone()
            } else {
                e.content.clone()
            };
            if let Some(key) = key {
                by.entry(key).or_default().push(e)
            }
        }
        let mut items: Vec<_> = by
            .into_iter()
            .map(|(key, ev)| {
                let title = if language {
                    None
                } else {
                    ev.iter()
                        .find(|e| e.privacy == "title-and-progress")
                        .and_then(|e| e.title.clone())
                };
                DimensionAnalytics {
                    key,
                    title,
                    last_activity_at: ev.iter().map(|event| event.at).max().unwrap_or(0),
                    summary: summarize(&ev),
                }
            })
            .collect();
        items.sort_by(|a, b| {
            b.last_activity_at
                .cmp(&a.last_activity_at)
                .then(a.key.cmp(&b.key))
        });
        let cursor = decode_cursor(cursor)?;
        if let Some((at, id)) = cursor {
            items.retain(|item| {
                item.last_activity_at < at || (item.last_activity_at == at && item.key > id)
            });
        }
        let has_more = items.len() > limit as usize;
        items.truncate(limit as usize);
        let next_cursor = has_more
            .then(|| {
                items
                    .last()
                    .map(|item| encode_cursor(item.last_activity_at, &item.key))
            })
            .flatten();
        Ok(Page { items, next_cursor })
    }
    async fn add_llm(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
        s: &mut AnalyticsSummary,
    ) -> Result<(), AppError> {
        self.add_llm_for(principal, group, from, to, None, s).await
    }
    async fn add_llm_for(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
        learner: Option<&str>,
        s: &mut AnalyticsSummary,
    ) -> Result<(), AppError> {
        let mut c = self.pool.acquire().await.map_err(db)?;
        let mut tx = c.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let rows=sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT metric,COALESCE(SUM(value),0) value FROM usage_ledger JOIN descendants d ON d.id=direct_group_id WHERE created_at>=? AND created_at<? AND scope_kind='group' AND scope_id=direct_group_id AND (? IS NULL OR learner_user_id=?) GROUP BY metric").bind(group).bind(from.div_euclid(1000)).bind(to.div_euclid(1000)).bind(learner).bind(learner).fetch_all(&mut *tx).await.map_err(db)?;
        for r in rows {
            let v: i64 = r.get("value");
            match r.get::<String, _>("metric").as_str() {
                "requests" => s.llm_requests = v,
                "inputTokens" => s.input_tokens = v,
                "outputTokens" => s.output_tokens = v,
                "totalTokens" => s.total_tokens = v,
                "costMicros" => s.cost_micros = v,
                _ => {}
            }
        }
        s.policy_blocks=sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT COUNT(*) FROM llm_policy_block_events e JOIN descendants d ON d.id=e.owner_group_id WHERE e.created_at>=? AND e.created_at<? AND (? IS NULL OR e.learner_user_id=?)")
            .bind(group).bind(from.div_euclid(1000)).bind(to.div_euclid(1000)).bind(learner).bind(learner).fetch_one(&mut *tx).await.map_err(db)?;
        let recorded = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT COALESCE(SUM(request.latency_ms),0) latency_ms,COALESCE(SUM(CASE WHEN request.error_code IS NOT NULL THEN 1 ELSE 0 END),0) errors FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE request.created_at>=? AND request.created_at<? AND (? IS NULL OR conversation.learner_user_id=?)")
            .bind(group).bind(from.div_euclid(1000)).bind(to.div_euclid(1000)).bind(learner).bind(learner).fetch_one(&mut *tx).await.map_err(db)?;
        s.latency_ms = recorded.get("latency_ms");
        s.llm_errors = recorded.get("errors");
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    async fn llm_breakdown(
        &self,
        principal: &Principal,
        group: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<LlmUsageBreakdown>, AppError> {
        let mut connection = self.pool.acquire().await.map_err(db)?;
        let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        ensure_live_principal(&mut tx, principal).await?;
        AuthorizationService::new(self.pool.clone())
            .require_in_transaction(&mut tx, principal, group, Capability::AnalyticsView)
            .await?;
        let rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT request.provider_id,request.model_id,conversation.owner_group_id group_id,COUNT(*) requests,COALESCE(SUM(COALESCE(request.cost_micros,0)),0) cost_micros,COALESCE(SUM(request.latency_ms),0) latency_ms,COALESCE(SUM(CASE WHEN request.error_code IS NOT NULL THEN 1 ELSE 0 END),0) errors FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE request.created_at*1000>=? AND request.created_at*1000<? GROUP BY request.provider_id,request.model_id,conversation.owner_group_id ORDER BY request.provider_id,request.model_id,conversation.owner_group_id")
            .bind(group).bind(from).bind(to).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(rows
            .into_iter()
            .map(|row| LlmUsageBreakdown {
                provider_id: row.get("provider_id"),
                model_id: row.get("model_id"),
                group_id: row.get("group_id"),
                requests: row.get("requests"),
                cost_micros: row.get("cost_micros"),
                latency_ms: row.get("latency_ms"),
                errors: row.get("errors"),
            })
            .collect())
    }
}

fn validate_history_range(from: i64, to: i64) -> Result<(), AppError> {
    let duration = to.checked_sub(from).ok_or_else(|| {
        AppError::BadRequest("analytics date range must be positive and at most 366 days".into())
    })?;
    if from < 0 || duration <= 0 || duration > 366 * 86_400_000 {
        return Err(AppError::BadRequest(
            "analytics date range must be positive and at most 366 days".into(),
        ));
    }
    Ok(())
}

async fn school_timezone(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
) -> Result<chrono_tz::Tz, AppError> {
    let timezone: Option<String> = sqlx::query_scalar("WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM groups WHERE id=? UNION ALL SELECT g.id,g.parent_id FROM groups g JOIN ancestors a ON a.parent_id=g.id) SELECT c.timezone FROM ancestors a JOIN school_quota_calendars c ON c.root_group_id=a.id WHERE a.parent_id IS NULL")
        .bind(group)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?;
    timezone
        .as_deref()
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| AppError::Internal("invalid school timezone".into()))
}

fn history_bucket_boundaries(
    timezone: chrono_tz::Tz,
    from: i64,
    to: i64,
    granularity: AnalyticsGranularity,
) -> Result<Vec<(i64, i64)>, AppError> {
    validate_history_range(from, to)?;
    let first = Utc
        .timestamp_millis_opt(from)
        .single()
        .ok_or_else(|| AppError::BadRequest("invalid analytics range start".into()))?
        .with_timezone(&timezone)
        .date_naive();
    let mut date = bucket_date(first, granularity)?;
    let mut boundaries = Vec::new();
    loop {
        let start = local_day_start(timezone, date)?;
        if start >= to {
            break;
        }
        let next = next_bucket_date(date, granularity)?;
        let end = local_day_start(timezone, next)?;
        boundaries.push((start, end));
        date = next;
    }
    Ok(boundaries)
}

fn bucket_date(date: NaiveDate, granularity: AnalyticsGranularity) -> Result<NaiveDate, AppError> {
    match granularity {
        AnalyticsGranularity::Daily => Ok(date),
        AnalyticsGranularity::Weekly => date
            .checked_sub_signed(chrono::Duration::days(
                date.weekday().num_days_from_monday().into(),
            ))
            .ok_or_else(|| AppError::Internal("analytics week boundary overflow".into())),
        AnalyticsGranularity::Monthly => NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
            .ok_or_else(|| AppError::Internal("analytics month boundary overflow".into())),
    }
}

fn next_bucket_date(
    date: NaiveDate,
    granularity: AnalyticsGranularity,
) -> Result<NaiveDate, AppError> {
    match granularity {
        AnalyticsGranularity::Daily => date
            .succ_opt()
            .ok_or_else(|| AppError::Internal("analytics day boundary overflow".into())),
        AnalyticsGranularity::Weekly => date
            .checked_add_signed(chrono::Duration::days(7))
            .ok_or_else(|| AppError::Internal("analytics week boundary overflow".into())),
        AnalyticsGranularity::Monthly => {
            let (year, month) = if date.month() == 12 {
                (date.year() + 1, 1)
            } else {
                (date.year(), date.month() + 1)
            };
            NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| AppError::Internal("analytics month boundary overflow".into()))
        }
    }
}

fn local_day_start(timezone: chrono_tz::Tz, date: NaiveDate) -> Result<i64, AppError> {
    let midnight = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::Internal("invalid school calendar day".into()))?;
    timezone
        .from_local_datetime(&midnight)
        .earliest()
        .map(|instant| instant.timestamp_millis())
        .ok_or_else(|| AppError::Internal("school timezone has no day boundary".into()))
}

fn day_start_for_timestamp(timezone: chrono_tz::Tz, timestamp: i64) -> Result<i64, AppError> {
    let date = Utc
        .timestamp_millis_opt(timestamp)
        .single()
        .ok_or_else(|| AppError::Internal("invalid analytics timestamp".into()))?
        .with_timezone(&timezone)
        .date_naive();
    local_day_start(timezone, date)
}

fn empty_user_values() -> UserDailyActivityValues {
    UserDailyActivityValues {
        sessions: 0,
        reader_pages: 0,
        video_seconds: 0,
        flashcard_sessions: 0,
        llm_requests: 0,
        cost_micros: 0,
        policy_blocks: 0,
    }
}

fn provider_usage_buckets(
    timezone: chrono_tz::Tz,
    from: i64,
    to: i64,
    usage_by_day: &HashMap<i64, Vec<ProviderModelUsage>>,
) -> Result<Vec<ProviderUsageDay>, AppError> {
    history_bucket_boundaries(timezone, from, to, AnalyticsGranularity::Daily)?
        .into_iter()
        .map(|(start, end)| {
            let values = usage_by_day.get(&start).cloned();
            let partial = start < from || end > to;
            Ok(ProviderUsageDay {
                start,
                end,
                coverage: if partial {
                    Coverage::Partial
                } else if values.is_some() {
                    Coverage::Complete
                } else {
                    Coverage::Missing
                },
                values,
            })
        })
        .collect()
}

fn previous_period_boundaries(
    timezone: chrono_tz::Tz,
    primary: &[(i64, i64)],
    granularity: AnalyticsGranularity,
) -> Result<Vec<(i64, i64)>, AppError> {
    let Some(&(first_start, _)) = primary.first() else {
        return Ok(Vec::new());
    };
    let first_date = Utc
        .timestamp_millis_opt(first_start)
        .single()
        .ok_or_else(|| AppError::Internal("invalid analytics bucket boundary".into()))?
        .with_timezone(&timezone)
        .date_naive();
    let mut date = first_date;
    for _ in 0..primary.len() {
        date = previous_bucket_date(date, granularity)?;
    }
    let mut out = Vec::with_capacity(primary.len());
    for _ in primary {
        let end_date = next_bucket_date(date, granularity)?;
        out.push((
            local_day_start(timezone, date)?,
            local_day_start(timezone, end_date)?,
        ));
        date = end_date;
    }
    Ok(out)
}

fn previous_bucket_date(
    date: NaiveDate,
    granularity: AnalyticsGranularity,
) -> Result<NaiveDate, AppError> {
    match granularity {
        AnalyticsGranularity::Daily => date
            .pred_opt()
            .ok_or_else(|| AppError::Internal("analytics day boundary overflow".into())),
        AnalyticsGranularity::Weekly => date
            .checked_sub_signed(chrono::Duration::days(7))
            .ok_or_else(|| AppError::Internal("analytics week boundary overflow".into())),
        AnalyticsGranularity::Monthly => {
            let (year, month) = if date.month() == 1 {
                (date.year() - 1, 12)
            } else {
                (date.year(), date.month() - 1)
            };
            NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| AppError::Internal("analytics month boundary overflow".into()))
        }
    }
}

fn previous_year_boundaries(
    timezone: chrono_tz::Tz,
    primary: &[(i64, i64)],
) -> Result<Vec<(i64, i64)>, AppError> {
    primary
        .iter()
        .map(|&(start, end)| {
            let shift = |timestamp| -> Result<i64, AppError> {
                let date = Utc
                    .timestamp_millis_opt(timestamp)
                    .single()
                    .ok_or_else(|| AppError::Internal("invalid analytics bucket boundary".into()))?
                    .with_timezone(&timezone)
                    .date_naive();
                let shifted = previous_year_date(date)?;
                local_day_start(timezone, shifted)
            };
            Ok((shift(start)?, shift(end)?))
        })
        .collect()
}

fn previous_year_date(date: NaiveDate) -> Result<NaiveDate, AppError> {
    NaiveDate::from_ymd_opt(date.year() - 1, date.month(), date.day())
        // A daily Feb 29 bucket maps to Feb 28 through Mar 1 in a non-leap year,
        // preserving a positive, bounded comparison interval.
        .or_else(|| NaiveDate::from_ymd_opt(date.year() - 1, date.month(), 28))
        .ok_or_else(|| AppError::Internal("analytics year boundary overflow".into()))
}

async fn aggregate_history_bucket(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    from: i64,
    to: i64,
    partial: bool,
) -> Result<(i64, AnalyticsSummary, bool), AppError> {
    let (activity_rows, mut values, raw_expired) = if partial {
        partial_activity_summary(tx, group, from, to).await?
    } else {
        let (rows, values) = total_activity_summary(tx, group, from, to).await?;
        (rows, values, false)
    };
    let llm = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT COUNT(*) row_count,COALESCE(SUM(COALESCE(request.input_tokens,0)),0) input_tokens,COALESCE(SUM(COALESCE(request.output_tokens,0)),0) output_tokens,COALESCE(SUM(COALESCE(request.input_tokens,0)+COALESCE(request.output_tokens,0)),0) total_tokens,COALESCE(SUM(COALESCE(request.cost_micros,0)),0) cost_micros,COALESCE(SUM(request.latency_ms),0) latency_ms,COALESCE(SUM(CASE WHEN request.error_code IS NOT NULL THEN 1 ELSE 0 END),0) errors FROM llm_requests request JOIN conversations conversation ON conversation.id=request.conversation_id JOIN descendants d ON d.id=conversation.owner_group_id WHERE request.created_at*1000>=? AND request.created_at*1000<?")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let llm_rows: i64 = llm.get("row_count");
    values.llm_requests = llm_rows;
    values.input_tokens = llm.get("input_tokens");
    values.output_tokens = llm.get("output_tokens");
    values.total_tokens = llm.get("total_tokens");
    values.cost_micros = llm.get("cost_micros");
    values.latency_ms = llm.get("latency_ms");
    values.llm_errors = llm.get("errors");
    values.policy_blocks = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT COUNT(*) FROM llm_policy_block_events event JOIN descendants d ON d.id=event.owner_group_id WHERE event.created_at*1000>=? AND event.created_at*1000<?")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    Ok((
        activity_rows + llm_rows + values.policy_blocks,
        values,
        raw_expired,
    ))
}

async fn total_activity_summary(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    from: i64,
    to: i64,
) -> Result<(i64, AnalyticsSummary), AppError> {
    let total = sqlx::query("SELECT COUNT(*) row_count,COALESCE(SUM(watch_seconds),0) watch_seconds,COALESCE(SUM(completions),0) completions,COALESCE(SUM(reader_pages),0) reader_pages,COALESCE(SUM(flashcard_events),0) flashcard_events FROM analytics_daily_totals WHERE group_id=? AND day_start>=? AND day_start<?")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let rows: i64 = total.get("row_count");
    if rows == 0 {
        return Ok((0, AnalyticsSummary::default()));
    }
    let active_learners: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT user_id) FROM analytics_group_daily_learners WHERE group_id=? AND day_start>=? AND day_start<?")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT user_id || char(0) || activity_session_id) FROM analytics_group_daily_sessions WHERE group_id=? AND day_start>=? AND day_start<?")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    Ok((
        rows,
        AnalyticsSummary {
            active_learners,
            sessions,
            watch_seconds: total.get("watch_seconds"),
            completions: total.get("completions"),
            reader_pages: total.get("reader_pages"),
            flashcard_events: total.get("flashcard_events"),
            ..AnalyticsSummary::default()
        },
    ))
}

async fn partial_activity_summary(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    from: i64,
    to: i64,
) -> Result<(i64, AnalyticsSummary, bool), AppError> {
    let rows = sqlx::query("SELECT e.user_id,e.activity_session_id,e.event_type,e.activity_kind,e.occurred_at,e.content_id,e.language,e.title,e.privacy,e.current_page,e.current_time_millis,e.retained_until FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? ORDER BY e.user_id,e.activity_session_id,e.sequence,e.id")
        .bind(group)
        .bind(from)
        .bind(to)
        .fetch_all(&mut **tx)
        .await
        .map_err(db)?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    let retained_from: Option<i64> = sqlx::query_scalar(
        "SELECT retained_from FROM analytics_raw_retention_watermarks WHERE group_id=?",
    )
    .bind(group)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    let mut raw_expired =
        retained_from.is_some_and(|cutoff| from < cutoff) || from < now - 90 * 86_400_000;
    let events = rows
        .into_iter()
        .filter_map(|row| {
            if row.get::<i64, _>("retained_until") <= now {
                raw_expired = true;
                return None;
            }
            Some(Event {
                user: row.get("user_id"),
                session: row.get("activity_session_id"),
                event_type: row.get("event_type"),
                kind: row.get("activity_kind"),
                at: row.get("occurred_at"),
                content: row.get("content_id"),
                language: row.get("language"),
                title: row.get("title"),
                privacy: row.get("privacy"),
                page: row.get("current_page"),
                media: row.get("current_time_millis"),
            })
        })
        .collect::<Vec<_>>();
    let count = events.len() as i64;
    Ok((count, summarize(&events), raw_expired))
}

async fn raw_history_coverage(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    from: i64,
    now_millis: i64,
) -> Result<Coverage, AppError> {
    let retained_from: Option<i64> = sqlx::query_scalar(
        "SELECT retained_from FROM analytics_raw_retention_watermarks WHERE group_id=?",
    )
    .bind(group)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    if retained_from.is_some_and(|cutoff| from < cutoff) || from < now_millis - 90 * 86_400_000 {
        Ok(Coverage::RawExpired)
    } else {
        Ok(Coverage::Complete)
    }
}

async fn raw_history_coverage_descendants(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    from: i64,
    now_millis: i64,
) -> Result<Coverage, AppError> {
    let retained_from: Option<i64> = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id=d.id) SELECT MAX(w.retained_from) FROM analytics_raw_retention_watermarks w JOIN descendants d ON d.id=w.group_id")
        .bind(group)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if retained_from.is_some_and(|cutoff| from < cutoff) || from < now_millis - 90 * 86_400_000 {
        Ok(Coverage::RawExpired)
    } else {
        Ok(Coverage::Complete)
    }
}

fn encode_cursor(occurred_at: i64, id: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{occurred_at}\0{id}"))
}

fn decode_cursor(cursor: Option<&str>) -> Result<Option<(i64, String)>, AppError> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| AppError::BadRequest("invalid analytics cursor".into()))?;
    let value = String::from_utf8(bytes)
        .map_err(|_| AppError::BadRequest("invalid analytics cursor".into()))?;
    let (at, id) = value
        .split_once('\0')
        .ok_or_else(|| AppError::BadRequest("invalid analytics cursor".into()))?;
    let at = at
        .parse()
        .map_err(|_| AppError::BadRequest("invalid analytics cursor".into()))?;
    if id.is_empty() || id.contains(['\0', '\n', '\r']) {
        return Err(AppError::BadRequest("invalid analytics cursor".into()));
    }
    Ok(Some((at, id.to_owned())))
}

async fn ensure_live_principal(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
) -> Result<(), AppError> {
    if principal.service_key_id.is_some() {
        return Ok(());
    }
    let live:i64=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>unixepoch() AND u.status='active')").bind(&principal.session_id).bind(&principal.user_id).fetch_one(&mut **tx).await.map_err(db)?;
    if live == 1 {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

#[derive(Clone)]
struct Event {
    user: String,
    session: String,
    event_type: String,
    kind: String,
    at: i64,
    content: Option<String>,
    language: Option<String>,
    title: Option<String>,
    privacy: String,
    page: Option<i64>,
    media: Option<i64>,
}
fn summarize(events: &[Event]) -> AnalyticsSummary {
    let mut s = AnalyticsSummary::default();
    let mut users = HashSet::new();
    let mut sessions = HashSet::new();
    type PreviousEvent = (i64, Option<i64>, Option<i64>);
    let mut previous: HashMap<(&str, &str), PreviousEvent> = HashMap::new();
    for e in events {
        users.insert(&e.user);
        sessions.insert((&e.user, &e.session));
        if e.event_type == "activity.completed" {
            s.completions += 1
        }
        if e.kind == "flashcards" && e.event_type == "activity.completed" {
            s.flashcard_events += 1
        }
        let key = (e.user.as_str(), e.session.as_str());
        if let Some((at, media, page)) = previous.get(&key) {
            let wall = e.at - *at;
            if wall > 0 && wall <= 300_000 {
                if e.kind == "video" {
                    if let (Some(a), Some(b)) = (*media, e.media) {
                        let d = b - a;
                        if d > 0 && d <= wall.saturating_add(2_000) {
                            s.watch_seconds += (d.min(wall) / 1000).min(300)
                        }
                    }
                }
                if e.kind == "reader" {
                    if let (Some(a), Some(b)) = (*page, e.page) {
                        s.reader_pages += (b - a).max(0)
                    }
                }
            }
        }
        previous.insert(key, (e.at, e.media, e.page));
    }
    s.active_learners = users.len() as i64;
    s.sessions = sessions.len() as i64;
    s
}

fn add_summary(target: &mut AnalyticsSummary, source: &AnalyticsSummary) {
    target.active_learners += source.active_learners;
    target.sessions += source.sessions;
    target.watch_seconds += source.watch_seconds;
    target.completions += source.completions;
    target.reader_pages += source.reader_pages;
    target.flashcard_events += source.flashcard_events;
    target.llm_requests += source.llm_requests;
    target.input_tokens += source.input_tokens;
    target.output_tokens += source.output_tokens;
    target.total_tokens += source.total_tokens;
    target.cost_micros += source.cost_micros;
    target.policy_blocks += source.policy_blocks;
    target.latency_ms += source.latency_ms;
    target.llm_errors += source.llm_errors;
}

fn summary_coverage(buckets: &[HistoricalBucket]) -> Coverage {
    if buckets
        .iter()
        .any(|bucket| bucket.coverage == Coverage::RawExpired)
    {
        Coverage::RawExpired
    } else if buckets
        .iter()
        .any(|bucket| bucket.coverage == Coverage::Partial)
    {
        Coverage::Partial
    } else if buckets
        .iter()
        .any(|bucket| bucket.coverage == Coverage::Missing)
    {
        Coverage::Missing
    } else {
        Coverage::Complete
    }
}
fn db(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("analytics database error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::IdentityType;
    use sqlx::sqlite::SqlitePoolOptions;
    fn event(
        user: &str,
        session: &str,
        kind: &str,
        at: i64,
        media: Option<i64>,
        page: Option<i64>,
    ) -> Event {
        Event {
            user: user.into(),
            session: session.into(),
            event_type: "activity.progressed".into(),
            kind: kind.into(),
            at,
            content: Some("content".into()),
            language: Some("de".into()),
            title: Some("Title".into()),
            privacy: "title-and-progress".into(),
            page,
            media,
        }
    }
    #[test]
    fn watch_time_ignores_forward_seeks_backwards_and_long_wall_gaps() {
        let events = vec![
            event("a", "s", "video", 0, Some(0), None),
            event("a", "s", "video", 10_000, Some(10_000), None),
            event("a", "s", "video", 20_000, Some(100_000), None),
            event("a", "s", "video", 30_000, Some(90_000), None),
            event("a", "s", "video", 400_000, Some(100_000), None),
        ];
        assert_eq!(summarize(&events).watch_seconds, 10)
    }
    #[test]
    fn reader_never_counts_backward_pages() {
        let events = vec![
            event("a", "s", "reader", 0, None, Some(2)),
            event("a", "s", "reader", 1_000, None, Some(5)),
            event("a", "s", "reader", 2_000, None, Some(3)),
        ];
        assert_eq!(summarize(&events).reader_pages, 3)
    }
    #[test]
    fn sessions_and_learners_are_distinct() {
        let events = vec![
            event("a", "one", "video", 0, Some(0), None),
            event("a", "one", "video", 1_000, Some(1_000), None),
            event("a", "two", "video", 0, Some(0), None),
            event("b", "one", "video", 0, Some(0), None),
        ];
        let s = summarize(&events);
        assert_eq!((s.active_learners, s.sessions), (2, 3))
    }

    #[test]
    fn analytics_cursor_round_trips_and_rejects_malformed_values() {
        let cursor = encode_cursor(42, "learner-1");
        assert_eq!(
            decode_cursor(Some(&cursor)).unwrap(),
            Some((42, "learner-1".into()))
        );
        assert!(decode_cursor(Some("not base64!")).is_err());
        assert!(decode_cursor(Some(&URL_SAFE_NO_PAD.encode("42\0bad\n"))).is_err());
    }

    #[tokio::test]
    async fn history_uses_school_days_across_the_paris_dst_transition() {
        let boundaries = history_bucket_boundaries(
            "Europe/Paris".parse().unwrap(),
            1_774_656_000_000,
            1_774_828_800_000,
            AnalyticsGranularity::Daily,
        )
        .unwrap();

        assert_eq!(boundaries.len(), 3);
        assert_eq!(boundaries[0], (1_774_652_400_000, 1_774_738_800_000));
        assert_eq!(boundaries[1], (1_774_738_800_000, 1_774_821_600_000));
        assert_eq!(boundaries[2], (1_774_821_600_000, 1_774_908_000_000));
        let comparison = previous_period_boundaries(
            "Europe/Paris".parse().unwrap(),
            &boundaries,
            AnalyticsGranularity::Daily,
        )
        .unwrap();
        assert_eq!(comparison.len(), boundaries.len());
        assert_eq!(comparison.last().unwrap().1, boundaries[0].0);
    }

    #[test]
    fn history_query_keeps_missing_coverage_distinct_from_zero_values() {
        let bucket = HistoricalBucket {
            start: 0,
            end: 86_400_000,
            coverage: Coverage::Missing,
            values: None,
        };

        assert_eq!(bucket.coverage, Coverage::Missing);
        assert!(bucket.values.is_none());
    }

    #[test]
    fn history_rejects_ranges_over_366_days() {
        assert!(matches!(
            validate_history_range(0, 366 * 86_400_000 + 1),
            Err(AppError::BadRequest(_))
        ));
    }

    #[test]
    fn history_keeps_the_trailing_partial_calendar_bucket() {
        let boundaries = history_bucket_boundaries(
            chrono_tz::UTC,
            3_600_000,
            90_000_000,
            AnalyticsGranularity::Daily,
        )
        .unwrap();

        assert_eq!(boundaries, vec![(0, 86_400_000), (86_400_000, 172_800_000)]);
    }

    #[test]
    fn previous_year_leap_day_bucket_has_a_positive_interval() {
        let primary = vec![(
            1_709_164_800_000, // 2024-02-29T00:00:00Z
            1_709_251_200_000, // 2024-03-01T00:00:00Z
        )];
        let previous = previous_year_boundaries(chrono_tz::UTC, &primary).unwrap();

        assert_eq!(previous, vec![(1_677_542_400_000, 1_677_628_800_000)]);
        assert!(previous[0].1 > previous[0].0);
    }

    #[tokio::test]
    async fn canonical_totals_keep_weekly_and_monthly_distinct_counts_across_days() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','Learner','active','learner',0,1,1)")
            .execute(&pool)
            .await
            .unwrap();
        for (day_start, watch_seconds) in
            [(0_i64, 10_i64), (86_400_000, 20_i64), (172_800_000, 30_i64)]
        {
            sqlx::query("INSERT INTO analytics_daily_totals(group_id,day_start,active_learners,sessions,watch_seconds,completions,reader_pages,flashcard_events,updated_at) VALUES('root',?,1,1,?,0,0,0,1)")
                .bind(day_start)
                .bind(watch_seconds)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO analytics_group_daily_learners(group_id,day_start,user_id) VALUES('root',?,?)")
                .bind(day_start)
                .bind("learner")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO analytics_group_daily_sessions(group_id,day_start,user_id,activity_session_id) VALUES('root',?,?,?)")
                .bind(day_start)
                .bind("learner")
                .bind("session")
                .execute(&pool)
                .await
                .unwrap();
        }
        let mut transaction = pool.begin().await.unwrap();
        let (_, summary) = total_activity_summary(&mut transaction, "root", 0, 172_800_000)
            .await
            .unwrap();

        assert_eq!(summary.active_learners, 1);
        assert_eq!(summary.sessions, 1);
        assert_eq!(summary.watch_seconds, 30);
        let (_, monthly_summary) = total_activity_summary(&mut transaction, "root", 0, 259_200_000)
            .await
            .unwrap();
        assert_eq!(monthly_summary.active_learners, 1);
        assert_eq!(monthly_summary.sessions, 1);
        assert_eq!(monthly_summary.watch_seconds, 60);
    }

    #[tokio::test]
    async fn partial_history_marks_expired_raw_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','Learner','active','learner',0,1,1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',1)")
            .execute(&pool)
            .await
            .unwrap();
        let event_id = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,retention_days,retained_until,ancestry_state) VALUES('expired','learner','root','policy','hash',1,'activity.started','flashcards','progress-only','session','source',1,1,1,1,0,'building')")
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();
        sqlx::query(
            "INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'root')",
        )
        .bind(event_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO analytics_retention_delete_queue(event_row_id) VALUES(?)")
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM activity_events WHERE id=?")
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO analytics_raw_retention_watermarks(group_id,retained_from,updated_at) VALUES('root',2,1)")
            .execute(&pool)
            .await
            .unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let (_, _, raw_expired) = partial_activity_summary(&mut transaction, "root", 0, 10)
            .await
            .unwrap();

        assert!(raw_expired);
    }

    #[tokio::test]
    async fn partial_history_straddling_max_raw_age_fails_closed_without_watermark() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',1)")
            .execute(&pool)
            .await
            .unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp() * 1_000;
        let mut transaction = pool.begin().await.unwrap();
        let (_, _, raw_expired) = partial_activity_summary(
            &mut transaction,
            "root",
            now - 90 * 86_400_000 - 1,
            now - 90 * 86_400_000 + 1,
        )
        .await
        .unwrap();

        assert!(raw_expired);
    }

    #[tokio::test]
    async fn history_drilldown_reports_expired_raw_coverage_without_fabricating_events() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let from = (now - 91 * 86_400) * 1_000;
        let to = from + 86_400_000;
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('teacher','teacher@test','teacher@test','Teacher','active','teacher',0,?,?)")
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('class',NULL,'Class','class','active',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('membership','class','teacher','active',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES('membership','analytics.view')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at,active_group_id) VALUES('session','teacher',?,?,?,'class')")
            .bind(now + 3_600)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO analytics_daily_totals(group_id,day_start,active_learners,sessions,watch_seconds,completions,reader_pages,flashcard_events,updated_at) VALUES('class',?,1,1,60,0,0,0,?)")
            .bind(from)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO analytics_raw_retention_watermarks(group_id,retained_from,updated_at) VALUES('class',?,?)")
            .bind(to)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        let principal = Principal {
            user_id: "teacher".into(),
            service_key_id: None,
            session_id: "session".into(),
            device_id: "device".into(),
            active_group_id: Some("class".into()),
            identity_type: IdentityType::Teacher,
            is_root: false,
        };

        let page = AnalyticsQueryService::new(pool)
            .history_events(&principal, "class", from, to, 50, None)
            .await
            .unwrap();

        assert_eq!(page.coverage, Coverage::RawExpired);
        assert!(page.items.is_empty());
        assert_eq!(page.total, 0);
    }

    #[tokio::test]
    async fn history_drilldown_keeps_redacted_llm_metadata_in_millisecond_range_and_pages_without_duplicates(
    ) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let boundary = (now + 1) * 1_000;
        let from = now * 1_000 + 1;
        let to = boundary + 1;
        for (id, identity_type) in [("teacher", "teacher"), ("learner", "learner")] {
            sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?,'active',?,0,?,?)")
                .bind(id)
                .bind(format!("{id}@test"))
                .bind(format!("{id}@test"))
                .bind(id)
                .bind(identity_type)
                .bind(now)
                .bind(now)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('class',NULL,'Class','class','active',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        for (id, user) in [
            ("teacher-membership", "teacher"),
            ("learner-membership", "learner"),
        ] {
            sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,'class',?,'active',?)")
                .bind(id)
                .bind(user)
                .bind(now)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES('teacher-membership','analytics.view')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at,active_group_id) VALUES('session','teacher',?,?,?,'class')")
            .bind(now + 3_600)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO llm_providers(id,group_id,name,provider_kind,base_url,status,created_by_user_id,created_at,updated_at) VALUES('provider','class','Provider','ollama','http://ollama','active','teacher',?,?)")
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO llm_models(id,group_id,provider_id,model_key,upstream_model,status,created_by_user_id,created_at,updated_at) VALUES('model','class','provider','balanced','model-v1','active','teacher',?,?)")
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO provider_price_versions(id,group_id,provider_id,model_id,currency,unit,input_cost_micros,output_cost_micros,idempotency_key,created_by_user_id,created_at) VALUES('price','class','provider','model','CHF','perMillionTokens',1,1,'price','teacher',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        for (suffix, created_at) in [("stale", now), ("boundary", now + 1)] {
            sqlx::query("INSERT INTO quota_reservations(id,request_id,learner_user_id,direct_group_id,provider_id,model_id,price_version_id,payload_hash,status,expires_at,accounting_at,finalized,created_at,reconciled_at,reconcile_hash) VALUES(?,?,'learner','class','provider','model','price',zeroblob(32),'reconciled',?,?,1,?,?,zeroblob(32))")
                .bind(format!("reservation-{suffix}"))
                .bind(format!("request-{suffix}"))
                .bind(now + 3_600)
                .bind(created_at)
                .bind(created_at)
                .bind(created_at)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO conversations(id,owner_group_id,learner_user_id,created_at,updated_at,retained_until,status) VALUES(?,'class','learner',?,?,0,'pending')")
                .bind(format!("conversation-{suffix}"))
                .bind(created_at)
                .bind(created_at)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO llm_requests(id,conversation_id,reservation_id,provider_id,model_id,price_version_id,status,created_at) VALUES(?,?,?,'provider','model','price','completed',?)")
                .bind(format!("request-{suffix}"))
                .bind(format!("conversation-{suffix}"))
                .bind(format!("reservation-{suffix}"))
                .bind(created_at)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO conversation_messages(id,conversation_id,request_id,sequence,role,encrypted_content,content_bytes,truncated,retained,created_at) VALUES('redacted-message','conversation-boundary','request-boundary',0,'user',NULL,0,0,0,?)")
            .bind(now + 1)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO llm_policy_block_events(id,owner_group_id,learner_user_id,policy_version_id,policy_compiled_hash,error_code,created_at) VALUES('policy-boundary','class','learner','policy','hash','policy_denied',?)")
            .bind(now + 1)
            .execute(&pool)
            .await
            .unwrap();
        insert_video_pair(
            &pool,
            "learner",
            "class",
            "same-time",
            0,
            &["class"],
            boundary,
        )
        .await;
        let principal = Principal {
            user_id: "teacher".into(),
            service_key_id: None,
            session_id: "session".into(),
            device_id: "device".into(),
            active_group_id: Some("class".into()),
            identity_type: IdentityType::Teacher,
            is_root: false,
        };
        let service = AnalyticsQueryService::new(pool);

        let first = service
            .history_events(&principal, "class", from, to, 2, None)
            .await
            .unwrap();
        let second = service
            .history_events(
                &principal,
                "class",
                from,
                to,
                2,
                first.next_cursor.as_deref(),
            )
            .await
            .unwrap();

        assert_eq!(first.total, 4);
        assert_eq!(
            first
                .items
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["policy-block:policy-boundary", "llm:request-boundary"]
        );
        assert_eq!(
            second
                .items
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["activity:2", "activity:1"]
        );
        assert!(second.next_cursor.is_none());
        assert!(first
            .items
            .iter()
            .chain(&second.items)
            .all(|event| event.id != "llm:request-stale"));
    }

    async fn insert_video_pair(
        pool: &SqlitePool,
        user: &str,
        group: &str,
        session: &str,
        seconds: i64,
        ancestry: &[&str],
        now: i64,
    ) {
        for (sequence, media) in [(1, 0), (2, seconds * 1000)] {
            let result=sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,current_time_millis,duration_millis,retention_days,retained_until) VALUES(?,?,?,?,?,1,'activity.progressed','video','progress-only',?,'video',?,?,?,?,?,90,?)").bind(format!("{session}-{sequence}")).bind(user).bind(group).bind("policy").bind(format!("hash-{session}-{sequence}")).bind(session).bind(sequence).bind(now+(sequence-1)*seconds*1000).bind(now/1000).bind(media).bind(3_600_000).bind(now+90*86_400_000).execute(pool).await.unwrap();
            let id = result.last_insert_rowid();
            for (ordinal, g) in ancestry.iter().enumerate() {
                sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,?,?)").bind(id).bind(ordinal as i64).bind(g).execute(pool).await.unwrap();
            }
            sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
                .bind(id)
                .execute(pool)
                .await
                .unwrap();
        }
    }
    #[tokio::test]
    async fn history_scopes_descendants_and_denies_sibling_groups() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let millis = now * 1000;
        for (id, kind) in [
            ("manager", "teacher"),
            ("a-teacher", "teacher"),
            ("learner-a", "learner"),
            ("learner-b", "learner"),
        ] {
            sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?, 'active',?,0,?,?)").bind(id).bind(format!("{id}@test")).bind(format!("{id}@test")).bind(id).bind(kind).bind(now).bind(now).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',?),('a','root','A','a','active',?),('b','root','B','b','active',?)").bind(now).bind(now).bind(now).execute(&pool).await.unwrap();
        for (id, g, u) in [
            ("m-root", "root", "manager"),
            ("m-a", "a", "a-teacher"),
            ("m-la", "a", "learner-a"),
            ("m-lb", "b", "learner-b"),
        ] {
            sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,?,?,'active',?)").bind(id).bind(g).bind(u).bind(now).execute(&pool).await.unwrap();
        }
        for membership in ["m-root", "m-a"] {
            sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,'analytics.view')").bind(membership).execute(&pool).await.unwrap();
        }
        for (id, user, group) in [("s-root", "manager", "root"), ("s-a", "a-teacher", "a")] {
            sqlx::query("INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at,active_group_id) VALUES(?,?,?, ?, ?,?)").bind(id).bind(user).bind(now+3600).bind(now).bind(now).bind(group).execute(&pool).await.unwrap();
        }
        insert_video_pair(
            &pool,
            "learner-a",
            "a",
            "watch-a",
            30,
            &["root", "a"],
            millis,
        )
        .await;
        insert_video_pair(
            &pool,
            "learner-b",
            "b",
            "watch-b",
            20,
            &["root", "b"],
            millis,
        )
        .await;
        // This pair shares the selected calendar day but lies beyond the requested
        // trailing partial range. The history query must not include its ten seconds.
        insert_video_pair(
            &pool,
            "learner-b",
            "b",
            "watch-outside-range",
            10,
            &["root", "b"],
            millis + 90_000,
        )
        .await;
        let event_ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM activity_events ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        for event_id in event_ids {
            crate::analytics::rollups::rebuild_daily_rollups(&pool, event_id)
                .await
                .unwrap();
        }
        let principal = |user: &str, session: &str, group: &str| Principal {
            user_id: user.into(),
            service_key_id: None,
            session_id: session.into(),
            device_id: "device".into(),
            active_group_id: Some(group.into()),
            identity_type: IdentityType::Teacher,
            is_root: false,
        };
        let service = AnalyticsQueryService::new(pool.clone());
        let history_query = || HistoricalAnalyticsQuery {
            from: millis - 1,
            to: millis + 60_001,
            granularity: AnalyticsGranularity::Daily,
            metrics: vec![AnalyticsMetric::WatchSeconds],
            comparison: ComparisonMode::None,
        };
        assert_eq!(
            service
                .history(
                    &principal("manager", "s-root", "root"),
                    "root",
                    history_query()
                )
                .await
                .unwrap()
                .primary[0]
                .values
                .as_ref()
                .unwrap()
                .watch_seconds,
            50
        );
        assert_eq!(
            service
                .history(&principal("a-teacher", "s-a", "a"), "a", history_query())
                .await
                .unwrap()
                .primary[0]
                .values
                .as_ref()
                .unwrap()
                .watch_seconds,
            30
        );
        assert!(matches!(
            service
                .history(&principal("a-teacher", "s-a", "a"), "b", history_query())
                .await,
            Err(AppError::Forbidden(_))
        ));
        assert_eq!(
            service
                .history_events(
                    &principal("a-teacher", "s-a", "a"),
                    "a",
                    millis - 1,
                    millis + 60_001,
                    50,
                    None,
                )
                .await
                .unwrap()
                .items
                .len(),
            2
        );
        assert!(matches!(
            service
                .history_events(
                    &principal("a-teacher", "s-a", "a"),
                    "b",
                    millis - 1,
                    millis + 60_001,
                    50,
                    None,
                )
                .await,
            Err(AppError::Forbidden(_))
        ));
        assert_eq!(
            service
                .summary(
                    &principal("manager", "s-root", "root"),
                    "root",
                    millis - 1,
                    millis + 60_001
                )
                .await
                .unwrap()
                .watch_seconds,
            50
        );
        assert_eq!(
            service
                .summary(
                    &principal("a-teacher", "s-a", "a"),
                    "a",
                    millis - 1,
                    millis + 60_001
                )
                .await
                .unwrap()
                .watch_seconds,
            30
        );
        assert!(matches!(
            service
                .summary(
                    &principal("a-teacher", "s-a", "a"),
                    "b",
                    millis - 1,
                    millis + 60_001
                )
                .await,
            Err(AppError::Forbidden(_))
        ));
        sqlx::query("UPDATE groups SET status='archived' WHERE id='b'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            service
                .summary(
                    &principal("manager", "s-root", "root"),
                    "root",
                    millis - 1,
                    millis + 60_001
                )
                .await
                .unwrap()
                .watch_seconds,
            50
        );
        sqlx::query("UPDATE sessions SET revoked_at=? WHERE id='s-root'")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            service
                .summary(
                    &principal("manager", "s-root", "root"),
                    "root",
                    millis - 1,
                    millis + 60_001
                )
                .await,
            Err(AppError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn user_history_is_factual_and_scoped_to_the_selected_group() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let millis = now * 1_000;
        for (id, identity_type) in [
            ("teacher", "teacher"),
            ("learner-a", "learner"),
            ("learner-b", "learner"),
        ] {
            sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?, 'active',?,0,?,?)")
                .bind(id)
                .bind(format!("{id}@test"))
                .bind(id)
                .bind(id)
                .bind(identity_type)
                .bind(now)
                .bind(now)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',?),('selected','root','Selected','selected','active',?),('sibling','root','Sibling','sibling','active',?)")
            .bind(now)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('child','selected','Child','child','active',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        for (id, group, user) in [
            ("teacher-membership", "selected", "teacher"),
            ("learner-a-membership", "selected", "learner-a"),
            ("learner-b-membership", "sibling", "learner-b"),
        ] {
            sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,?,?,'active',?)")
                .bind(id)
                .bind(group)
                .bind(user)
                .bind(now)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES('teacher-membership','analytics.view')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at,active_group_id) VALUES('teacher-session','teacher',?,?,?,'selected')")
            .bind(now + 3_600)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        insert_video_pair(
            &pool,
            "learner-a",
            "selected",
            "video",
            30,
            &["root", "selected"],
            millis,
        )
        .await;
        insert_video_pair(
            &pool,
            "learner-a",
            "child",
            "child-video",
            10,
            &["root", "selected", "child"],
            millis,
        )
        .await;
        insert_video_pair(
            &pool,
            "learner-b",
            "sibling",
            "other-video",
            20,
            &["root", "sibling"],
            millis,
        )
        .await;
        let event_id = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,current_page,retention_days,retained_until,ancestry_state) VALUES('reader','learner-a','selected','policy','reader-hash',1,'activity.progressed','reader','progress-only','reader-session','reader',1,?,?,4,90,?,'building')")
            .bind(millis)
            .bind(now)
            .bind(millis + 90 * 86_400_000)
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();
        sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'root'),(?,1,'selected')")
            .bind(event_id)
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        let flashcard_id = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,retention_days,retained_until,ancestry_state) VALUES('flashcards','learner-a','selected','policy','flashcards-hash',1,'activity.started','flashcards','progress-only','flashcard-session','flashcards',1,?,?,90,?,'building')")
            .bind(millis)
            .bind(now)
            .bind(millis + 90 * 86_400_000)
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();
        sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'root'),(?,1,'selected')")
            .bind(flashcard_id)
            .bind(flashcard_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
            .bind(flashcard_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO llm_policy_block_events(id,owner_group_id,learner_user_id,policy_version_id,policy_compiled_hash,error_code,created_at) VALUES('block','selected','learner-a','policy','hash','policy_denied',?)")
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        let principal = Principal {
            user_id: "teacher".into(),
            service_key_id: None,
            session_id: "teacher-session".into(),
            device_id: "device".into(),
            active_group_id: Some("selected".into()),
            identity_type: IdentityType::Teacher,
            is_root: false,
        };

        let history = AnalyticsQueryService::new(pool.clone())
            .user_history(
                &principal,
                "selected",
                "learner-a",
                millis - 1,
                millis + 60_000,
            )
            .await
            .unwrap();

        assert_eq!(history.daily.len(), 1);
        let values = history.daily[0].values.as_ref().unwrap();
        assert_eq!(values.sessions, 4);
        assert_eq!(values.reader_pages, 0);
        assert_eq!(values.video_seconds, 40);
        assert_eq!(values.flashcard_sessions, 1);
        assert_eq!(values.llm_requests, 0);
        assert_eq!(values.cost_micros, 0);
        assert_eq!(values.policy_blocks, 1);

        let retention = AnalyticsQueryService::new(pool.clone())
            .user_history(
                &principal,
                "selected",
                "learner-a",
                millis - 91 * 86_400_000,
                millis + 60_000,
            )
            .await
            .unwrap();
        assert!(retention
            .daily
            .iter()
            .any(|day| { day.coverage == Coverage::RawExpired && day.values.is_none() }));
        assert!(retention
            .daily
            .iter()
            .any(|day| { day.coverage == Coverage::Missing && day.values.is_none() }));
        assert!(retention.daily.iter().any(|day| {
            day.values
                .as_ref()
                .is_some_and(|values| values.reader_pages == 0)
        }));

        sqlx::query("INSERT INTO analytics_raw_retention_watermarks(group_id,retained_from,updated_at) VALUES('selected',?,?),('child',?,?)")
            .bind(millis - 2 * 86_400_000)
            .bind(now)
            .bind(millis + 86_400_000)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        let child_watermark = AnalyticsQueryService::new(pool)
            .user_history(
                &principal,
                "selected",
                "learner-a",
                millis - 86_400_000,
                millis - 1,
            )
            .await
            .unwrap();
        assert!(child_watermark
            .daily
            .iter()
            .all(|day| { day.coverage == Coverage::RawExpired && day.values.is_none() }));
    }

    #[test]
    fn provider_history_uses_school_day_boundaries_and_keeps_missing_buckets() {
        let buckets = provider_usage_buckets(
            "Europe/Paris".parse().unwrap(),
            1_774_656_000_000,
            1_774_828_800_000,
            &HashMap::new(),
        )
        .unwrap();

        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0].start, 1_774_652_400_000);
        assert_eq!(buckets[0].end, 1_774_738_800_000);
        assert_eq!(buckets[1].start, 1_774_738_800_000);
        assert_eq!(buckets[1].end, 1_774_821_600_000);
        assert_eq!(buckets[1].coverage, Coverage::Missing);
        assert!(buckets[1].values.is_none());
    }
}
