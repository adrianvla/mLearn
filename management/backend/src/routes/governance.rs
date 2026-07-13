use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    llm::quota::{QuotaScopeKind, QuotaService, UsageBucket},
    state::AppState,
};

const EXPIRING_KEY_SECONDS: i64 = 7 * 24 * 60 * 60;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupQuery {
    group_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationStateRequest {
    read: Option<bool>,
    dismissed: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleNotification {
    pub fingerprint: String,
    pub kind: String,
    pub severity: String,
    pub group_id: String,
    pub message: String,
    pub href: String,
    pub created_at: i64,
    pub read: bool,
    pub dismissed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationsResponse {
    items: Vec<ConsoleNotification>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernanceSummary {
    policies: Vec<GovernancePolicy>,
    usage: Vec<GovernanceUsage>,
    activity: Vec<GovernanceActivity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernancePolicy {
    group_id: String,
    group_name: String,
    active_policy_count: i64,
    policy_scope: String,
    has_unpublished_draft: bool,
    last_published_at: Option<i64>,
    href: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernanceUsage {
    label: String,
    detail: String,
    href: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernanceActivity {
    action: String,
    timestamp: i64,
    href: String,
}

#[derive(Clone)]
struct DerivedNotification {
    fingerprint: String,
    kind: &'static str,
    severity: &'static str,
    group_id: String,
    message: String,
    href: &'static str,
    created_at: i64,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/governance/summary", get(summary))
        .route("/api/notifications", get(list_notifications))
        .route(
            "/api/notifications/{fingerprint}",
            patch(update_notification),
        )
        .with_state(state)
}

async fn summary(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<GroupQuery>,
) -> Result<Json<GovernanceSummary>, AppError> {
    let group_id = scoped_group(&state, &principal, query.group_id.as_deref()).await?;
    let authorization = AuthorizationService::new(state.db.clone());
    let policies = if authorization
        .require(&principal, &group_id, Capability::PoliciesView)
        .await
        .is_ok()
    {
        governance_policies(&state, &group_id).await?
    } else {
        Vec::new()
    };
    let usage = if authorization
        .require(&principal, &group_id, Capability::AnalyticsView)
        .await
        .is_ok()
    {
        governance_usage(&canonical_usage_buckets(&state, &principal, &group_id).await?)
    } else {
        Vec::new()
    };
    let activity = recent_activity(&state, &group_id).await?;
    Ok(Json(GovernanceSummary {
        policies,
        usage,
        activity,
    }))
}

async fn list_notifications(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<GroupQuery>,
) -> Result<Json<NotificationsResponse>, AppError> {
    let group_id = scoped_group(&state, &principal, query.group_id.as_deref()).await?;
    Ok(Json(NotificationsResponse {
        items: notifications_for(&state, &principal, &group_id).await?,
    }))
}

async fn update_notification(
    State(state): State<AppState>,
    principal: Principal,
    Path(fingerprint): Path<String>,
    Query(query): Query<GroupQuery>,
    Json(request): Json<NotificationStateRequest>,
) -> Result<StatusCode, AppError> {
    if request.read != Some(true) && request.dismissed != Some(true) {
        return Err(AppError::BadRequest(
            "notification updates must mark read or dismissed".into(),
        ));
    }
    let group_id = scoped_group(&state, &principal, query.group_id.as_deref()).await?;
    let available = notifications_for(&state, &principal, &group_id)
        .await?
        .into_iter()
        .any(|notification| notification.fingerprint == fingerprint);
    if !available {
        return Err(AppError::NotFound(
            "notification condition not found".into(),
        ));
    }
    let timestamp = now();
    sqlx::query(
        "INSERT INTO console_notification_state(user_id,fingerprint,read_at,dismissed_at,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id,fingerprint) DO UPDATE SET
           read_at=CASE WHEN excluded.read_at IS NOT NULL THEN excluded.read_at ELSE console_notification_state.read_at END,
           dismissed_at=CASE WHEN excluded.dismissed_at IS NOT NULL THEN excluded.dismissed_at ELSE console_notification_state.dismissed_at END,
           updated_at=excluded.updated_at",
    )
    .bind(&principal.user_id)
    .bind(&fingerprint)
    .bind((request.read == Some(true)).then_some(timestamp))
    .bind((request.dismissed == Some(true)).then_some(timestamp))
    .bind(timestamp)
    .execute(&state.db)
    .await
    .map_err(database_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn scoped_group(
    state: &AppState,
    principal: &Principal,
    query_group: Option<&str>,
) -> Result<String, AppError> {
    let group_id = query_group
        .or(principal.active_group_id.as_deref())
        .ok_or_else(|| AppError::BadRequest("groupId or an active group is required".into()))?;
    AuthorizationService::new(state.db.clone())
        .require(principal, group_id, Capability::GroupView)
        .await?;
    Ok(group_id.into())
}

async fn notifications_for(
    state: &AppState,
    principal: &Principal,
    group_id: &str,
) -> Result<Vec<ConsoleNotification>, AppError> {
    let authorization = AuthorizationService::new(state.db.clone());
    let mut derived = Vec::new();
    if authorization
        .require(principal, group_id, Capability::PoliciesView)
        .await
        .is_ok()
    {
        derived.extend(unpublished_drafts(state, group_id).await?);
    }
    if authorization
        .require(principal, group_id, Capability::AnalyticsView)
        .await
        .is_ok()
    {
        derived.extend(low_quota_conditions(
            &canonical_usage_buckets(state, principal, group_id).await?,
            group_id,
        ));
    }
    if authorization
        .require(principal, group_id, Capability::LlmConfigure)
        .await
        .is_ok()
    {
        derived.extend(unavailable_providers(state, group_id).await?);
    }
    if authorization
        .require(principal, group_id, Capability::ApiKeysManage)
        .await
        .is_ok()
    {
        derived.extend(expiring_keys(state, group_id).await?);
    }
    let states = notification_states(state, &principal.user_id).await?;
    let mut notifications = derived
        .into_iter()
        .map(|notification| {
            let state = states.get(&notification.fingerprint);
            ConsoleNotification {
                fingerprint: notification.fingerprint,
                kind: notification.kind.into(),
                severity: notification.severity.into(),
                group_id: notification.group_id,
                message: notification.message,
                href: notification.href.into(),
                created_at: notification.created_at,
                read: state.is_some_and(|value| value.0),
                dismissed: state.is_some_and(|value| value.1),
            }
        })
        .collect::<Vec<_>>();
    notifications.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.fingerprint.cmp(&right.fingerprint))
    });
    Ok(notifications)
}

async fn notification_states(
    state: &AppState,
    user_id: &str,
) -> Result<HashMap<String, (bool, bool)>, AppError> {
    let rows = sqlx::query(
        "SELECT fingerprint,read_at IS NOT NULL AS read,dismissed_at IS NOT NULL AS dismissed
         FROM console_notification_state WHERE user_id=?",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get("fingerprint"),
                (row.get("read"), row.get("dismissed")),
            )
        })
        .collect())
}

async fn unpublished_drafts(
    state: &AppState,
    group_id: &str,
) -> Result<Vec<DerivedNotification>, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         )
         SELECT policy.id,policy.group_id,policy.name,draft.document_hash,draft.updated_at
         FROM scope JOIN policies policy ON policy.group_id=scope.id
         JOIN policy_drafts draft ON draft.policy_id=policy.id
         LEFT JOIN policy_active_versions active ON active.policy_id=policy.id
         LEFT JOIN policy_versions version ON version.id=active.policy_version_id
         WHERE policy.enabled=1 AND (version.document_hash IS NULL OR version.document_hash!=draft.document_hash)
         ORDER BY draft.updated_at DESC,policy.id",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let policy_id: String = row.get("id");
            let hash: String = row.get("document_hash");
            DerivedNotification {
                fingerprint: format!("unpublished-draft:{policy_id}:{hash}"),
                kind: "unpublishedDraft",
                severity: "info",
                group_id: row.get("group_id"),
                message: format!(
                    "Policy draft '{}' has not been published",
                    row.get::<String, _>("name")
                ),
                href: "/policies",
                created_at: row.get("updated_at"),
            }
        })
        .collect())
}

async fn canonical_usage_buckets(
    state: &AppState,
    principal: &Principal,
    group_id: &str,
) -> Result<Vec<UsageBucket>, AppError> {
    Ok(QuotaService::new(state.db.clone())
        .usage_summary(principal, group_id, None, 100)
        .await?
        .buckets)
}

fn governance_usage(buckets: &[UsageBucket]) -> Vec<GovernanceUsage> {
    buckets
        .iter()
        .filter_map(|bucket| {
            bucket.limit.map(|limit| GovernanceUsage {
                label: bucket.metric.as_str().into(),
                detail: format!(
                    "{} used, {} reserved, {} remaining of {}",
                    bucket.used,
                    bucket.reserved,
                    bucket.remaining.unwrap_or_default(),
                    limit
                ),
                href: "/llm-gateway".into(),
            })
        })
        .collect()
}

fn low_quota_conditions_from_buckets(
    buckets: &[UsageBucket],
    group_id: &str,
) -> Vec<DerivedNotification> {
    buckets
        .iter()
        .filter(|bucket| bucket.warning && bucket.remaining.is_some())
        .map(|bucket| DerivedNotification {
            fingerprint: format!(
                "low-quota:{}:{}:{}:{}:{}",
                quota_scope_name(bucket.scope_kind),
                bucket.scope_id,
                bucket.metric.as_str(),
                bucket.period_starts_at,
                bucket.period_ends_at
            ),
            kind: "lowQuota",
            severity: "warning",
            group_id: group_id.into(),
            message: format!(
                "{} quota has {} remaining",
                bucket.metric.as_str(),
                bucket.remaining.expect("filtered above")
            ),
            href: "/llm-gateway",
            created_at: bucket.period_starts_at,
        })
        .collect()
}

fn low_quota_conditions(buckets: &[UsageBucket], group_id: &str) -> Vec<DerivedNotification> {
    low_quota_conditions_from_buckets(buckets, group_id)
}

fn quota_scope_name(scope: QuotaScopeKind) -> &'static str {
    match scope {
        QuotaScopeKind::User => "user",
        QuotaScopeKind::Group => "group",
    }
}

async fn unavailable_providers(
    state: &AppState,
    group_id: &str,
) -> Result<Vec<DerivedNotification>, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         )
         SELECT provider.id,provider.group_id,provider.name,provider.status,provider.updated_at
         FROM scope JOIN llm_providers provider ON provider.group_id=scope.id
         WHERE provider.status!='active' ORDER BY provider.updated_at DESC,provider.id",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    let mut notifications = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let status: String = row.get("status");
            DerivedNotification {
                fingerprint: format!("provider-unavailable:{id}:{status}"),
                kind: "providerUnavailable",
                severity: "warning",
                group_id: row.get("group_id"),
                message: format!("Provider '{}' is {}", row.get::<String, _>("name"), status),
                href: "/llm-gateway",
                created_at: row.get("updated_at"),
            }
        })
        .collect::<Vec<_>>();
    let failed_checks = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         ), latest AS (
            SELECT provider_id,MAX(created_at) created_at FROM provider_health_checks GROUP BY provider_id
         )
         SELECT provider.id,provider.group_id,provider.name,check_row.id check_id,check_row.outcome,check_row.created_at
         FROM scope JOIN llm_providers provider ON provider.group_id=scope.id
         JOIN latest ON latest.provider_id=provider.id
         JOIN provider_health_checks check_row ON check_row.provider_id=latest.provider_id AND check_row.created_at=latest.created_at
         WHERE check_row.outcome!='healthy' ORDER BY check_row.created_at DESC,check_row.id DESC",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    notifications.extend(failed_checks.into_iter().map(|row| {
        let check_id: String = row.get("check_id");
        let outcome: String = row.get("outcome");
        DerivedNotification {
            fingerprint: format!("provider-health-failed:{check_id}"),
            kind: "providerUnavailable",
            severity: "warning",
            group_id: row.get("group_id"),
            message: format!(
                "Provider '{}' recorded a failed health check ({outcome})",
                row.get::<String, _>("name")
            ),
            href: "/llm-gateway",
            created_at: row.get("created_at"),
        }
    }));
    Ok(notifications)
}

async fn expiring_keys(
    state: &AppState,
    group_id: &str,
) -> Result<Vec<DerivedNotification>, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         )
         SELECT key.id,key.group_id,key.name,key.expires_at
         FROM scope JOIN api_keys key ON key.group_id=scope.id
         WHERE key.status='active' AND key.expires_at>unixepoch() AND key.expires_at<=unixepoch()+?
         ORDER BY key.expires_at,key.id",
    )
    .bind(group_id)
    .bind(EXPIRING_KEY_SECONDS)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let expires_at: i64 = row.get("expires_at");
            DerivedNotification {
                fingerprint: format!("expiring-key:{id}:{expires_at}"),
                kind: "expiringKey",
                severity: "warning",
                group_id: row.get("group_id"),
                message: format!(
                    "API key '{}' expires soon",
                    row.get::<Option<String>, _>("name")
                        .unwrap_or_else(|| id.clone())
                ),
                href: "/llm-gateway",
                created_at: expires_at,
            }
        })
        .collect())
}

async fn governance_policies(
    state: &AppState,
    group_id: &str,
) -> Result<Vec<GovernancePolicy>, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         )
         SELECT scope.id group_id,scope_group.name group_name,
           COALESCE(SUM(CASE WHEN policy.enabled=1 AND active.policy_version_id IS NOT NULL THEN 1 ELSE 0 END),0) active_policy_count,
           MAX(CASE WHEN draft.document_hash IS NOT NULL AND (version.document_hash IS NULL OR version.document_hash!=draft.document_hash) THEN 1 ELSE 0 END) has_unpublished_draft,
           MAX(version.created_at) last_published_at,
           EXISTS(SELECT 1 FROM policies local_policy JOIN policy_active_versions local_active ON local_active.policy_id=local_policy.id WHERE local_policy.group_id=scope.id AND local_policy.enabled=1 AND local_active.policy_version_id IS NOT NULL) has_local
         FROM scope JOIN groups scope_group ON scope_group.id=scope.id
         LEFT JOIN policies policy ON policy.group_id=scope.id
         LEFT JOIN policy_active_versions active ON active.policy_id=policy.id
         LEFT JOIN policy_versions version ON version.id=active.policy_version_id
         LEFT JOIN policy_drafts draft ON draft.policy_id=policy.id
         GROUP BY scope.id,scope_group.name ORDER BY scope_group.name,scope.id",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| GovernancePolicy {
            group_id: row.get("group_id"),
            group_name: row.get("group_name"),
            active_policy_count: row.get("active_policy_count"),
            policy_scope: if row.get::<i64, _>("has_local") != 0 {
                "Local".into()
            } else {
                "Inherited".into()
            },
            has_unpublished_draft: row.get::<i64, _>("has_unpublished_draft") != 0,
            last_published_at: row.get("last_published_at"),
            href: "/policies".into(),
        })
        .collect())
}

async fn recent_activity(
    state: &AppState,
    group_id: &str,
) -> Result<Vec<GovernanceActivity>, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE scope(id) AS (
            SELECT id FROM groups WHERE id=? AND status!='archived'
            UNION ALL SELECT child.id FROM groups child JOIN scope parent ON child.parent_id=parent.id WHERE child.status!='archived'
         )
         SELECT event.action,event.created_at FROM audit_events event JOIN scope ON scope.id=event.authorized_group_id
         ORDER BY event.created_at DESC,event.id DESC LIMIT 20",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| GovernanceActivity {
            action: row.get("action"),
            timestamp: row.get("created_at"),
            href: "/activity".into(),
        })
        .collect())
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("governance database error: {error}"))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
        Router,
    };
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::{
        auth::hash_token, authorization::Capability, config::Config, groups::tests::GroupFixture,
        state::AppState,
    };

    #[tokio::test]
    async fn low_quota_notification_has_a_stable_fingerprint_and_user_specific_dismissal() {
        let fixture = GroupFixture::german_tree().await;
        grant(&fixture.pool, "membership-a", Capability::AnalyticsView).await;
        insert_low_quota(&fixture.pool, &fixture.german_a_teacher, &fixture.german_a).await;
        let (app, state) = app(&fixture).await;

        let first = notifications(&app, &state, &fixture.german_a_teacher, &fixture.german_a).await;
        let fingerprint = first[0]["fingerprint"].as_str().unwrap().to_string();
        let repeated =
            notifications(&app, &state, &fixture.german_a_teacher, &fixture.german_a).await;
        assert_eq!(repeated[0]["fingerprint"], fingerprint);

        let authorization =
            access_token(&state, &fixture.german_a_teacher, &fixture.german_a).await;
        let response = app
            .clone()
            .oneshot(request(
                Request::patch(format!(
                    "/api/notifications/{fingerprint}?groupId={}",
                    fixture.german_a
                ))
                .header(header::AUTHORIZATION, format!("Bearer {authorization}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"dismissed": true}).to_string()))
                .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let dismissed =
            notifications(&app, &state, &fixture.german_a_teacher, &fixture.german_a).await;
        assert_eq!(dismissed[0]["dismissed"], true);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM console_notification_state WHERE fingerprint=?"
            )
            .bind(&fingerprint)
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            1,
        );
        let second = second_teacher(&fixture).await;
        let other = notifications(&app, &state, &second, &fixture.german_a).await;
        assert_eq!(other[0]["dismissed"], false);
    }

    #[tokio::test]
    async fn notifications_do_not_disclose_sibling_group_conditions() {
        let fixture = GroupFixture::german_tree().await;
        grant(&fixture.pool, "membership-a", Capability::PoliciesView).await;
        sqlx::query("INSERT INTO policies(id,group_id,name,description,enabled,priority,created_by_user_id,created_at,updated_at,revision) VALUES('sibling-policy',?,'Sibling policy','',1,0,?,1,1,1)")
            .bind(&fixture.german_b).bind(&fixture.german_a_teacher.user_id).execute(&fixture.pool).await.unwrap();
        sqlx::query("INSERT INTO policy_drafts(policy_id,group_id,document_json,document_hash,author_user_id,updated_at) VALUES('sibling-policy',?,'{}','draft-hash',?,2)")
            .bind(&fixture.german_b).bind(&fixture.german_a_teacher.user_id).execute(&fixture.pool).await.unwrap();
        let (app, state) = app(&fixture).await;

        let listed =
            notifications(&app, &state, &fixture.german_a_teacher, &fixture.german_a).await;
        assert!(listed.is_empty());
    }

    #[test]
    fn low_quota_conditions_keep_canonical_warning_remaining_and_period() {
        let buckets = vec![crate::llm::quota::UsageBucket {
            scope_kind: crate::llm::quota::QuotaScopeKind::Group,
            scope_id: "visible-group".into(),
            metric: crate::policy::model::QuotaMetric::Requests,
            used: 71,
            reserved: 9,
            limit: Some(100),
            remaining: Some(20),
            warning: true,
            inherited: true,
            source_visible: false,
            constraint_state: "exact".into(),
            period_starts_at: 100,
            period_ends_at: 200,
        }];

        let conditions = super::low_quota_conditions_from_buckets(&buckets, "requested-group");

        assert_eq!(conditions.len(), 1);
        assert_eq!(conditions[0].group_id, "requested-group");
        assert_eq!(
            conditions[0].fingerprint,
            "low-quota:group:visible-group:requests:100:200"
        );
        assert!(conditions[0].message.contains("20 remaining"));
    }

    async fn grant(pool: &sqlx::SqlitePool, membership: &str, capability: Capability) {
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,?)")
            .bind(membership)
            .bind(capability.as_str())
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_low_quota(
        pool: &sqlx::SqlitePool,
        principal: &crate::identity::Principal,
        group_id: &str,
    ) {
        let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('calendar-admin','german',?,'active',1)")
            .bind(&principal.user_id).execute(pool).await.unwrap();
        grant(pool, "calendar-admin", Capability::LlmConfigure).await;
        crate::llm::quota::QuotaService::new(pool.clone())
            .configure_calendar(
                principal,
                "german",
                "UTC",
                timestamp - 86_400,
                timestamp + 86_400,
            )
            .await
            .unwrap();
        let (calendar_version, period_starts_at, period_ends_at): (i64, i64, i64) = sqlx::query_as("SELECT calendar.version,instance.period_starts_at,instance.period_ends_at FROM school_quota_calendars calendar JOIN school_quota_period_instances instance ON instance.root_group_id=calendar.root_group_id AND instance.calendar_version=calendar.version WHERE calendar.root_group_id='german' AND instance.quota_period='daily' AND instance.period_starts_at<=? AND instance.period_ends_at>?")
            .bind(timestamp).bind(timestamp).fetch_one(pool).await.unwrap();
        sqlx::query("INSERT INTO quota_definitions(id,owner_group_id,subject_kind,subject_id,metric,period,limit_value,status,created_by_user_id,created_at,updated_at) VALUES('low-quota',?,'group',?,'requests','daily',10,'active','teacher-a',?,?)")
            .bind(group_id).bind(group_id).bind(timestamp).bind(timestamp).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO quota_definition_periods(definition_id,root_group_id,calendar_version,quota_period,period_starts_at,period_ends_at,limit_value,created_at) VALUES('low-quota','german',?,'daily',?,?,10,?)")
            .bind(calendar_version).bind(period_starts_at).bind(period_ends_at).bind(timestamp).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO llm_providers(id,group_id,name,provider_kind,base_url,status,created_by_user_id,created_at,updated_at) VALUES('provider',?,'Provider','ollama','http://provider.test','active','teacher-a',1,1)")
            .bind(group_id).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO llm_models(id,group_id,provider_id,model_key,upstream_model,status,created_by_user_id,created_at,updated_at) VALUES('model',?,'provider','default','model','active','teacher-a',1,1)")
            .bind(group_id).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO provider_price_versions(id,group_id,provider_id,model_id,currency,unit,input_cost_micros,output_cost_micros,idempotency_key,created_by_user_id,created_at) VALUES('price',?,'provider','model','CHF','perMillionTokens',1,1,'price','teacher-a',1)")
            .bind(group_id).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO quota_reservations(id,request_id,learner_user_id,direct_group_id,provider_id,model_id,price_version_id,payload_hash,status,expires_at,accounting_at,created_at) VALUES('reservation','request','teacher-a',?,'provider','model','price',zeroblob(32),'building',4102444800,?,?)")
            .bind(group_id).bind(timestamp).bind(timestamp).execute(pool).await.unwrap();
        for (kind, id, depth) in [
            ("user", "teacher-a", 0),
            ("group", group_id, 0),
            ("group", "german", 1),
        ] {
            sqlx::query("INSERT INTO quota_reservation_scopes(reservation_id,scope_kind,scope_id,depth) VALUES('reservation',?,?,?)")
                .bind(kind).bind(id).bind(depth).execute(pool).await.unwrap();
        }
        sqlx::query("INSERT INTO quota_reservation_metrics(reservation_id,metric,reserved_value,required) VALUES('reservation','requests',1,1)")
            .execute(pool).await.unwrap();
        for (kind, id) in [("user", "teacher-a"), ("group", "german")] {
            sqlx::query("INSERT INTO quota_reservation_periods(reservation_id,scope_kind,scope_id,metric,quota_period,period_starts_at,period_ends_at,limit_value,definition_id,calendar_version,is_primary) VALUES('reservation',?,?, 'requests','event',?,?,NULL,NULL,NULL,1)")
                .bind(kind).bind(id).bind(timestamp).bind(timestamp + 1).execute(pool).await.unwrap();
        }
        sqlx::query("INSERT INTO quota_reservation_periods(reservation_id,scope_kind,scope_id,metric,quota_period,period_starts_at,period_ends_at,limit_value,definition_id,calendar_version,is_primary) VALUES('reservation','group',?,'requests','daily',?,?,10,'low-quota',?,1)")
            .bind(group_id).bind(period_starts_at).bind(period_ends_at).bind(calendar_version).execute(pool).await.unwrap();
        sqlx::query(
            "UPDATE quota_reservations SET status='open',finalized=1 WHERE id='reservation'",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO usage_ledger(id,reservation_id,scope_kind,scope_id,metric,value,period_starts_at,period_ends_at,quota_period,provider_id,model_id,price_version_id,learner_user_id,direct_group_id,created_at) VALUES('usage','reservation','group',?,'requests',10,?,?,'daily','provider','model','price','teacher-a',?,?)")
            .bind(group_id).bind(period_starts_at).bind(period_ends_at).bind(group_id).bind(timestamp).execute(pool).await.unwrap();
    }

    async fn second_teacher(fixture: &GroupFixture) -> crate::identity::Principal {
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('teacher-b','teacher-b@test.invalid','teacher-b@test.invalid','Teacher B','active','teacher',0,1,1)")
            .execute(&fixture.pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('membership-b',?,'teacher-b','active',1)")
            .bind(&fixture.german_a).execute(&fixture.pool).await.unwrap();
        for capability in [Capability::GroupView, Capability::AnalyticsView] {
            grant(&fixture.pool, "membership-b", capability).await;
        }
        crate::identity::Principal {
            user_id: "teacher-b".into(),
            service_key_id: None,
            session_id: "session-b".into(),
            device_id: "device-b".into(),
            active_group_id: None,
            identity_type: crate::identity::IdentityType::Teacher,
            is_root: false,
        }
    }

    async fn app(fixture: &GroupFixture) -> (Router, AppState) {
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("route-secret"));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, fixture.pool.clone());
        (
            Router::new()
                .merge(super::router(state.clone()))
                .with_state(state.clone()),
            state,
        )
    }

    async fn notifications(
        app: &Router,
        state: &AppState,
        principal: &crate::identity::Principal,
        group_id: &str,
    ) -> Vec<Value> {
        let authorization = access_token(state, principal, group_id).await;
        let response = app
            .clone()
            .oneshot(request(
                Request::get(format!("/api/notifications?groupId={group_id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {authorization}"))
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        serde_json::from_slice::<Value>(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .to_vec()
    }

    async fn access_token(
        state: &AppState,
        principal: &crate::identity::Principal,
        group_id: &str,
    ) -> String {
        state
            .identity
            .issue_session(&principal.user_id, None, Some(group_id))
            .await
            .unwrap()
            .access_token
    }

    fn request(request: Request<Body>) -> Request<Body> {
        request
    }
}
