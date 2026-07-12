use chrono::{TimeZone, Utc};
use std::collections::{HashMap, HashSet};

use crate::error::AppError;
use sqlx::{Connection, Row, SqlitePool};

pub async fn rebuild_daily_rollups(pool: &SqlitePool, event_row_id: i64) -> Result<(), AppError> {
    let mut connection = pool.acquire().await.map_err(db)?;
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
    rebuild_daily_rollups_in_transaction(&mut tx, event_row_id).await?;
    tx.commit().await.map_err(db)?;
    Ok(())
}

/// Rebuilds canonical school-calendar totals from finalized history. This is
/// idempotent and runs as one transaction when the daily-total migration is first applied.
pub async fn backfill_daily_totals(pool: &SqlitePool) -> Result<(), AppError> {
    let mut connection = pool.acquire().await.map_err(db)?;
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
    let event_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM activity_events WHERE ancestry_state='finalized' ORDER BY id",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    for event_id in event_ids {
        rebuild_daily_rollups_in_transaction(&mut tx, event_id).await?;
    }
    tx.commit().await.map_err(db)
}

pub async fn rebuild_daily_rollups_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_row_id: i64,
) -> Result<(), AppError> {
    let buckets = sqlx::query("SELECT a.group_id,(e.occurred_at/86400000)*86400000 day_start,e.activity_kind,COALESCE(e.content_id,'') content_id,COALESCE(e.language,'') language FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE e.id=? AND e.ancestry_state='finalized'")
        .bind(event_row_id).fetch_all(&mut **tx).await.map_err(db)?;
    for bucket in buckets {
        let group_id: String = bucket.get("group_id");
        let day_start: i64 = bucket.get("day_start");
        let kind: String = bucket.get("activity_kind");
        let content_id: String = bucket.get("content_id");
        let language: String = bucket.get("language");
        let rows = sqlx::query("SELECT e.user_id,e.activity_session_id,e.event_type,e.activity_kind,e.occurred_at,e.current_time_millis,e.current_page FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND (e.occurred_at/86400000)*86400000=? AND e.activity_kind=? AND COALESCE(e.content_id,'')=? AND COALESCE(e.language,'')=? ORDER BY e.user_id,e.activity_session_id,e.sequence,e.id")
            .bind(&group_id).bind(day_start).bind(&kind).bind(&content_id).bind(&language).fetch_all(&mut **tx).await.map_err(db)?;
        let mut users = HashSet::new();
        let mut sessions = HashSet::new();
        type PreviousEvent = (i64, Option<i64>, Option<i64>);
        let mut previous: HashMap<(String, String), PreviousEvent> = HashMap::new();
        let (mut watch_seconds, mut completions, mut reader_pages, mut flashcard_events) =
            (0_i64, 0_i64, 0_i64, 0_i64);
        for row in rows {
            let user: String = row.get("user_id");
            let session: String = row.get("activity_session_id");
            let event_type: String = row.get("event_type");
            let row_kind: String = row.get("activity_kind");
            let occurred_at: i64 = row.get("occurred_at");
            let media: Option<i64> = row.get("current_time_millis");
            let page: Option<i64> = row.get("current_page");
            users.insert(user.clone());
            sessions.insert((user.clone(), session.clone()));
            if event_type == "activity.completed" {
                completions += 1;
            }
            if row_kind == "flashcards" && event_type == "activity.completed" {
                flashcard_events += 1;
            }
            if let Some((previous_at, previous_media, previous_page)) =
                previous.get(&(user.clone(), session.clone()))
            {
                let wall = occurred_at - previous_at;
                if wall > 0 && wall <= 300_000 {
                    if row_kind == "video" {
                        if let (Some(before), Some(after)) = (*previous_media, media) {
                            let delta = after - before;
                            if delta > 0 && delta <= wall.saturating_add(2_000) {
                                watch_seconds += delta.min(wall).div_euclid(1000).min(300);
                            }
                        }
                    } else if row_kind == "reader" {
                        if let (Some(before), Some(after)) = (*previous_page, page) {
                            reader_pages += (after - before).max(0);
                        }
                    }
                }
            }
            previous.insert((user, session), (occurred_at, media, page));
        }
        sqlx::query("INSERT INTO analytics_daily_rollups(group_id,day_start,activity_kind,content_id,language,active_learners,sessions,watch_seconds,completions,reader_pages,flashcard_events,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,unixepoch()) ON CONFLICT(group_id,day_start,activity_kind,content_id,language) DO UPDATE SET active_learners=excluded.active_learners,sessions=excluded.sessions,watch_seconds=excluded.watch_seconds,completions=excluded.completions,reader_pages=excluded.reader_pages,flashcard_events=excluded.flashcard_events,updated_at=excluded.updated_at")
            .bind(group_id).bind(day_start).bind(kind).bind(content_id).bind(language).bind(users.len() as i64).bind(sessions.len() as i64).bind(watch_seconds).bind(completions).bind(reader_pages).bind(flashcard_events).execute(&mut **tx).await.map_err(db)?;
    }
    let groups = sqlx::query("SELECT DISTINCT a.group_id,e.occurred_at FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE e.id=? AND e.ancestry_state='finalized'")
        .bind(event_row_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(db)?;
    for group in groups {
        let group_id: String = group.get("group_id");
        let occurred_at: i64 = group.get("occurred_at");
        let timezone = school_timezone(tx, &group_id).await?;
        let date = Utc
            .timestamp_millis_opt(occurred_at)
            .single()
            .ok_or_else(|| AppError::Internal("invalid analytics event timestamp".into()))?
            .with_timezone(&timezone)
            .date_naive();
        let start = local_day_start(timezone, date)?;
        let end = local_day_start(
            timezone,
            date.succ_opt()
                .ok_or_else(|| AppError::Internal("analytics day boundary overflow".into()))?,
        )?;
        rebuild_daily_total(tx, &group_id, start, end).await?;
    }
    Ok(())
}

async fn school_timezone(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
) -> Result<chrono_tz::Tz, AppError> {
    let timezone: Option<String> = sqlx::query_scalar("WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM groups WHERE id=? UNION ALL SELECT parent.id,parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id=parent.id) SELECT calendar.timezone FROM ancestors JOIN school_quota_calendars calendar ON calendar.root_group_id=ancestors.id WHERE ancestors.parent_id IS NULL")
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

fn local_day_start(timezone: chrono_tz::Tz, date: chrono::NaiveDate) -> Result<i64, AppError> {
    let midnight = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::Internal("invalid school calendar day".into()))?;
    timezone
        .from_local_datetime(&midnight)
        .earliest()
        .map(|instant| instant.timestamp_millis())
        .ok_or_else(|| AppError::Internal("school timezone has no day boundary".into()))
}

async fn rebuild_daily_total(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group: &str,
    start: i64,
    end: i64,
) -> Result<(), AppError> {
    let rows = sqlx::query("SELECT e.user_id,e.activity_session_id,e.event_type,e.activity_kind,e.occurred_at,e.current_time_millis,e.current_page FROM activity_events e JOIN activity_event_ancestry a ON a.event_row_id=e.id WHERE a.group_id=? AND e.ancestry_state='finalized' AND e.occurred_at>=? AND e.occurred_at<? ORDER BY e.user_id,e.activity_session_id,e.sequence,e.id")
        .bind(group)
        .bind(start)
        .bind(end)
        .fetch_all(&mut **tx)
        .await
        .map_err(db)?;
    let mut users = HashSet::new();
    let mut sessions = HashSet::new();
    type PreviousEvent = (i64, Option<i64>, Option<i64>);
    let mut previous: HashMap<(String, String), PreviousEvent> = HashMap::new();
    let (mut watch_seconds, mut completions, mut reader_pages, mut flashcard_events) =
        (0_i64, 0_i64, 0_i64, 0_i64);
    for row in rows {
        let user: String = row.get("user_id");
        let session: String = row.get("activity_session_id");
        let event_type: String = row.get("event_type");
        let kind: String = row.get("activity_kind");
        let occurred_at: i64 = row.get("occurred_at");
        let media: Option<i64> = row.get("current_time_millis");
        let page: Option<i64> = row.get("current_page");
        users.insert(user.clone());
        sessions.insert((user.clone(), session.clone()));
        if event_type == "activity.completed" {
            completions += 1;
        }
        if kind == "flashcards" && event_type == "activity.completed" {
            flashcard_events += 1;
        }
        if let Some((previous_at, previous_media, previous_page)) =
            previous.get(&(user.clone(), session.clone()))
        {
            let wall = occurred_at - previous_at;
            if wall > 0 && wall <= 300_000 {
                if kind == "video" {
                    if let (Some(before), Some(after)) = (*previous_media, media) {
                        let delta = after - before;
                        if delta > 0 && delta <= wall.saturating_add(2_000) {
                            watch_seconds += delta.min(wall).div_euclid(1000).min(300);
                        }
                    }
                } else if kind == "reader" {
                    if let (Some(before), Some(after)) = (*previous_page, page) {
                        reader_pages += (after - before).max(0);
                    }
                }
            }
        }
        previous.insert((user, session), (occurred_at, media, page));
    }
    sqlx::query("DELETE FROM analytics_group_daily_learners WHERE group_id=? AND day_start=?")
        .bind(group)
        .bind(start)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM analytics_group_daily_sessions WHERE group_id=? AND day_start=?")
        .bind(group)
        .bind(start)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    for user in &users {
        sqlx::query("INSERT INTO analytics_group_daily_learners(group_id,day_start,user_id) VALUES(?,?,?)")
            .bind(group)
            .bind(start)
            .bind(user)
            .execute(&mut **tx)
            .await
            .map_err(db)?;
    }
    for (user, session) in &sessions {
        sqlx::query("INSERT INTO analytics_group_daily_sessions(group_id,day_start,user_id,activity_session_id) VALUES(?,?,?,?)")
            .bind(group)
            .bind(start)
            .bind(user)
            .bind(session)
            .execute(&mut **tx)
            .await
            .map_err(db)?;
    }
    sqlx::query("INSERT INTO analytics_daily_totals(group_id,day_start,active_learners,sessions,watch_seconds,completions,reader_pages,flashcard_events,updated_at) VALUES(?,?,?,?,?,?,?,?,unixepoch()) ON CONFLICT(group_id,day_start) DO UPDATE SET active_learners=excluded.active_learners,sessions=excluded.sessions,watch_seconds=excluded.watch_seconds,completions=excluded.completions,reader_pages=excluded.reader_pages,flashcard_events=excluded.flashcard_events,updated_at=excluded.updated_at")
        .bind(group)
        .bind(start)
        .bind(users.len() as i64)
        .bind(sessions.len() as i64)
        .bind(watch_seconds)
        .bind(completions)
        .bind(reader_pages)
        .bind(flashcard_events)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}

fn db(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("analytics rollup database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn migration_backfill_is_idempotent_for_existing_finalized_history() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let millis = now * 1000;
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','Learner','active','learner',0,?,?)").bind(now).bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',?),('child','root','Child','child','active',?)").bind(now).bind(now).execute(&pool).await.unwrap();
        for (sequence, media) in [(1_i64, 0_i64), (2, 30_000)] {
            let result = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,current_time_millis,duration_millis,retention_days,retained_until,ancestry_state) VALUES(?,?,?,?,?,1,'activity.progressed','video','progress-only','session','video',?,?,?,?,?,90,?,'building')")
                .bind(format!("event-{sequence}")).bind("learner").bind("child").bind("policy").bind(format!("hash-{sequence}")).bind(sequence).bind(millis + (sequence - 1) * 30_000).bind(now).bind(media).bind(3_600_000_i64).bind(millis + 90 * 86_400_000).execute(&pool).await.unwrap();
            let event_id = result.last_insert_rowid();
            for (ordinal, group) in ["root", "child"].iter().enumerate() {
                sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,?,?)").bind(event_id).bind(ordinal as i64).bind(group).execute(&pool).await.unwrap();
            }
            sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
                .bind(event_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        for (sequence, page) in [(3_i64, 1_i64), (4, 3_i64)] {
            let result = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,current_page,retention_days,retained_until,ancestry_state) VALUES(?,?,?,?,?,1,'activity.progressed','reader','progress-only','session','reader',?,?,?,?,90,?,'building')")
                .bind(format!("reader-event-{sequence}"))
                .bind("learner")
                .bind("child")
                .bind("policy")
                .bind(format!("reader-hash-{sequence}"))
                .bind(sequence)
                .bind(millis + (sequence - 3) * 30_000)
                .bind(now)
                .bind(page)
                .bind(millis + 90 * 86_400_000)
                .execute(&pool)
                .await
                .unwrap();
            let event_id = result.last_insert_rowid();
            for (ordinal, group) in ["root", "child"].iter().enumerate() {
                sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,?,?)")
                    .bind(event_id)
                    .bind(ordinal as i64)
                    .bind(group)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
                .bind(event_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        backfill_daily_totals(&pool).await.unwrap();
        backfill_daily_totals(&pool).await.unwrap();
        let rows = sqlx::query("SELECT group_id,active_learners,sessions,watch_seconds FROM analytics_daily_rollups WHERE activity_kind='video' ORDER BY group_id").fetch_all(&pool).await.unwrap();
        assert_eq!(rows.len(), 2);
        for row in rows {
            assert_eq!(
                (
                    row.get::<i64, _>("active_learners"),
                    row.get::<i64, _>("sessions"),
                    row.get::<i64, _>("watch_seconds")
                ),
                (1, 1, 30)
            );
        }
        let totals = sqlx::query("SELECT group_id,active_learners,sessions,watch_seconds,reader_pages FROM analytics_daily_totals ORDER BY group_id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(totals.len(), 2);
        for total in totals {
            assert_eq!(
                (
                    total.get::<i64, _>("active_learners"),
                    total.get::<i64, _>("sessions"),
                    total.get::<i64, _>("watch_seconds"),
                    total.get::<i64, _>("reader_pages")
                ),
                (1, 1, 30, 2)
            );
        }
    }
}
