use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{TimeZone, Utc};
use serde::Serialize;
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
}
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmAnalytics {
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_micros: i64,
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

#[derive(Clone)]
pub struct AnalyticsQueryService {
    pool: SqlitePool,
}
impl AnalyticsQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
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
        let events = self.authorized_events(principal, group, from, to).await?;
        let mut result = summarize(&events);
        self.add_llm(principal, group, from, to, &mut result)
            .await?;
        Ok(result)
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
        let events = self.authorized_events(principal, group, from, to).await?;
        let timezone:Option<String>=sqlx::query_scalar("WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM groups WHERE id=? UNION ALL SELECT g.id,g.parent_id FROM groups g JOIN ancestors a ON a.parent_id=g.id) SELECT c.timezone FROM ancestors a JOIN school_quota_calendars c ON c.root_group_id=a.id WHERE a.parent_id IS NULL").bind(group).fetch_optional(&self.pool).await.map_err(db)?;
        let timezone: chrono_tz::Tz = timezone
            .as_deref()
            .unwrap_or("UTC")
            .parse()
            .map_err(|_| AppError::Internal("invalid school timezone".into()))?;
        let mut days: HashMap<i64, Vec<Event>> = HashMap::new();
        for e in events {
            let instant = Utc
                .timestamp_millis_opt(e.at)
                .single()
                .ok_or_else(|| AppError::Internal("invalid analytics timestamp".into()))?;
            let date = instant.with_timezone(&timezone).date_naive();
            let local_midnight = date
                .and_hms_opt(0, 0, 0)
                .ok_or_else(|| AppError::Internal("invalid school calendar day".into()))?;
            let day_start = timezone
                .from_local_datetime(&local_midnight)
                .earliest()
                .ok_or_else(|| AppError::Internal("school timezone has no day boundary".into()))?
                .timestamp_millis();
            days.entry(day_start).or_default().push(e);
        }
        let mut out: Vec<_> = days
            .into_iter()
            .map(|(day_start, events)| TimeseriesPoint {
                day_start,
                summary: summarize(&events),
            })
            .collect();
        out.sort_by_key(|p| p.day_start);
        Ok(out)
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
        tx.commit().await.map_err(db)?;
        Ok(())
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
    let mut previous: HashMap<(&str, &str), (i64, Option<i64>, Option<i64>)> = HashMap::new();
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
            let result=sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,current_time_millis,duration_millis,retention_days,retained_until) VALUES(?,?,?,?,?,1,'activity.progressed','video','progress-only',?,'video',?,?,?,?,?,90,?)").bind(format!("{session}-{sequence}")).bind(user).bind(group).bind("policy").bind(format!("hash-{session}-{sequence}")).bind(session).bind(sequence).bind(now+(sequence-1)*seconds*1000).bind(now/1000).bind(media).bind(3600_000).bind(now+90*86_400_000).execute(pool).await.unwrap();
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
    async fn parent_sums_descendants_child_isolated_archived_history_and_revocation_fail_closed() {
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
}
