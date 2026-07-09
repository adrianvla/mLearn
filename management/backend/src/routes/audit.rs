use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    redaction,
    state::AppState,
};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub id: String,
    pub actor: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub authorized_group_id: String,
    pub timestamp: i64,
    pub request_id: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub events: Vec<AuditEvent>,
    pub next_cursor: Option<String>,
}

#[derive(Clone)]
pub struct AuditQueryService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

impl AuditQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn list(
        &self,
        principal: &Principal,
        group_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<AuditPage, AppError> {
        self.authorization
            .require(principal, group_id, Capability::GroupView)
            .await?;
        let limit = limit.clamp(1, 100);
        let (cursor_time, cursor_id) = cursor.map(parse_cursor).transpose()?.unzip();
        let rows = sqlx::query(
            "WITH RECURSIVE subtree(id) AS (
                SELECT id FROM groups WHERE id = ? AND status != 'archived'
                UNION ALL SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id
            )
            SELECT event.id,
                   CASE WHEN event.actor_api_key_id IS NOT NULL
                        THEN 'api_key:' || event.actor_api_key_id
                        ELSE event.actor_user_id END AS actor,
                   event.action, event.target_type, event.target_id,
                   event.authorized_group_id, event.created_at, event.request_id, event.metadata_json
            FROM audit_events event JOIN subtree ON subtree.id = event.authorized_group_id
            WHERE (? IS NULL OR event.created_at < ? OR (event.created_at = ? AND event.id < ?))
            ORDER BY event.created_at DESC, event.id DESC LIMIT ?",
        )
        .bind(group_id)
        .bind(cursor_time)
        .bind(cursor_time)
        .bind(cursor_time)
        .bind(cursor_id.as_deref())
        .bind((limit + 1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        let has_more = rows.len() > limit;
        let mut events = rows
            .into_iter()
            .take(limit)
            .map(event_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if has_more {
            events
                .last()
                .map(|event| format!("{}:{}", event.timestamp, event.id))
        } else {
            None
        };
        Ok(AuditPage {
            events: std::mem::take(&mut events),
            next_cursor,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditQuery {
    group_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/audit/events", get(list_events))
        .with_state(state)
}

async fn list_events(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<AuditQuery>,
) -> Result<Json<AuditPage>, AppError> {
    let group_id = query
        .group_id
        .or_else(|| principal.active_group_id.clone())
        .ok_or_else(|| AppError::BadRequest("groupId or an active group is required".into()))?;
    Ok(Json(
        AuditQueryService::new(state.db)
            .list(
                &principal,
                &group_id,
                query.cursor.as_deref(),
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

fn event_from_row(row: sqlx::sqlite::SqliteRow) -> Result<AuditEvent, AppError> {
    let metadata = row
        .get::<Option<String>, _>("metadata_json")
        .map(|raw| {
            serde_json::from_str::<Value>(&raw)
                .map(redact_json)
                .map_err(|error| AppError::Internal(format!("invalid audit metadata: {error}")))
        })
        .transpose()?;
    Ok(AuditEvent {
        id: row.get("id"),
        actor: row.get("actor"),
        action: row.get("action"),
        target_type: row.get("target_type"),
        target_id: row.get("target_id"),
        authorized_group_id: row.get("authorized_group_id"),
        timestamp: row.get("created_at"),
        request_id: row.get("request_id"),
        metadata,
    })
}

fn redact_json(value: Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    let value = if redaction::is_sensitive_key(&key) {
                        Value::String("[REDACTED]".into())
                    } else {
                        redact_json(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(redact_json).collect()),
        Value::String(value) => Value::String(redaction::redact_value("metadata", &value)),
        value => value,
    }
}

fn parse_cursor(value: &str) -> Result<(i64, String), AppError> {
    let (timestamp, id) = value
        .split_once(':')
        .ok_or_else(|| AppError::BadRequest("invalid audit cursor".into()))?;
    let timestamp = timestamp
        .parse()
        .map_err(|_| AppError::BadRequest("invalid audit cursor".into()))?;
    if id.is_empty() {
        return Err(AppError::BadRequest("invalid audit cursor".into()));
    }
    Ok((timestamp, id.to_string()))
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use crate::{
        api_keys::ApiKeyService,
        auth::hash_token,
        authorization::Capability,
        groups::tests::GroupFixture,
        identity::IdentityService,
    };

    #[tokio::test]
    async fn child_query_excludes_parent_and_sibling_while_parent_includes_descendants() {
        let fixture = GroupFixture::german_tree().await;
        for (id, group_id) in [
            ("parent-event", &fixture.german),
            ("child-event", &fixture.german_a),
            ("sibling-event", &fixture.german_b),
            ("descendant-event", &fixture.project_1),
        ] {
            sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, 'test.event', 'group', ?, NULL, 10, ?, NULL)")
                .bind(id).bind(&fixture.german_a_teacher.user_id).bind(group_id).bind(group_id)
                .execute(&fixture.pool).await.unwrap();
        }

        let service = super::AuditQueryService::new(fixture.pool.clone());
        let child = service
            .list(&fixture.german_a_teacher, &fixture.german_a, None, 50)
            .await
            .unwrap();
        let child_ids: Vec<_> = child.events.iter().map(|event| event.id.as_str()).collect();
        assert!(child_ids.contains(&"child-event"));
        assert!(child_ids.contains(&"descendant-event"));
        assert!(!child_ids.contains(&"parent-event"));
        assert!(!child_ids.contains(&"sibling-event"));

        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('parent-auditor', ?, ?, 'active', 1)")
            .bind(&fixture.german).bind(&fixture.other_teacher.user_id).execute(&fixture.pool).await.unwrap();
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('parent-auditor', ?)")
            .bind(Capability::GroupView.as_str()).execute(&fixture.pool).await.unwrap();
        let parent = service
            .list(&fixture.other_teacher, &fixture.german, None, 50)
            .await
            .unwrap();
        assert_eq!(parent.events.len(), 4);
    }

    #[tokio::test]
    async fn audit_rows_cannot_be_updated_or_deleted() {
        let fixture = GroupFixture::german_tree().await;
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES ('immutable', ?, 'test.event', 'group', ?, NULL, 10, ?, NULL)")
            .bind(&fixture.german_a_teacher.user_id).bind(&fixture.german_a).bind(&fixture.german_a)
            .execute(&fixture.pool).await.unwrap();

        assert!(
            sqlx::query("UPDATE audit_events SET action = 'changed' WHERE id = 'immutable'")
                .execute(&fixture.pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query("DELETE FROM audit_events WHERE id = 'immutable'")
                .execute(&fixture.pool)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn group_mutations_are_visible_in_their_authorized_scope() {
        let fixture = GroupFixture::german_tree().await;
        let created = fixture
            .groups
            .create_group(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "Project 2",
                "project-2",
            )
            .await
            .unwrap();

        let page = super::AuditQueryService::new(fixture.pool)
            .list(&fixture.german_a_teacher, &fixture.german_a, None, 50)
            .await
            .unwrap();
        assert!(page.events.iter().any(|event| {
            event.action == "group.created"
                && event.target_id.as_deref() == Some(created.id.as_str())
                && event.authorized_group_id == created.id
        }));
    }

    #[tokio::test]
    async fn root_bootstrap_events_are_visible_in_the_root_scope() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let identity = IdentityService::new(
            pool.clone(),
            Some(hash_token("bootstrap")),
            b"audit-test-secret".to_vec(),
        );
        let (_, session) = identity
            .bootstrap_root_with_session(
                "bootstrap",
                "root@school.test",
                "Correct Horse Battery Staple",
            )
            .await
            .unwrap();
        let principal = identity
            .principal_from_access_token(&session.access_token)
            .await
            .unwrap();
        let group_id = principal.active_group_id.clone().unwrap();

        let page = super::AuditQueryService::new(pool)
            .list(&principal, &group_id, None, 50)
            .await
            .unwrap();
        assert!(page
            .events
            .iter()
            .any(|event| event.action == "group.root_created"));
        assert!(page
            .events
            .iter()
            .any(|event| event.action == "identity.bootstrap_root"));
    }

    #[tokio::test]
    async fn active_ancestor_query_includes_archived_descendant_history() {
        let fixture = GroupFixture::german_tree().await;
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('root-auditor', ?, ?, 'active', 1)")
            .bind(&fixture.german).bind(&fixture.other_teacher.user_id).execute(&fixture.pool).await.unwrap();
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('root-auditor', ?)")
            .bind(Capability::GroupView.as_str()).execute(&fixture.pool).await.unwrap();
        fixture
            .groups
            .archive_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();

        let page = super::AuditQueryService::new(fixture.pool)
            .list(&fixture.other_teacher, &fixture.german, None, 50)
            .await
            .unwrap();

        assert!(page.events.iter().any(|event| {
            event.action == "group.archived"
                && event.authorized_group_id == fixture.german_a
        }));
    }

    #[tokio::test]
    async fn audit_query_exposes_explicit_service_key_actor() {
        let fixture = GroupFixture::german_tree().await;
        let created = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView],
                None,
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, actor_api_key_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES ('service-event', NULL, ?, 'analytics.read', 'group', ?, NULL, 10, ?, NULL)")
            .bind(&created.id).bind(&fixture.german_a).bind(&fixture.german_a)
            .execute(&fixture.pool).await.unwrap();

        let page = super::AuditQueryService::new(fixture.pool)
            .list(&fixture.german_a_teacher, &fixture.german_a, None, 50)
            .await
            .unwrap();
        let event = page
            .events
            .iter()
            .find(|event| event.id == "service-event")
            .unwrap();
        assert_eq!(event.actor.as_deref(), Some(format!("api_key:{}", created.id).as_str()));
    }
}
