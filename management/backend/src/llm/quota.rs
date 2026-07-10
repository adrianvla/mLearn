use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
};

use chrono::{Datelike, Days, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::{IdentityType, Principal},
    policy::compiler::compile_in_transaction,
};

pub use crate::policy::model::{QuotaMetric, QuotaPeriod};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const DEFAULT_RESERVATION_TTL_SECONDS: i64 = 300;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuotaDefinition {
    pub id: String,
    pub owner_group_id: String,
    pub subject_kind: QuotaScopeKind,
    pub subject_id: String,
    pub metric: QuotaMetric,
    pub period: QuotaPeriod,
    pub limit: i64,
    pub status: String,
    pub inherited: bool,
    pub source_visible: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum QuotaScopeKind {
    User,
    Group,
}

impl QuotaScopeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Group => "group",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchoolQuotaCalendar {
    pub root_group_id: String,
    pub timezone: String,
    pub term_starts_at: i64,
    pub term_ends_at: i64,
    pub version: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReserveQuotaRequest {
    pub request_id: String,
    pub active_group_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub price_version_id: String,
    pub amounts: BTreeMap<String, i64>,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReservedScope {
    pub scope_kind: QuotaScopeKind,
    pub scope_id: String,
    pub depth: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReservation {
    pub id: String,
    pub request_id: String,
    pub learner_user_id: String,
    pub direct_group_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub price_version_id: String,
    pub expires_at: i64,
    pub accounting_at: i64,
    pub reserved_by_scope: Vec<ReservedScope>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconcileQuotaRequest {
    pub reservation_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub price_version_id: String,
    pub actual: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub scope_kind: QuotaScopeKind,
    pub scope_id: String,
    pub metric: QuotaMetric,
    pub used: i64,
    pub reserved: i64,
    pub limit: Option<i64>,
    pub remaining: Option<i64>,
    pub warning: bool,
    pub inherited: bool,
    pub source_visible: bool,
    pub constraint_state: String,
    pub period_starts_at: i64,
    pub period_ends_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdown {
    pub learner_user_id: String,
    pub direct_group_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub metric: QuotaMetric,
    pub value: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub buckets: Vec<UsageBucket>,
    pub breakdowns: Vec<UsageBreakdown>,
    pub next_cursor: Option<String>,
}

#[derive(Clone)]
pub struct QuotaService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

struct ApplicableDefinition {
    definition: QuotaDefinition,
    interval: (i64, i64),
    calendar_root_group_id: String,
    calendar_version: i64,
}

struct GovernedRequirement {
    source_group_id: String,
    metric: QuotaMetric,
    period: QuotaPeriod,
    limit: i64,
}

impl QuotaService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn configure_calendar(
        &self,
        principal: &Principal,
        root_group_id: &str,
        timezone: &str,
        term_starts_at: i64,
        term_ends_at: i64,
    ) -> Result<SchoolQuotaCalendar, AppError> {
        require_human(principal)?;
        Tz::from_str(timezone).map_err(|_| AppError::BadRequest("invalid IANA timezone".into()))?;
        validate_nonnegative("termStartsAt", term_starts_at)?;
        validate_nonnegative("termEndsAt", term_ends_at)?;
        if term_ends_at <= term_starts_at {
            return Err(AppError::BadRequest(
                "term must be a non-empty half-open interval".into(),
            ));
        }
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        require_root_group(&mut tx, root_group_id).await?;
        self.authorization
            .require_in_transaction(&mut tx, principal, root_group_id, Capability::LlmConfigure)
            .await?;
        let timestamp = now();
        let existing = sqlx::query("SELECT timezone, term_starts_at, term_ends_at, version, pending_timezone, pending_term_starts_at, pending_term_ends_at, pending_effective_at, pending_version FROM school_quota_calendars WHERE root_group_id = ?")
            .bind(root_group_id).fetch_optional(&mut *tx).await.map_err(database_error)?;
        let calendar = if let Some(row) = existing {
            let pending_is_active = row
                .get::<Option<i64>, _>("pending_effective_at")
                .is_some_and(|effective_at| effective_at <= timestamp);
            let current = SchoolQuotaCalendar {
                root_group_id: root_group_id.to_string(),
                timezone: if pending_is_active {
                    row.get::<Option<String>, _>("pending_timezone")
                        .expect("complete pending calendar")
                } else {
                    row.get("timezone")
                },
                term_starts_at: if pending_is_active {
                    row.get::<Option<i64>, _>("pending_term_starts_at")
                        .expect("complete pending calendar")
                } else {
                    row.get("term_starts_at")
                },
                term_ends_at: if pending_is_active {
                    row.get::<Option<i64>, _>("pending_term_ends_at")
                        .expect("complete pending calendar")
                } else {
                    row.get("term_ends_at")
                },
                version: if pending_is_active {
                    row.get::<Option<i64>, _>("pending_version")
                        .expect("complete pending calendar")
                } else {
                    row.get("version")
                },
            };
            if pending_is_active {
                sqlx::query("UPDATE school_quota_calendars SET timezone = ?, term_starts_at = ?, term_ends_at = ?, version = ?, pending_timezone = NULL, pending_term_starts_at = NULL, pending_term_ends_at = NULL, pending_effective_at = NULL, pending_version = NULL WHERE root_group_id = ?")
                    .bind(&current.timezone).bind(current.term_starts_at).bind(current.term_ends_at).bind(current.version).bind(root_group_id).execute(&mut *tx).await.map_err(database_error)?;
            }
            if current.timezone == timezone
                && current.term_starts_at == term_starts_at
                && current.term_ends_at == term_ends_at
            {
                current
            } else if row.get::<Option<String>, _>("pending_timezone").as_deref() == Some(timezone)
                && row.get::<Option<i64>, _>("pending_term_starts_at") == Some(term_starts_at)
                && row.get::<Option<i64>, _>("pending_term_ends_at") == Some(term_ends_at)
            {
                current
            } else if term_starts_at > timestamp {
                let next_version = current
                    .version
                    .max(row.get::<Option<i64>, _>("pending_version").unwrap_or(0))
                    .checked_add(1)
                    .ok_or_else(|| AppError::Conflict("quota calendar version overflow".into()))?;
                let pending = SchoolQuotaCalendar {
                    root_group_id: root_group_id.to_string(),
                    timezone: timezone.to_string(),
                    term_starts_at,
                    term_ends_at,
                    version: next_version,
                };
                create_calendar_version(&mut tx, principal, &pending, "pending").await?;
                sqlx::query("UPDATE school_quota_calendars SET pending_timezone = ?, pending_term_starts_at = ?, pending_term_ends_at = ?, pending_effective_at = ?, pending_version = ?, updated_by_user_id = ?, updated_at = ? WHERE root_group_id = ?")
                    .bind(timezone).bind(term_starts_at).bind(term_ends_at).bind(term_starts_at).bind(next_version).bind(&principal.user_id).bind(timestamp).bind(root_group_id).execute(&mut *tx).await.map_err(database_error)?;
                current
            } else {
                let accounted: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id) SELECT EXISTS(SELECT 1 FROM quota_reservations reservation JOIN descendants d ON d.id = reservation.direct_group_id WHERE reservation.accounting_at >= ? AND reservation.accounting_at < ?)")
                    .bind(root_group_id).bind(current.term_starts_at).bind(current.term_ends_at).fetch_one(&mut *tx).await.map_err(database_error)?;
                if accounted == 1 {
                    return Err(AppError::Conflict("active quota calendar cannot change after accounting has begun; schedule a future term instead".into()));
                }
                let next_version = current
                    .version
                    .checked_add(1)
                    .ok_or_else(|| AppError::Conflict("quota calendar version overflow".into()))?;
                let replacement = SchoolQuotaCalendar {
                    root_group_id: root_group_id.to_string(),
                    timezone: timezone.to_string(),
                    term_starts_at,
                    term_ends_at,
                    version: next_version,
                };
                create_calendar_version(&mut tx, principal, &replacement, "active").await?;
                sqlx::query("UPDATE school_quota_calendars SET timezone = ?, term_starts_at = ?, term_ends_at = ?, version = ?, pending_timezone = NULL, pending_term_starts_at = NULL, pending_term_ends_at = NULL, pending_effective_at = NULL, pending_version = NULL, updated_by_user_id = ?, updated_at = ? WHERE root_group_id = ?")
                    .bind(timezone).bind(term_starts_at).bind(term_ends_at).bind(next_version).bind(&principal.user_id).bind(timestamp).bind(root_group_id).execute(&mut *tx).await.map_err(database_error)?;
                SchoolQuotaCalendar {
                    root_group_id: root_group_id.to_string(),
                    timezone: timezone.to_string(),
                    term_starts_at,
                    term_ends_at,
                    version: next_version,
                }
            }
        } else {
            let initial = SchoolQuotaCalendar {
                root_group_id: root_group_id.to_string(),
                timezone: timezone.to_string(),
                term_starts_at,
                term_ends_at,
                version: 1,
            };
            create_calendar_version(&mut tx, principal, &initial, "active").await?;
            sqlx::query("INSERT INTO school_quota_calendars (root_group_id, timezone, term_starts_at, term_ends_at, version, updated_by_user_id, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
                .bind(root_group_id).bind(timezone).bind(term_starts_at).bind(term_ends_at).bind(&principal.user_id).bind(timestamp).execute(&mut *tx).await.map_err(database_error)?;
            SchoolQuotaCalendar {
                root_group_id: root_group_id.to_string(),
                timezone: timezone.to_string(),
                term_starts_at,
                term_ends_at,
                version: 1,
            }
        };
        audit(
            &mut tx,
            principal,
            "llm.quota_calendar.updated",
            root_group_id,
            root_group_id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(calendar)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_definition(
        &self,
        principal: &Principal,
        owner_group_id: &str,
        subject_kind: QuotaScopeKind,
        subject_id: &str,
        metric: QuotaMetric,
        period: QuotaPeriod,
        limit: i64,
        idempotency_key: &str,
    ) -> Result<QuotaDefinition, AppError> {
        require_human(principal)?;
        validate_nonnegative("limit", limit)?;
        validate_idempotency_key(idempotency_key)?;
        let payload_hash = fingerprint(&[
            owner_group_id,
            subject_kind.as_str(),
            subject_id,
            metric.as_str(),
            period.as_str(),
            &limit.to_string(),
        ]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, owner_group_id, Capability::LlmConfigure)
            .await?;
        require_active_group(&mut tx, owner_group_id).await?;
        match subject_kind {
            QuotaScopeKind::Group if subject_id != owner_group_id => {
                return Err(AppError::BadRequest(
                    "group quota must be owned by its subject group".into(),
                ))
            }
            QuotaScopeKind::User => {
                require_direct_member(&mut tx, subject_id, owner_group_id).await?
            }
            QuotaScopeKind::Group => {}
        }
        if let Some(target_id) = replay_mutation(
            &mut tx,
            principal,
            owner_group_id,
            "quota.upsert",
            idempotency_key,
            &payload_hash,
        )
        .await?
        {
            tx.commit().await.map_err(database_error)?;
            return self.definition(&target_id).await;
        }
        enforce_tightening(
            &mut tx,
            owner_group_id,
            subject_kind,
            subject_id,
            metric,
            period,
            limit,
        )
        .await?;
        let existing = sqlx::query("SELECT id, limit_value FROM quota_definitions WHERE owner_group_id = ? AND subject_kind = ? AND subject_id = ? AND metric = ? AND period = ? AND status = 'active'")
            .bind(owner_group_id).bind(subject_kind.as_str()).bind(subject_id).bind(metric.as_str()).bind(period.as_str()).fetch_optional(&mut *tx).await.map_err(database_error)?;
        let timestamp = now();
        let id = if let Some(existing) = existing {
            let existing_id: String = existing.get("id");
            if existing.get::<i64, _>("limit_value") == limit {
                existing_id
            } else {
                let revision_id = Uuid::now_v7().to_string();
                sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?)")
                    .bind(&revision_id).bind(owner_group_id).bind(subject_kind.as_str()).bind(subject_id).bind(metric.as_str()).bind(period.as_str()).bind(limit).bind(&principal.user_id).bind(timestamp).bind(timestamp).execute(&mut *tx).await.map_err(map_write_error)?;
                sqlx::query("UPDATE quota_definitions SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'active'")
                    .bind(timestamp)
                    .bind(&existing_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_write_error)?;
                sqlx::query("UPDATE quota_definitions SET status = 'active' WHERE id = ? AND status = 'staged'")
                    .bind(&revision_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(map_write_error)?;
                revision_id
            }
        } else {
            let revision_id = Uuid::now_v7().to_string();
            sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&revision_id).bind(owner_group_id).bind(subject_kind.as_str()).bind(subject_id).bind(metric.as_str()).bind(period.as_str()).bind(limit).bind(&principal.user_id).bind(timestamp).bind(timestamp).execute(&mut *tx).await.map_err(map_write_error)?;
            revision_id
        };
        record_mutation(
            &mut tx,
            principal,
            owner_group_id,
            "quota.upsert",
            idempotency_key,
            &payload_hash,
            &id,
        )
        .await?;
        audit(&mut tx, principal, "llm.quota.updated", &id, owner_group_id).await?;
        tx.commit().await.map_err(database_error)?;
        self.definition(&id).await
    }

    pub async fn list_definitions(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<QuotaDefinition>, AppError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        if !has_capability_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?
            && !has_capability_in_transaction(
                &mut tx,
                principal,
                group_id,
                Capability::PoliciesView,
            )
            .await?
        {
            return Err(AppError::Forbidden(
                "llm.configure or policies.view is required for quota definitions".into(),
            ));
        }
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT q.* FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id WHERE q.status = 'active' AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.owner_group_id = ?)) ORDER BY a.depth DESC, q.metric, q.period, q.id")
            .bind(group_id).bind(group_id).fetch_all(&mut *tx).await.map_err(database_error)?;
        let mut definitions = Vec::new();
        for row in rows {
            let mut definition = definition_from_row(row)?;
            definition.inherited = definition.owner_group_id != group_id;
            let source_visible = !definition.inherited
                || has_capability_in_transaction(
                    &mut tx,
                    principal,
                    &definition.owner_group_id,
                    Capability::LlmConfigure,
                )
                .await?
                || has_capability_in_transaction(
                    &mut tx,
                    principal,
                    &definition.owner_group_id,
                    Capability::PoliciesView,
                )
                .await?;
            if !source_visible {
                definition.id = hidden_inherited_id(group_id, &definition.id);
                definition.owner_group_id = group_id.to_string();
                definition.subject_id = group_id.to_string();
                definition.source_visible = false;
            }
            definitions.push(definition);
        }
        tx.commit().await.map_err(database_error)?;
        Ok(definitions)
    }

    pub async fn delete_definition(
        &self,
        principal: &Principal,
        definition_id: &str,
        idempotency_key: &str,
    ) -> Result<(), AppError> {
        require_human(principal)?;
        validate_idempotency_key(idempotency_key)?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let owner_group_id: String =
            sqlx::query_scalar("SELECT owner_group_id FROM quota_definitions WHERE id = ?")
                .bind(definition_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::BadRequest("quota definition not found".into()))?;
        self.authorization
            .require_in_transaction(
                &mut tx,
                principal,
                &owner_group_id,
                Capability::LlmConfigure,
            )
            .await?;
        let payload_hash = fingerprint(&[definition_id]);
        if replay_mutation(
            &mut tx,
            principal,
            &owner_group_id,
            "quota.delete",
            idempotency_key,
            &payload_hash,
        )
        .await?
        .is_none()
        {
            sqlx::query(
                "UPDATE quota_definitions SET status = 'deleted', updated_at = ? WHERE id = ?",
            )
            .bind(now())
            .bind(definition_id)
            .execute(&mut *tx)
            .await
            .map_err(map_write_error)?;
            record_mutation(
                &mut tx,
                principal,
                &owner_group_id,
                "quota.delete",
                idempotency_key,
                &payload_hash,
                definition_id,
            )
            .await?;
            audit(
                &mut tx,
                principal,
                "llm.quota.deleted",
                definition_id,
                &owner_group_id,
            )
            .await?;
        }
        tx.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn reserve(
        &self,
        principal: &Principal,
        request: ReserveQuotaRequest,
    ) -> Result<QuotaReservation, AppError> {
        self.reserve_at(principal, request, now()).await
    }

    async fn reserve_at(
        &self,
        principal: &Principal,
        request: ReserveQuotaRequest,
        timestamp: i64,
    ) -> Result<QuotaReservation, AppError> {
        if principal.service_key_id.is_some() || principal.identity_type != IdentityType::Learner {
            return Err(AppError::Forbidden(
                "learner session required for LLM quota reservation".into(),
            ));
        }
        if principal.active_group_id.as_deref() != Some(request.active_group_id.as_str()) {
            return Err(AppError::Forbidden(
                "request active group does not match the authenticated session".into(),
            ));
        }
        validate_request_id(&request.request_id)?;
        let amounts = parse_reservation_amounts(&request.amounts)?;
        let expires_at = request
            .expires_at
            .unwrap_or(timestamp + DEFAULT_RESERVATION_TTL_SECONDS);
        if expires_at <= timestamp || expires_at > timestamp + 3_600 {
            return Err(AppError::BadRequest(
                "reservation expiry must be within one hour".into(),
            ));
        }
        let payload_hash = fingerprint_request(&request, &amounts);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        release_expired_in_transaction(&mut tx, timestamp).await?;
        require_learner_context(&mut tx, principal, &request.active_group_id).await?;
        require_price_route(&mut tx, &request).await?;
        let compiled = compile_in_transaction(&mut tx, &request.active_group_id).await?;
        if !compiled.document.llm.enabled
            || compiled.document.llm.quotas.iter().all(|rule| !rule.hard)
        {
            return Err(AppError::Forbidden(
                "LLM access requires a published governed quota policy".into(),
            ));
        }
        let calendar = load_calendar(&mut tx, &request.active_group_id, timestamp).await?;
        let definitions = load_applicable_definitions(
            &mut tx,
            &request.active_group_id,
            &principal.user_id,
            timestamp,
            &calendar,
        )
        .await?;
        let requirements = load_governed_requirements(&mut tx, &request.active_group_id).await?;
        validate_policy_definitions(&requirements, &definitions)?;
        validate_required_amounts(&requirements, &definitions, &amounts)?;
        if let Some(row) = sqlx::query("SELECT id, payload_hash, status FROM quota_reservations WHERE learner_user_id = ? AND request_id = ?")
            .bind(&principal.user_id).bind(&request.request_id).fetch_optional(&mut *tx).await.map_err(database_error)? {
            let saved: Vec<u8> = row.get("payload_hash");
            if saved != payload_hash { return Err(AppError::Conflict("request id was already used with a different quota payload or scope".into())); }
            let status: String = row.get("status");
            if status != "open" { return Err(AppError::Conflict("quota request was already closed".into())); }
            let id: String = row.get("id");
            let result = load_reservation(&mut tx, &id).await?;
            tx.commit().await.map_err(database_error)?;
            return Ok(result);
        }
        for applicable in &definitions {
            let requested = amounts
                .get(&applicable.definition.metric)
                .copied()
                .unwrap_or(0);
            let (start, end) = applicable.interval;
            let used = sum_usage(&mut tx, applicable, start, end).await?;
            let open = sum_open_reservations(&mut tx, applicable, start, end, timestamp).await?;
            let projected = checked_add(checked_add(used, open)?, requested)?;
            if projected > applicable.definition.limit {
                return Err(AppError::Conflict(format!(
                    "quota exceeded for {} {}",
                    applicable.definition.metric.as_str(),
                    applicable.definition.period.as_str()
                )));
            }
        }
        let id = Uuid::now_v7().to_string();
        sqlx::query("INSERT INTO quota_reservations (id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, status, expires_at, accounting_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?)")
            .bind(&id).bind(&request.request_id).bind(&principal.user_id).bind(&request.active_group_id).bind(&request.provider_id).bind(&request.model_id).bind(&request.price_version_id).bind(&payload_hash).bind(expires_at).bind(timestamp).bind(timestamp).execute(&mut *tx).await.map_err(map_write_error)?;
        let required_metrics = required_metrics(&requirements, &definitions);
        for (metric, value) in &amounts {
            sqlx::query("INSERT INTO quota_reservation_metrics (reservation_id, metric, reserved_value, required) VALUES (?, ?, ?, ?)").bind(&id).bind(metric.as_str()).bind(value).bind(i64::from(required_metrics.contains(metric) || *metric == QuotaMetric::Requests)).execute(&mut *tx).await.map_err(database_error)?;
        }
        let scopes = ancestry_scopes(&mut tx, &request.active_group_id, &principal.user_id).await?;
        for scope in &scopes {
            sqlx::query("INSERT INTO quota_reservation_scopes (reservation_id, scope_kind, scope_id, depth) VALUES (?, ?, ?, ?)").bind(&id).bind(scope.scope_kind.as_str()).bind(&scope.scope_id).bind(scope.depth).execute(&mut *tx).await.map_err(database_error)?;
        }
        snapshot_accounting_periods(&mut tx, &id, &scopes, &amounts, &definitions, timestamp)
            .await?;
        sqlx::query("UPDATE quota_reservations SET status = 'open', finalized = 1 WHERE id = ? AND status = 'building'")
            .bind(&id).execute(&mut *tx).await.map_err(database_error)?;
        audit(
            &mut tx,
            principal,
            "llm.quota.reserved",
            &id,
            &request.active_group_id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(QuotaReservation {
            id,
            request_id: request.request_id,
            learner_user_id: principal.user_id.clone(),
            direct_group_id: request.active_group_id,
            provider_id: request.provider_id,
            model_id: request.model_id,
            price_version_id: request.price_version_id,
            expires_at,
            accounting_at: timestamp,
            reserved_by_scope: scopes,
        })
    }

    pub async fn reconcile(&self, request: ReconcileQuotaRequest) -> Result<(), AppError> {
        let actual = parse_reservation_amounts(&request.actual)?;
        let reconciliation_hash = fingerprint_reconciliation(&request, &actual);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let row = sqlx::query("SELECT status, provider_id, model_id, price_version_id, learner_user_id, direct_group_id, accounting_at, reconcile_hash FROM quota_reservations WHERE id = ?")
            .bind(&request.reservation_id).fetch_optional(&mut *tx).await.map_err(database_error)?.ok_or_else(|| AppError::BadRequest("quota reservation not found".into()))?;
        for (field, expected, actual_value) in [
            (
                "provider",
                row.get::<String, _>("provider_id"),
                request.provider_id.clone(),
            ),
            (
                "model",
                row.get::<String, _>("model_id"),
                request.model_id.clone(),
            ),
            (
                "price version",
                row.get::<String, _>("price_version_id"),
                request.price_version_id.clone(),
            ),
        ] {
            if expected != actual_value {
                return Err(AppError::Conflict(format!(
                    "{field} does not match the immutable reservation"
                )));
            }
        }
        let status: String = row.get("status");
        if status == "reconciled" {
            if row.get::<Option<Vec<u8>>, _>("reconcile_hash").as_deref()
                != Some(reconciliation_hash.as_slice())
            {
                return Err(AppError::Conflict(
                    "reservation was already reconciled with different measured usage".into(),
                ));
            }
            tx.commit().await.map_err(database_error)?;
            return Ok(());
        }
        if status != "open" && status != "expired" {
            return Err(AppError::Conflict(
                "reservation has not been finalized for reconciliation".into(),
            ));
        }
        let metric_rows = sqlx::query(
            "SELECT metric, required FROM quota_reservation_metrics WHERE reservation_id = ?",
        )
        .bind(&request.reservation_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(database_error)?;
        let reserved_metrics = metric_rows
            .iter()
            .map(|metric| metric_from_str(metric.get("metric")))
            .collect::<Result<BTreeSet<_>, _>>()?;
        if actual.keys().copied().collect::<BTreeSet<_>>() != reserved_metrics {
            return Err(AppError::BadRequest(
                "reconciliation must provide exactly every snapshotted metric".into(),
            ));
        }
        let timestamp = now();
        let periods = sqlx::query("SELECT scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at FROM quota_reservation_periods WHERE reservation_id = ? ORDER BY scope_kind, scope_id, metric, quota_period, period_starts_at")
            .bind(&request.reservation_id).fetch_all(&mut *tx).await.map_err(database_error)?;
        for period in periods {
            let metric_name: String = period.get("metric");
            let metric = metric_from_str(&metric_name)?;
            let value = actual.get(&metric).ok_or_else(|| {
                AppError::BadRequest("reconciliation omitted a snapshotted metric".into())
            })?;
            sqlx::query("INSERT INTO usage_ledger (id, reservation_id, scope_kind, scope_id, metric, value, period_starts_at, period_ends_at, quota_period, provider_id, model_id, price_version_id, learner_user_id, direct_group_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(Uuid::now_v7().to_string()).bind(&request.reservation_id).bind(period.get::<String,_>("scope_kind")).bind(period.get::<String,_>("scope_id")).bind(&metric_name).bind(value).bind(period.get::<i64,_>("period_starts_at")).bind(period.get::<i64,_>("period_ends_at")).bind(period.get::<String,_>("quota_period")).bind(&request.provider_id).bind(&request.model_id).bind(&request.price_version_id).bind(row.get::<String,_>("learner_user_id")).bind(row.get::<String,_>("direct_group_id")).bind(row.get::<i64,_>("accounting_at")).execute(&mut *tx).await.map_err(map_write_error)?;
        }
        sqlx::query("UPDATE quota_reservations SET status = 'reconciled', reconciled_at = ?, reconcile_hash = ? WHERE id = ? AND status IN ('open', 'expired')").bind(timestamp).bind(&reconciliation_hash).bind(&request.reservation_id).execute(&mut *tx).await.map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn release_expired(&self) -> Result<u64, AppError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let released = release_expired_in_transaction(&mut tx, now()).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(released)
    }

    pub async fn usage_summary(
        &self,
        principal: &Principal,
        group_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<UsageSummary, AppError> {
        if principal.identity_type == IdentityType::Learner {
            if principal.service_key_id.is_some()
                || principal.active_group_id.as_deref() != Some(group_id)
            {
                return Err(AppError::Forbidden(
                    "learner can only view their active group usage".into(),
                ));
            }
            let mut tx = self
                .pool
                .begin_with("BEGIN IMMEDIATE")
                .await
                .map_err(database_error)?;
            release_expired_in_transaction(&mut tx, now()).await?;
            require_learner_context(&mut tx, principal, group_id).await?;
            let result = summary_in_transaction(
                &mut tx,
                principal,
                group_id,
                Some(&principal.user_id),
                cursor,
                limit,
            )
            .await?;
            tx.commit().await.map_err(database_error)?;
            return Ok(result);
        }
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::AnalyticsView)
            .await?;
        release_expired_in_transaction(&mut tx, now()).await?;
        let result =
            summary_in_transaction(&mut tx, principal, group_id, None, cursor, limit).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }

    async fn definition(&self, id: &str) -> Result<QuotaDefinition, AppError> {
        let row = sqlx::query("SELECT * FROM quota_definitions WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("quota definition not found".into()))?;
        definition_from_row(row)
    }
}

fn metric_from_str(value: &str) -> Result<QuotaMetric, AppError> {
    match value {
        "requests" => Ok(QuotaMetric::Requests),
        "inputTokens" => Ok(QuotaMetric::InputTokens),
        "outputTokens" => Ok(QuotaMetric::OutputTokens),
        "totalTokens" => Ok(QuotaMetric::TotalTokens),
        "costMicros" => Ok(QuotaMetric::CostMicros),
        _ => Err(AppError::Internal("invalid stored quota metric".into())),
    }
}
fn period_from_str(value: &str) -> Result<QuotaPeriod, AppError> {
    match value {
        "daily" => Ok(QuotaPeriod::Daily),
        "weekly" => Ok(QuotaPeriod::Weekly),
        "monthly" => Ok(QuotaPeriod::Monthly),
        "term" => Ok(QuotaPeriod::Term),
        _ => Err(AppError::Internal("invalid stored quota period".into())),
    }
}
fn scope_from_str(value: &str) -> Result<QuotaScopeKind, AppError> {
    match value {
        "user" => Ok(QuotaScopeKind::User),
        "group" => Ok(QuotaScopeKind::Group),
        _ => Err(AppError::Internal("invalid stored quota scope".into())),
    }
}

fn definition_from_row(row: sqlx::sqlite::SqliteRow) -> Result<QuotaDefinition, AppError> {
    Ok(QuotaDefinition {
        id: row.get("id"),
        owner_group_id: row.get("owner_group_id"),
        subject_kind: scope_from_str(row.get("subject_kind"))?,
        subject_id: row.get("subject_id"),
        metric: metric_from_str(row.get("metric"))?,
        period: period_from_str(row.get("period"))?,
        limit: row.get("limit_value"),
        status: row.get("status"),
        inherited: false,
        source_visible: true,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn require_root_group(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), AppError> {
    let ok: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ? AND parent_id IS NULL AND status = 'active')").bind(id).fetch_one(&mut **tx).await.map_err(database_error)?;
    if ok == 1 {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "active school root group required".into(),
        ))
    }
}
async fn require_active_group(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), AppError> {
    let ok: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ? AND status = 'active')",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(database_error)?;
    if ok == 1 {
        Ok(())
    } else {
        Err(AppError::BadRequest("active group required".into()))
    }
}
async fn require_direct_member(
    tx: &mut Transaction<'_, Sqlite>,
    user: &str,
    group: &str,
) -> Result<(), AppError> {
    let ok: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users u JOIN group_memberships m ON m.user_id = u.id WHERE u.id = ? AND u.status = 'active' AND m.group_id = ? AND m.status = 'active')").bind(user).bind(group).fetch_one(&mut **tx).await.map_err(database_error)?;
    if ok == 1 {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "quota user must be an active direct group member".into(),
        ))
    }
}

async fn require_learner_context(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group: &str,
) -> Result<(), AppError> {
    let ok: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users u JOIN group_memberships m ON m.user_id = u.id JOIN groups g ON g.id = m.group_id WHERE u.id = ? AND u.identity_type = 'learner' AND u.status = 'active' AND m.group_id = ? AND m.status = 'active' AND g.status = 'active')")
        .bind(&principal.user_id).bind(group).fetch_one(&mut **tx).await.map_err(database_error)?;
    if ok == 1 {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "learner membership is inactive or revoked".into(),
        ))
    }
}

async fn create_calendar_version(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    calendar: &SchoolQuotaCalendar,
    lifecycle: &str,
) -> Result<(), AppError> {
    if !matches!(lifecycle, "active" | "pending") {
        return Err(AppError::Internal(
            "calendar version lifecycle must be active or pending".into(),
        ));
    }
    sqlx::query("INSERT INTO school_quota_calendar_versions (root_group_id, version, timezone, term_starts_at, term_ends_at, lifecycle, finalized, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, 'building', 0, ?, ?)")
        .bind(&calendar.root_group_id)
        .bind(calendar.version)
        .bind(&calendar.timezone)
        .bind(calendar.term_starts_at)
        .bind(calendar.term_ends_at)
        .bind(&principal.user_id)
        .bind(now())
        .execute(&mut **tx)
        .await
        .map_err(map_write_error)?;

    let mut instance_count = 0usize;
    for period in [
        QuotaPeriod::Daily,
        QuotaPeriod::Weekly,
        QuotaPeriod::Monthly,
    ] {
        let mut cursor = calendar.term_starts_at;
        while cursor < calendar.term_ends_at {
            let (starts_at, ends_at) = interval_for(period, cursor, calendar)?;
            if ends_at <= cursor {
                return Err(AppError::Internal(
                    "quota period generation did not advance".into(),
                ));
            }
            instance_count += 1;
            if instance_count > 10_000 {
                return Err(AppError::BadRequest(
                    "school term is too large to materialize quota periods".into(),
                ));
            }
            sqlx::query("INSERT INTO school_quota_period_instances (root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at) VALUES (?, ?, ?, ?, ?)")
                .bind(&calendar.root_group_id)
                .bind(calendar.version)
                .bind(period.as_str())
                .bind(starts_at)
                .bind(ends_at)
                .execute(&mut **tx)
                .await
                .map_err(map_write_error)?;
            cursor = ends_at;
        }
    }
    sqlx::query("INSERT INTO school_quota_period_instances (root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at) VALUES (?, ?, 'term', ?, ?)")
        .bind(&calendar.root_group_id)
        .bind(calendar.version)
        .bind(calendar.term_starts_at)
        .bind(calendar.term_ends_at)
        .execute(&mut **tx)
        .await
        .map_err(map_write_error)?;
    sqlx::query("UPDATE school_quota_calendar_versions SET lifecycle = ?, finalized = 1 WHERE root_group_id = ? AND version = ? AND lifecycle = 'building' AND finalized = 0")
        .bind(lifecycle)
        .bind(&calendar.root_group_id)
        .bind(calendar.version)
        .execute(&mut **tx)
        .await
        .map_err(map_write_error)?;
    Ok(())
}

async fn has_capability_in_transaction(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group: &str,
    capability: Capability,
) -> Result<bool, AppError> {
    let authorized: i64 = sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? UNION ALL SELECT parent.id, parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id = parent.id) SELECT EXISTS(SELECT 1 FROM ancestors JOIN group_memberships membership ON membership.group_id = ancestors.id JOIN membership_capabilities capability ON capability.membership_id = membership.id WHERE ? IS NULL AND membership.user_id = ? AND membership.status = 'active' AND capability.capability = ? UNION ALL SELECT 1 FROM ancestors JOIN api_keys key ON key.group_id = ancestors.id JOIN api_key_capabilities capability ON capability.api_key_id = key.id WHERE key.id = ? AND key.status = 'active' AND (key.expires_at IS NULL OR key.expires_at > unixepoch()) AND capability.capability = ?)")
        .bind(group).bind(&principal.service_key_id).bind(&principal.user_id).bind(capability.as_str()).bind(&principal.service_key_id).bind(capability.as_str()).fetch_one(&mut **tx).await.map_err(database_error)?;
    Ok(authorized == 1)
}

async fn require_price_route(
    tx: &mut Transaction<'_, Sqlite>,
    request: &ReserveQuotaRequest,
) -> Result<(), AppError> {
    let ok: i64 = sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT EXISTS(SELECT 1 FROM provider_price_versions price JOIN llm_providers provider ON provider.id = price.provider_id JOIN llm_models model ON model.id = ? AND model.provider_id = provider.id AND model.group_id = provider.group_id JOIN ancestors a ON a.id = provider.group_id WHERE price.id = ? AND price.provider_id = ? AND (price.model_id IS NULL OR price.model_id = model.id) AND provider.id = ? AND provider.status = 'active' AND model.status = 'active')")
        .bind(&request.active_group_id)
        .bind(&request.model_id).bind(&request.price_version_id).bind(&request.provider_id).bind(&request.provider_id).fetch_one(&mut **tx).await.map_err(database_error)?;
    if ok == 1 {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "provider, model, and immutable price version do not match active group".into(),
        ))
    }
}

async fn load_calendar(
    tx: &mut Transaction<'_, Sqlite>,
    group: &str,
    timestamp: i64,
) -> Result<SchoolQuotaCalendar, AppError> {
    let row = sqlx::query("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT c.* FROM school_quota_calendars c JOIN ancestors a ON a.id = c.root_group_id WHERE a.parent_id IS NULL")
        .bind(group).fetch_optional(&mut **tx).await.map_err(database_error)?.ok_or_else(|| AppError::Forbidden("school quota calendar is not configured".into()))?;
    let result = SchoolQuotaCalendar {
        root_group_id: row.get("root_group_id"),
        timezone: if row
            .get::<Option<i64>, _>("pending_effective_at")
            .is_some_and(|value| value <= timestamp)
        {
            row.get::<Option<String>, _>("pending_timezone")
                .ok_or_else(|| AppError::Internal("incomplete pending school calendar".into()))?
        } else {
            row.get("timezone")
        },
        term_starts_at: if row
            .get::<Option<i64>, _>("pending_effective_at")
            .is_some_and(|value| value <= timestamp)
        {
            row.get::<Option<i64>, _>("pending_term_starts_at")
                .ok_or_else(|| AppError::Internal("incomplete pending school calendar".into()))?
        } else {
            row.get("term_starts_at")
        },
        term_ends_at: if row
            .get::<Option<i64>, _>("pending_effective_at")
            .is_some_and(|value| value <= timestamp)
        {
            row.get::<Option<i64>, _>("pending_term_ends_at")
                .ok_or_else(|| AppError::Internal("incomplete pending school calendar".into()))?
        } else {
            row.get("term_ends_at")
        },
        version: if row
            .get::<Option<i64>, _>("pending_effective_at")
            .is_some_and(|value| value <= timestamp)
        {
            row.get::<Option<i64>, _>("pending_version")
                .ok_or_else(|| AppError::Internal("incomplete pending school calendar".into()))?
        } else {
            row.get("version")
        },
    };
    Tz::from_str(&result.timezone)
        .map_err(|_| AppError::Internal("stored school timezone is invalid".into()))?;
    Ok(result)
}

async fn load_applicable_definitions(
    tx: &mut Transaction<'_, Sqlite>,
    group: &str,
    learner: &str,
    timestamp: i64,
    calendar: &SchoolQuotaCalendar,
) -> Result<Vec<ApplicableDefinition>, AppError> {
    let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT q.* FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id WHERE q.status = 'active' AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.subject_id = ?)) ORDER BY a.depth DESC, q.metric, q.period, q.id")
        .bind(group).bind(learner).fetch_all(&mut **tx).await.map_err(database_error)?;
    let mut definitions = Vec::new();
    for row in rows {
        let definition = definition_from_row(row)?;
        definitions.push(ApplicableDefinition {
            interval: interval_for(definition.period, timestamp, calendar)?,
            definition,
            calendar_root_group_id: calendar.root_group_id.clone(),
            calendar_version: calendar.version,
        });
    }
    Ok(definitions)
}

async fn load_governed_requirements(
    tx: &mut Transaction<'_, Sqlite>,
    group: &str,
) -> Result<Vec<GovernedRequirement>, AppError> {
    let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT a.id AS group_id, version.document_json FROM ancestors a JOIN active_policies active ON active.group_id = a.id JOIN policy_versions version ON version.id = active.policy_version_id ORDER BY a.depth DESC")
        .bind(group).fetch_all(&mut **tx).await.map_err(database_error)?;
    let mut requirements = Vec::new();
    for row in rows {
        let source_group_id: String = row.get("group_id");
        let document: serde_json::Value =
            serde_json::from_str(row.get("document_json")).map_err(|error| {
                AppError::Internal(format!("invalid stored policy version: {error}"))
            })?;
        let Some(quotas) = document
            .pointer("/llm/quotas")
            .and_then(|value| value.as_array())
        else {
            continue;
        };
        for quota in quotas {
            if !quota
                .get("hard")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
            {
                continue;
            }
            let metric = metric_from_str(
                quota
                    .get("metric")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| {
                        AppError::Internal("stored hard quota is missing metric".into())
                    })?,
            )?;
            let period = period_from_str(
                quota
                    .get("period")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| {
                        AppError::Internal("stored hard quota is missing period".into())
                    })?,
            )?;
            let limit = quota
                .get("limit")
                .and_then(|value| value.as_i64())
                .ok_or_else(|| AppError::Internal("stored hard quota has invalid limit".into()))?;
            validate_nonnegative("stored hard quota limit", limit)?;
            requirements.push(GovernedRequirement {
                source_group_id: source_group_id.clone(),
                metric,
                period,
                limit,
            });
        }
    }
    Ok(requirements)
}

fn validate_policy_definitions(
    rules: &[GovernedRequirement],
    definitions: &[ApplicableDefinition],
) -> Result<(), AppError> {
    for rule in rules {
        let found = definitions.iter().any(|item| {
            item.definition.owner_group_id == rule.source_group_id
                && item.definition.subject_kind == QuotaScopeKind::Group
                && item.definition.metric == rule.metric
                && item.definition.period == rule.period
                && item.definition.limit <= rule.limit
        });
        if !found {
            return Err(AppError::Forbidden(format!(
                "governed policy quota {} {} has no matching enforceable definition",
                rule.metric.as_str(),
                rule.period.as_str()
            )));
        }
    }
    Ok(())
}

fn required_metrics(
    requirements: &[GovernedRequirement],
    definitions: &[ApplicableDefinition],
) -> BTreeSet<QuotaMetric> {
    requirements
        .iter()
        .map(|requirement| requirement.metric)
        .chain(definitions.iter().map(|item| item.definition.metric))
        .collect()
}

fn validate_required_amounts(
    requirements: &[GovernedRequirement],
    definitions: &[ApplicableDefinition],
    amounts: &BTreeMap<QuotaMetric, i64>,
) -> Result<(), AppError> {
    for metric in required_metrics(requirements, definitions) {
        if !amounts.contains_key(&metric) {
            return Err(AppError::BadRequest(format!(
                "reservation must include governed metric {}",
                metric.as_str()
            )));
        }
    }
    Ok(())
}

async fn snapshot_accounting_periods(
    tx: &mut Transaction<'_, Sqlite>,
    reservation_id: &str,
    scopes: &[ReservedScope],
    amounts: &BTreeMap<QuotaMetric, i64>,
    definitions: &[ApplicableDefinition],
    accounting_at: i64,
) -> Result<(), AppError> {
    let event_end = checked_add(accounting_at, 1)?;
    for scope in scopes {
        for metric in amounts.keys() {
            let matching = definitions
                .iter()
                .filter(|item| {
                    item.definition.subject_kind == scope.scope_kind
                        && item.definition.subject_id == scope.scope_id
                        && item.definition.metric == *metric
                })
                .collect::<Vec<_>>();
            if matching.is_empty() {
                sqlx::query("INSERT INTO quota_reservation_periods (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at, limit_value, definition_id, is_primary) VALUES (?, ?, ?, ?, 'event', ?, ?, NULL, NULL, 1)")
                    .bind(reservation_id).bind(scope.scope_kind.as_str()).bind(&scope.scope_id).bind(metric.as_str()).bind(accounting_at).bind(event_end).execute(&mut **tx).await.map_err(database_error)?;
            } else {
                for (index, item) in matching.into_iter().enumerate() {
                    let contract = sqlx::query("SELECT root_group_id, quota_period, limit_value FROM quota_definition_periods WHERE definition_id = ? AND calendar_version = ? AND period_starts_at = ? AND period_ends_at = ?")
                        .bind(&item.definition.id)
                        .bind(item.calendar_version)
                        .bind(item.interval.0)
                        .bind(item.interval.1)
                        .fetch_optional(&mut **tx)
                        .await
                        .map_err(database_error)?;
                    if let Some(contract) = contract {
                        if contract.get::<String, _>("root_group_id") != item.calendar_root_group_id
                            || contract.get::<String, _>("quota_period")
                                != item.definition.period.as_str()
                            || contract.get::<i64, _>("limit_value") != item.definition.limit
                        {
                            return Err(AppError::Conflict(
                                "quota definition period contract does not match its immutable revision".into(),
                            ));
                        }
                    } else {
                        sqlx::query("INSERT INTO quota_definition_periods (definition_id, root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at, limit_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                            .bind(&item.definition.id).bind(&item.calendar_root_group_id).bind(item.calendar_version).bind(item.definition.period.as_str()).bind(item.interval.0).bind(item.interval.1).bind(item.definition.limit).bind(accounting_at).execute(&mut **tx).await.map_err(map_write_error)?;
                    }
                    sqlx::query("INSERT INTO quota_reservation_periods (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at, limit_value, definition_id, calendar_version, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                        .bind(reservation_id).bind(scope.scope_kind.as_str()).bind(&scope.scope_id).bind(metric.as_str()).bind(item.definition.period.as_str()).bind(item.interval.0).bind(item.interval.1).bind(item.definition.limit).bind(&item.definition.id).bind(item.calendar_version).bind(i64::from(index == 0)).execute(&mut **tx).await.map_err(database_error)?;
                }
            }
        }
    }
    Ok(())
}

async fn enforce_tightening(
    tx: &mut Transaction<'_, Sqlite>,
    owner: &str,
    kind: QuotaScopeKind,
    subject: &str,
    metric: QuotaMetric,
    period: QuotaPeriod,
    limit: i64,
) -> Result<(), AppError> {
    let parent_limit: Option<i64> = match kind {
        QuotaScopeKind::Group => sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT parent_id, (SELECT parent_id FROM groups WHERE id = g.parent_id), 1 FROM groups g WHERE g.id = ? AND g.parent_id IS NOT NULL UNION ALL SELECT p.id, p.parent_id, a.depth + 1 FROM groups p JOIN ancestors a ON a.parent_id = p.id) SELECT MIN(q.limit_value) FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id WHERE q.status = 'active' AND q.subject_kind = 'group' AND q.subject_id = q.owner_group_id AND q.metric = ? AND q.period = ?").bind(owner).bind(metric.as_str()).bind(period.as_str()).fetch_one(&mut **tx).await.map_err(database_error)?,
        QuotaScopeKind::User => sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors a ON a.parent_id = p.id) SELECT MIN(q.limit_value) FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id WHERE q.status = 'active' AND q.metric = ? AND q.period = ? AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.subject_id = ? AND q.owner_group_id != ?))").bind(owner).bind(metric.as_str()).bind(period.as_str()).bind(subject).bind(owner).fetch_one(&mut **tx).await.map_err(database_error)?,
    };
    if parent_limit.is_some_and(|parent| limit > parent) {
        return Err(AppError::BadRequest(
            "child quota may only tighten an inherited cap".into(),
        ));
    }
    Ok(())
}

async fn sum_usage(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    start: i64,
    end: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("SELECT value FROM usage_ledger WHERE scope_kind = ? AND scope_id = ? AND metric = ? AND quota_period = ? AND period_starts_at = ? AND period_ends_at = ?")
        .bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn sum_open_reservations(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    start: i64,
    end: i64,
    timestamp: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("SELECT metric.reserved_value FROM quota_reservations reservation JOIN quota_reservation_periods period ON period.reservation_id = reservation.id JOIN quota_reservation_metrics metric ON metric.reservation_id = reservation.id AND metric.metric = period.metric WHERE reservation.status = 'open' AND reservation.expires_at > ? AND period.scope_kind = ? AND period.scope_id = ? AND period.metric = ? AND period.quota_period = ? AND period.period_starts_at = ? AND period.period_ends_at = ?")
        .bind(timestamp).bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn sum_visible_subtree_usage(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    visible_group: &str,
    start: i64,
    end: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id) SELECT ledger.value FROM usage_ledger ledger JOIN descendants d ON d.id = ledger.direct_group_id WHERE ledger.scope_kind = ? AND ledger.scope_id = ? AND ledger.metric = ? AND ledger.quota_period = ? AND ledger.period_starts_at = ? AND ledger.period_ends_at = ?")
        .bind(visible_group).bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn sum_visible_subtree_reservations(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    visible_group: &str,
    start: i64,
    end: i64,
    timestamp: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id) SELECT metric.reserved_value FROM quota_reservations reservation JOIN descendants d ON d.id = reservation.direct_group_id JOIN quota_reservation_periods period ON period.reservation_id = reservation.id JOIN quota_reservation_metrics metric ON metric.reservation_id = reservation.id AND metric.metric = period.metric WHERE reservation.status = 'open' AND reservation.expires_at > ? AND period.scope_kind = ? AND period.scope_id = ? AND period.metric = ? AND period.quota_period = ? AND period.period_starts_at = ? AND period.period_ends_at = ?")
        .bind(visible_group).bind(timestamp).bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn sum_learner_usage(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    learner_user_id: &str,
    start: i64,
    end: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("SELECT value FROM usage_ledger WHERE learner_user_id = ? AND scope_kind = ? AND scope_id = ? AND metric = ? AND quota_period = ? AND period_starts_at = ? AND period_ends_at = ?")
        .bind(learner_user_id).bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn sum_learner_reservations(
    tx: &mut Transaction<'_, Sqlite>,
    item: &ApplicableDefinition,
    learner_user_id: &str,
    start: i64,
    end: i64,
    timestamp: i64,
) -> Result<i64, AppError> {
    let values: Vec<i64> = sqlx::query_scalar("SELECT metric.reserved_value FROM quota_reservations reservation JOIN quota_reservation_periods period ON period.reservation_id = reservation.id JOIN quota_reservation_metrics metric ON metric.reservation_id = reservation.id AND metric.metric = period.metric WHERE reservation.learner_user_id = ? AND reservation.status = 'open' AND reservation.expires_at > ? AND period.scope_kind = ? AND period.scope_id = ? AND period.metric = ? AND period.quota_period = ? AND period.period_starts_at = ? AND period.period_ends_at = ?")
        .bind(learner_user_id).bind(timestamp).bind(item.definition.subject_kind.as_str()).bind(&item.definition.subject_id).bind(item.definition.metric.as_str()).bind(item.definition.period.as_str()).bind(start).bind(end).fetch_all(&mut **tx).await.map_err(database_error)?;
    checked_sum(values)
}

async fn ancestry_scopes(
    tx: &mut Transaction<'_, Sqlite>,
    group: &str,
    learner: &str,
) -> Result<Vec<ReservedScope>, AppError> {
    let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT id, depth FROM ancestors ORDER BY depth")
        .bind(group).fetch_all(&mut **tx).await.map_err(database_error)?;
    let mut scopes = vec![ReservedScope {
        scope_kind: QuotaScopeKind::User,
        scope_id: learner.into(),
        depth: 0,
    }];
    scopes.extend(rows.into_iter().map(|row| ReservedScope {
        scope_kind: QuotaScopeKind::Group,
        scope_id: row.get("id"),
        depth: row.get("depth"),
    }));
    Ok(scopes)
}

async fn load_reservation(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<QuotaReservation, AppError> {
    let row = sqlx::query("SELECT * FROM quota_reservations WHERE id = ?")
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .map_err(database_error)?;
    let scope_rows = sqlx::query("SELECT scope_kind, scope_id, depth FROM quota_reservation_scopes WHERE reservation_id = ? ORDER BY depth, scope_kind DESC").bind(id).fetch_all(&mut **tx).await.map_err(database_error)?;
    let mut scopes = Vec::new();
    for scope in scope_rows {
        scopes.push(ReservedScope {
            scope_kind: scope_from_str(scope.get("scope_kind"))?,
            scope_id: scope.get("scope_id"),
            depth: scope.get("depth"),
        });
    }
    Ok(QuotaReservation {
        id: row.get("id"),
        request_id: row.get("request_id"),
        learner_user_id: row.get("learner_user_id"),
        direct_group_id: row.get("direct_group_id"),
        provider_id: row.get("provider_id"),
        model_id: row.get("model_id"),
        price_version_id: row.get("price_version_id"),
        expires_at: row.get("expires_at"),
        accounting_at: row.get("accounting_at"),
        reserved_by_scope: scopes,
    })
}

async fn release_expired_in_transaction(
    tx: &mut Transaction<'_, Sqlite>,
    timestamp: i64,
) -> Result<u64, AppError> {
    Ok(sqlx::query("UPDATE quota_reservations SET status = 'expired' WHERE status = 'open' AND expires_at <= ?").bind(timestamp).execute(&mut **tx).await.map_err(database_error)?.rows_affected())
}

async fn summary_in_transaction(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group: &str,
    learner: Option<&str>,
    cursor: Option<&str>,
    limit: usize,
) -> Result<UsageSummary, AppError> {
    let limit = limit.clamp(1, 100);
    if let Some(cursor) = cursor {
        Uuid::parse_str(cursor).map_err(|_| AppError::BadRequest("invalid usage cursor".into()))?;
    }
    let timestamp = now();
    let calendar = load_calendar(tx, group, timestamp).await?;
    let definition_rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status = 'active' UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id WHERE p.status = 'active') SELECT q.* FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id WHERE q.status = 'active' AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.owner_group_id = ? AND (? IS NULL OR q.subject_id = ?))) ORDER BY a.depth DESC, q.metric, q.period, q.id")
        .bind(group).bind(group).bind(learner).bind(learner).fetch_all(&mut **tx).await.map_err(database_error)?;
    let mut buckets = Vec::new();
    for row in definition_rows {
        let definition = definition_from_row(row)?;
        let interval = interval_for(definition.period, timestamp, &calendar)?;
        let item = ApplicableDefinition {
            definition,
            interval,
            calendar_root_group_id: calendar.root_group_id.clone(),
            calendar_version: calendar.version,
        };
        let inherited = item.definition.owner_group_id != group;
        let source_visible = !inherited
            || has_capability_in_transaction(
                tx,
                principal,
                &item.definition.owner_group_id,
                Capability::AnalyticsView,
            )
            .await?;
        let learner_group_constraint =
            learner.is_some() && item.definition.subject_kind == QuotaScopeKind::Group;
        let (used, reserved) = if learner_group_constraint {
            (
                sum_learner_usage(
                    tx,
                    &item,
                    learner.expect("learner summary has learner id"),
                    interval.0,
                    interval.1,
                )
                .await?,
                sum_learner_reservations(
                    tx,
                    &item,
                    learner.expect("learner summary has learner id"),
                    interval.0,
                    interval.1,
                    timestamp,
                )
                .await?,
            )
        } else if inherited && !source_visible {
            (
                sum_visible_subtree_usage(tx, &item, group, interval.0, interval.1).await?,
                sum_visible_subtree_reservations(
                    tx, &item, group, interval.0, interval.1, timestamp,
                )
                .await?,
            )
        } else {
            (
                sum_usage(tx, &item, interval.0, interval.1).await?,
                sum_open_reservations(tx, &item, interval.0, interval.1, timestamp).await?,
            )
        };
        let consumed = checked_add(used, reserved)?;
        buckets.push(UsageBucket {
            scope_kind: item.definition.subject_kind,
            scope_id: if source_visible {
                item.definition.subject_id.clone()
            } else {
                group.to_string()
            },
            metric: item.definition.metric,
            used,
            reserved,
            limit: Some(item.definition.limit),
            remaining: if learner_group_constraint {
                None
            } else {
                Some(item.definition.limit.saturating_sub(consumed))
            },
            warning: !learner_group_constraint
                && item.definition.limit > 0
                && consumed.saturating_mul(10) >= item.definition.limit.saturating_mul(8),
            inherited,
            source_visible,
            constraint_state: if learner_group_constraint {
                "governed-no-peer-aggregate".into()
            } else {
                "exact".into()
            },
            period_starts_at: interval.0,
            period_ends_at: interval.1,
        });
    }
    let rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id) SELECT ledger.id, ledger.learner_user_id, ledger.direct_group_id, ledger.provider_id, ledger.model_id, ledger.metric, ledger.value FROM usage_ledger ledger JOIN descendants d ON d.id = ledger.direct_group_id JOIN quota_reservation_periods period ON period.reservation_id = ledger.reservation_id AND period.scope_kind = ledger.scope_kind AND period.scope_id = ledger.scope_id AND period.metric = ledger.metric AND period.quota_period = ledger.quota_period AND period.period_starts_at = ledger.period_starts_at AND period.period_ends_at = ledger.period_ends_at AND period.is_primary = 1 WHERE ledger.scope_kind = 'group' AND ledger.scope_id = ledger.direct_group_id AND (? IS NULL OR ledger.learner_user_id = ?) AND (? IS NULL OR ledger.id > ?) ORDER BY ledger.id LIMIT ?")
        .bind(group).bind(learner).bind(learner).bind(cursor).bind(cursor).bind(i64::try_from(limit + 1).unwrap_or(101)).fetch_all(&mut **tx).await.map_err(database_error)?;
    let has_more = rows.len() > limit;
    let rows = rows.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        rows.last().map(|r| r.get("id"))
    } else {
        None
    };
    let mut breakdowns = Vec::new();
    for row in rows {
        breakdowns.push(UsageBreakdown {
            learner_user_id: row.get("learner_user_id"),
            direct_group_id: row.get("direct_group_id"),
            provider_id: row.get("provider_id"),
            model_id: row.get("model_id"),
            metric: metric_from_str(row.get("metric"))?,
            value: row.get("value"),
        });
    }
    Ok(UsageSummary {
        buckets,
        breakdowns,
        next_cursor,
    })
}

fn interval_for(
    period: QuotaPeriod,
    timestamp: i64,
    calendar: &SchoolQuotaCalendar,
) -> Result<(i64, i64), AppError> {
    if period == QuotaPeriod::Term {
        if timestamp < calendar.term_starts_at || timestamp >= calendar.term_ends_at {
            return Err(AppError::Forbidden(
                "current time is outside the configured school term".into(),
            ));
        }
        return Ok((calendar.term_starts_at, calendar.term_ends_at));
    }
    let tz = Tz::from_str(&calendar.timezone)
        .map_err(|_| AppError::Internal("stored school timezone is invalid".into()))?;
    let utc = Utc
        .timestamp_opt(timestamp, 0)
        .single()
        .ok_or_else(|| AppError::BadRequest("timestamp is out of range".into()))?;
    let local = utc.with_timezone(&tz);
    let date = local.date_naive();
    let start_date = match period {
        QuotaPeriod::Daily => date,
        QuotaPeriod::Weekly => date
            .checked_sub_days(Days::new(u64::from(date.weekday().num_days_from_monday())))
            .ok_or_else(|| AppError::Internal("weekly quota boundary overflow".into()))?,
        QuotaPeriod::Monthly => NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
            .ok_or_else(|| AppError::Internal("monthly quota boundary is invalid".into()))?,
        QuotaPeriod::Term => unreachable!(),
    };
    let end_date = match period {
        QuotaPeriod::Daily => start_date.checked_add_days(Days::new(1)),
        QuotaPeriod::Weekly => start_date.checked_add_days(Days::new(7)),
        QuotaPeriod::Monthly => {
            if start_date.month() == 12 {
                NaiveDate::from_ymd_opt(start_date.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(start_date.year(), start_date.month() + 1, 1)
            }
        }
        QuotaPeriod::Term => unreachable!(),
    }
    .ok_or_else(|| AppError::Internal("quota boundary overflow".into()))?;
    Ok((
        local_midnight(&tz, start_date)?,
        local_midnight(&tz, end_date)?,
    ))
}

fn local_midnight(tz: &Tz, date: NaiveDate) -> Result<i64, AppError> {
    let naive = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::Internal("invalid local midnight".into()))?;
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(v) => Ok(v.timestamp()),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second).timestamp()),
        LocalResult::None => Err(AppError::Internal(
            "school timezone has no local midnight for quota boundary".into(),
        )),
    }
}

fn parse_amounts(values: &BTreeMap<String, i64>) -> Result<BTreeMap<QuotaMetric, i64>, AppError> {
    if values.is_empty() {
        return Err(AppError::BadRequest(
            "at least one quota amount is required".into(),
        ));
    }
    let mut parsed = BTreeMap::new();
    for (key, value) in values {
        validate_nonnegative(key, *value)?;
        parsed.insert(metric_from_str(key)?, *value);
    }
    Ok(parsed)
}

fn parse_reservation_amounts(
    values: &BTreeMap<String, i64>,
) -> Result<BTreeMap<QuotaMetric, i64>, AppError> {
    let parsed = parse_amounts(values)?;
    if parsed.get(&QuotaMetric::Requests) != Some(&1) {
        return Err(AppError::BadRequest(
            "requests must be present and equal exactly 1".into(),
        ));
    }
    let token_values = [
        parsed.get(&QuotaMetric::InputTokens).copied(),
        parsed.get(&QuotaMetric::OutputTokens).copied(),
        parsed.get(&QuotaMetric::TotalTokens).copied(),
    ];
    if token_values.iter().any(Option::is_some) {
        let [Some(input), Some(output), Some(total)] = token_values else {
            return Err(AppError::BadRequest(
                "inputTokens, outputTokens, and totalTokens must be supplied together".into(),
            ));
        };
        if input
            .checked_add(output)
            .filter(|sum| *sum <= MAX_SAFE_INTEGER)
            != Some(total)
        {
            return Err(AppError::BadRequest(
                "totalTokens must equal inputTokens plus outputTokens".into(),
            ));
        }
    }
    Ok(parsed)
}
fn validate_nonnegative(field: &str, value: i64) -> Result<(), AppError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&value) {
        Err(AppError::BadRequest(format!(
            "{field} must be a nonnegative safe integer"
        )))
    } else {
        Ok(())
    }
}
fn validate_request_id(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > 200 {
        Err(AppError::BadRequest(
            "requestId must contain 1-200 characters".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate_idempotency_key(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > 200 {
        Err(AppError::BadRequest(
            "idempotencyKey must contain 1-200 characters".into(),
        ))
    } else {
        Ok(())
    }
}
fn checked_add(left: i64, right: i64) -> Result<i64, AppError> {
    left.checked_add(right)
        .filter(|v| *v <= MAX_SAFE_INTEGER)
        .ok_or_else(|| AppError::Conflict("quota accounting overflow".into()))
}
fn checked_sum(values: Vec<i64>) -> Result<i64, AppError> {
    values.into_iter().try_fold(0, checked_add)
}
fn fingerprint(parts: &[&str]) -> Vec<u8> {
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_be_bytes());
        h.update(p.as_bytes());
    }
    h.finalize().to_vec()
}

fn hidden_inherited_id(target_group_id: &str, definition_id: &str) -> String {
    let digest = fingerprint(&["hidden-inherited-quota-v1", target_group_id, definition_id]);
    format!("inherited-{}", &hex::encode(digest)[..24])
}
fn fingerprint_request(
    request: &ReserveQuotaRequest,
    amounts: &BTreeMap<QuotaMetric, i64>,
) -> Vec<u8> {
    let mut parts = vec![
        request.active_group_id.as_str(),
        request.provider_id.as_str(),
        request.model_id.as_str(),
        request.price_version_id.as_str(),
    ];
    let expiry = request.expires_at.map_or_else(
        || "expires=default".to_string(),
        |value| format!("expires={value}"),
    );
    let owned = amounts
        .iter()
        .map(|(m, v)| format!("{}={v}", m.as_str()))
        .chain(std::iter::once(expiry))
        .collect::<Vec<_>>();
    parts.extend(owned.iter().map(String::as_str));
    fingerprint(&parts)
}
fn fingerprint_reconciliation(
    request: &ReconcileQuotaRequest,
    actual: &BTreeMap<QuotaMetric, i64>,
) -> Vec<u8> {
    let mut parts = vec![
        request.reservation_id.as_str(),
        request.provider_id.as_str(),
        request.model_id.as_str(),
        request.price_version_id.as_str(),
    ];
    let owned = actual
        .iter()
        .map(|(m, v)| format!("{}={v}", m.as_str()))
        .collect::<Vec<_>>();
    parts.extend(owned.iter().map(String::as_str));
    fingerprint(&parts)
}

async fn replay_mutation(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group: &str,
    operation: &str,
    key: &str,
    hash: &[u8],
) -> Result<Option<String>, AppError> {
    if let Some(row) = sqlx::query("SELECT payload_hash, target_id FROM quota_mutations WHERE actor_user_id = ? AND owner_group_id = ? AND operation = ? AND idempotency_key = ?").bind(&principal.user_id).bind(group).bind(operation).bind(key).fetch_optional(&mut **tx).await.map_err(database_error)? { if row.get::<Vec<u8>,_>("payload_hash") != hash { return Err(AppError::Conflict("idempotency key was already used with a different payload or scope".into())); } return Ok(Some(row.get("target_id"))); }
    Ok(None)
}
async fn record_mutation(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group: &str,
    operation: &str,
    key: &str,
    hash: &[u8],
    target: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO quota_mutations (actor_user_id, owner_group_id, operation, idempotency_key, payload_hash, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(&principal.user_id).bind(group).bind(operation).bind(key).bind(hash).bind(target).bind(now()).execute(&mut **tx).await.map_err(database_error)?;
    Ok(())
}
async fn audit(
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    action: &str,
    target: &str,
    group: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, actor_api_key_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, ?, ?, 'llm_quota', ?, '{}', ?, ?, NULL)").bind(Uuid::now_v7().to_string()).bind(if principal.service_key_id.is_some() { None } else { Some(principal.user_id.as_str()) }).bind(&principal.service_key_id).bind(action).bind(target).bind(now()).bind(group).execute(&mut **tx).await.map_err(database_error)?;
    Ok(())
}
fn require_human(principal: &Principal) -> Result<(), AppError> {
    if principal.service_key_id.is_some() {
        Err(AppError::Forbidden(
            "human account required for quota administration".into(),
        ))
    } else {
        Ok(())
    }
}
fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}
fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}
fn map_write_error(error: sqlx::Error) -> AppError {
    if error.as_database_error().is_some() {
        AppError::Conflict(
            "quota write violated an ownership, ancestry, or idempotency invariant".into(),
        )
    } else {
        database_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    use tokio::sync::Barrier;

    #[test]
    fn utc_intervals_are_half_open_and_follow_dst_and_month_boundaries() {
        let calendar = SchoolQuotaCalendar {
            root_group_id: "root".into(),
            timezone: "Europe/Zurich".into(),
            term_starts_at: 1,
            term_ends_at: MAX_SAFE_INTEGER,
            version: 1,
        };
        let march = chrono::DateTime::parse_from_rfc3339("2026-03-29T12:00:00Z")
            .unwrap()
            .timestamp();
        let (start, end) = interval_for(QuotaPeriod::Daily, march, &calendar).unwrap();
        assert_eq!(end - start, 23 * 60 * 60);
        let december = chrono::DateTime::parse_from_rfc3339("2026-12-15T12:00:00Z")
            .unwrap()
            .timestamp();
        let (start, end) = interval_for(QuotaPeriod::Monthly, december, &calendar).unwrap();
        assert_eq!(
            Utc.timestamp_opt(start, 0)
                .unwrap()
                .with_timezone(&Tz::Europe__Zurich)
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 12, 1).unwrap()
        );
        assert_eq!(
            Utc.timestamp_opt(end, 0)
                .unwrap()
                .with_timezone(&Tz::Europe__Zurich)
                .date_naive(),
            NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()
        );
    }

    #[test]
    fn checked_accounting_rejects_overflow() {
        assert!(checked_add(MAX_SAFE_INTEGER, 1).is_err());
        assert_eq!(checked_sum(vec![1, 2, 3]).unwrap(), 6);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_requests_cannot_overspend_parent_cost_cap() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let barrier = Arc::new(Barrier::new(10));
        let attempts = (0..10).map(|index| {
            let service = service.clone();
            let learner = learner.clone();
            let mut request = request.clone();
            request.request_id = format!("request-{index}");
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                service.reserve(&learner, request).await
            })
        });
        let results = futures_util::future::join_all(attempts).await;
        let mut successes = 0;
        let mut cap_denials = 0;
        for result in &results {
            match result {
                Ok(Ok(_)) => successes += 1,
                Ok(Err(AppError::Conflict(message))) if message.contains("quota exceeded") => {
                    cap_denials += 1
                }
                other => panic!("contention produced a non-quota result: {other:?}"),
            }
        }
        assert_eq!((successes, cap_denials), (5, 5));
        let reserved: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(metric.reserved_value), 0) FROM quota_reservations reservation JOIN quota_reservation_metrics metric ON metric.reservation_id = reservation.id WHERE reservation.status = 'open' AND metric.metric = 'costMicros'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(reserved, 1_000_000);
        let scopes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quota_reservation_scopes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            scopes,
            5 * 3,
            "each reservation charges learner, class, and school"
        );
    }

    #[tokio::test]
    async fn idempotency_is_payload_bound_and_reconciliation_is_append_only() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let first = service.reserve(&learner, request.clone()).await.unwrap();
        assert_eq!(
            service.reserve(&learner, request.clone()).await.unwrap().id,
            first.id
        );
        let mut changed = request.clone();
        changed.amounts.insert("costMicros".into(), 300_000);
        assert!(matches!(
            service.reserve(&learner, changed).await,
            Err(AppError::Conflict(_))
        ));
        let omitted = ReconcileQuotaRequest {
            reservation_id: first.id.clone(),
            provider_id: request.provider_id.clone(),
            model_id: request.model_id.clone(),
            price_version_id: request.price_version_id.clone(),
            actual: BTreeMap::from([("requests".into(), 1)]),
        };
        assert!(matches!(
            service.reconcile(omitted).await,
            Err(AppError::BadRequest(_))
        ));
        let reconcile = ReconcileQuotaRequest {
            reservation_id: first.id.clone(),
            provider_id: request.provider_id,
            model_id: request.model_id,
            price_version_id: request.price_version_id,
            actual: BTreeMap::from([("costMicros".into(), 250_000), ("requests".into(), 1)]),
        };
        service.reconcile(reconcile.clone()).await.unwrap();
        service.reconcile(reconcile.clone()).await.unwrap();
        let mut different_actual = reconcile;
        different_actual.actual.insert("costMicros".into(), 249_999);
        assert!(matches!(
            service.reconcile(different_actual).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM usage_ledger WHERE reservation_id = ?"
            )
            .bind(&first.id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            6
        );
        let summary = service
            .usage_summary(&admin_principal(), "school", None, 50)
            .await
            .unwrap();
        let cost = summary
            .buckets
            .iter()
            .find(|bucket| bucket.metric == QuotaMetric::CostMicros)
            .unwrap();
        assert_eq!(
            (cost.used, cost.reserved, cost.remaining),
            (250_000, 0, Some(750_000))
        );
        assert_eq!(
            summary.breakdowns.len(),
            2,
            "breakdowns count each direct request metric once, not once per ancestor scope"
        );
        sqlx::query("UPDATE groups SET status = 'archived', archived_at = ? WHERE id = 'class'")
            .bind(now())
            .execute(&pool)
            .await
            .unwrap();
        let historical = service
            .usage_summary(&admin_principal(), "school", None, 50)
            .await
            .unwrap();
        assert_eq!(
            historical.breakdowns.len(),
            2,
            "parent rollup retains archived class usage"
        );
        assert!(
            sqlx::query("UPDATE usage_ledger SET value = 0 WHERE reservation_id = ?")
                .bind(&first.id)
                .execute(&pool)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn database_rejects_scope_ancestry_and_reservation_identity_mutation() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let reservation = service.reserve(&learner, request).await.unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('sibling', 'school', 'Sibling', 'sibling', 'active', 1)").execute(&pool).await.unwrap();
        assert!(sqlx::query("INSERT INTO quota_reservation_scopes (reservation_id, scope_kind, scope_id, depth) VALUES (?, 'group', 'sibling', 1)").bind(&reservation.id).execute(&pool).await.is_err());
        assert!(sqlx::query(
            "UPDATE quota_reservations SET direct_group_id = 'school' WHERE id = ?"
        )
        .bind(&reservation.id)
        .execute(&pool)
        .await
        .is_err());
        assert!(
            sqlx::query("UPDATE quota_reservations SET status = 'reconciled' WHERE id = ?")
                .bind(&reservation.id)
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(sqlx::query(
            "UPDATE quota_definitions SET owner_group_id = 'class' WHERE id = 'root-cost'"
        )
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, created_by_user_id, created_at, updated_at) VALUES ('loose-child', 'class', 'group', 'class', 'costMicros', 'monthly', 1000001, 'admin', 1, 1)").execute(&pool).await.is_err());
        sqlx::query("INSERT INTO quota_reservations (id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, status, expires_at, accounting_at, created_at) VALUES ('incomplete', 'incomplete', 'learner', 'class', 'provider', 'model', 'price', X'00', 'building', 9999999999, 2, 2)").execute(&pool).await.unwrap();
        assert!(sqlx::query(
            "UPDATE quota_reservations SET status = 'open', finalized = 1 WHERE id = 'incomplete'"
        )
        .execute(&pool)
        .await
        .is_err());
        sqlx::query("INSERT INTO quota_reservations (id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, status, expires_at, accounting_at, created_at) VALUES ('omits-cost', 'omits-cost', 'learner', 'class', 'provider', 'model', 'price', X'01', 'building', 9999999999, 2, 2)").execute(&pool).await.unwrap();
        for (kind, id, depth) in [
            ("user", "learner", 0),
            ("group", "class", 0),
            ("group", "school", 1),
        ] {
            sqlx::query("INSERT INTO quota_reservation_scopes (reservation_id, scope_kind, scope_id, depth) VALUES ('omits-cost', ?, ?, ?)").bind(kind).bind(id).bind(depth).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO quota_reservation_metrics (reservation_id, metric, reserved_value, required) VALUES ('omits-cost', 'requests', 1, 1)").execute(&pool).await.unwrap();
        for (kind, id) in [("user", "learner"), ("group", "class"), ("group", "school")] {
            sqlx::query("INSERT INTO quota_reservation_periods (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at, limit_value, definition_id, calendar_version, is_primary) VALUES ('omits-cost', ?, ?, 'requests', 'event', 2, 3, NULL, NULL, NULL, 1)").bind(kind).bind(id).execute(&pool).await.unwrap();
        }
        assert!(sqlx::query(
            "UPDATE quota_reservations SET status = 'open', finalized = 1 WHERE id = 'omits-cost'"
        )
        .execute(&pool)
        .await
        .is_err());
        let contract = sqlx::query("SELECT calendar_version, quota_period, period_starts_at, period_ends_at, limit_value FROM quota_definition_periods WHERE definition_id = 'root-cost' LIMIT 1").fetch_one(&pool).await.unwrap();
        sqlx::query("INSERT INTO quota_reservations (id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, status, expires_at, accounting_at, created_at) VALUES ('forged-period', 'forged-period', 'learner', 'class', 'provider', 'model', 'price', X'02', 'building', 9999999999, 2, 2)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO quota_reservation_metrics (reservation_id, metric, reserved_value, required) VALUES ('forged-period', 'costMicros', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO quota_reservation_scopes (reservation_id, scope_kind, scope_id, depth) VALUES ('forged-period', 'group', 'school', 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO quota_reservation_scopes (reservation_id, scope_kind, scope_id, depth) VALUES ('forged-period', 'group', 'class', 0)").execute(&pool).await.unwrap();
        assert!(sqlx::query("INSERT INTO quota_reservation_periods (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at, limit_value, definition_id, calendar_version, is_primary) VALUES ('forged-period', 'group', 'school', 'costMicros', ?, ?, ?, ?, 'root-cost', ?, 1)")
            .bind(contract.get::<String,_>("quota_period")).bind(contract.get::<i64,_>("period_starts_at") + 1).bind(contract.get::<i64,_>("period_ends_at")).bind(contract.get::<i64,_>("limit_value")).bind(contract.get::<i64,_>("calendar_version")).execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO quota_reservation_periods (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at, limit_value, definition_id, calendar_version, is_primary) VALUES ('forged-period', 'group', 'class', 'costMicros', ?, ?, ?, ?, 'root-cost', ?, 1)")
            .bind(contract.get::<String,_>("quota_period")).bind(contract.get::<i64,_>("period_starts_at")).bind(contract.get::<i64,_>("period_ends_at")).bind(contract.get::<i64,_>("limit_value")).bind(contract.get::<i64,_>("calendar_version")).execute(&pool).await.is_err());
        let period = sqlx::query("SELECT scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at FROM quota_reservation_periods WHERE reservation_id = ? LIMIT 1")
            .bind(&reservation.id).fetch_one(&pool).await.unwrap();
        assert!(sqlx::query("INSERT INTO usage_ledger (id, reservation_id, scope_kind, scope_id, metric, value, period_starts_at, period_ends_at, quota_period, provider_id, model_id, price_version_id, learner_user_id, direct_group_id, created_at) VALUES ('forged-ledger', ?, ?, ?, ?, 1, ?, ?, ?, 'wrong-provider', 'model', 'price', 'learner', 'class', 2)")
            .bind(&reservation.id).bind(period.get::<String,_>("scope_kind")).bind(period.get::<String,_>("scope_id")).bind(period.get::<String,_>("metric")).bind(period.get::<i64,_>("period_starts_at")).bind(period.get::<i64,_>("period_ends_at")).bind(period.get::<String,_>("quota_period")).execute(&pool).await.is_err());
    }

    #[tokio::test]
    async fn reconciliation_uses_snapshot_after_archive_revocation_calendar_change_and_expiry() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let reservation = service.reserve(&learner, request.clone()).await.unwrap();
        sqlx::query("UPDATE group_memberships SET status = 'archived', archived_at = ? WHERE user_id = 'learner'")
            .bind(now()).execute(&pool).await.unwrap();
        sqlx::query("UPDATE groups SET status = 'archived', archived_at = ? WHERE id = 'class'")
            .bind(now())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM school_quota_calendars WHERE root_group_id = 'school'")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        release_expired_in_transaction(&mut tx, reservation.expires_at)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        service
            .reconcile(ReconcileQuotaRequest {
                reservation_id: reservation.id.clone(),
                provider_id: request.provider_id,
                model_id: request.model_id,
                price_version_id: request.price_version_id,
                actual: BTreeMap::from([("requests".into(), 1), ("costMicros".into(), 210_000)]),
            })
            .await
            .unwrap();
        let mismatches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_ledger ledger LEFT JOIN quota_reservation_periods period ON period.reservation_id = ledger.reservation_id AND period.scope_kind = ledger.scope_kind AND period.scope_id = ledger.scope_id AND period.metric = ledger.metric AND period.quota_period = ledger.quota_period AND period.period_starts_at = ledger.period_starts_at AND period.period_ends_at = ledger.period_ends_at WHERE ledger.reservation_id = ? AND period.reservation_id IS NULL")
            .bind(&reservation.id).fetch_one(&pool).await.unwrap();
        assert_eq!(mismatches, 0);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM quota_reservations WHERE id = ?")
                .bind(&reservation.id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "reconciled"
        );
    }

    #[tokio::test]
    async fn every_ancestor_policy_remains_required_and_inherited_allowance_is_redacted() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let admin = admin_principal();
        service
            .upsert_definition(
                &admin,
                "class",
                QuotaScopeKind::Group,
                "class",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                500_000,
                "child-cap",
            )
            .await
            .unwrap();
        service
            .upsert_definition(
                &admin,
                "school",
                QuotaScopeKind::Group,
                "school",
                QuotaMetric::Requests,
                QuotaPeriod::Daily,
                100,
                "root-requests",
            )
            .await
            .unwrap();
        let child_document = serde_json::json!({"llm":{"enabled":true,"quotas":[{"metric":"costMicros","limit":500000,"period":"monthly","hard":true}]}}).to_string();
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('child-policy', 'class', ?, 'child-hash', 'child-compiled', 'admin', 'child governed', '[\"policy\"]', 2)").bind(child_document).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('class', 'child-policy', 2)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('teacher', 'teacher@test.invalid', 'teacher@test.invalid', 'Teacher', 'active', 'teacher', 0, 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('teacher-membership', 'class', 'teacher', 'active', 1)").execute(&pool).await.unwrap();
        for capability in [Capability::LlmConfigure, Capability::AnalyticsView] {
            sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('teacher-membership', ?)").bind(capability.as_str()).execute(&pool).await.unwrap();
        }
        let teacher = Principal {
            user_id: "teacher".into(),
            service_key_id: None,
            session_id: "teacher-session".into(),
            device_id: "teacher-device".into(),
            active_group_id: Some("class".into()),
            identity_type: IdentityType::Teacher,
            is_root: false,
        };
        let mut next = request.clone();
        next.request_id = "missing-root".into();
        next.amounts.insert("costMicros".into(), 100_000);
        service.reserve(&learner, request).await.unwrap();
        let before_sibling = service
            .usage_summary(&teacher, "class", None, 50)
            .await
            .unwrap();
        let before_inherited = before_sibling
            .buckets
            .iter()
            .find(|bucket| bucket.inherited && bucket.metric == QuotaMetric::CostMicros)
            .unwrap();
        let before_numbers = (
            before_inherited.used,
            before_inherited.reserved,
            before_inherited.remaining,
        );
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('learner-b', 'learner-b@test.invalid', 'learner-b@test.invalid', 'Learner B', 'active', 'learner', 0, 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('class-b', 'school', 'Class B', 'class-b', 'active', 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('learner-b-membership', 'class-b', 'learner-b', 'active', 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, created_by_user_id, created_at, updated_at) VALUES ('class-b-cost', 'class-b', 'group', 'class-b', 'costMicros', 'monthly', 900000, 'admin', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_providers (id, group_id, name, provider_kind, base_url, status, created_by_user_id, created_at, updated_at) VALUES ('provider-b', 'class-b', 'Provider B', 'openaiCompatible', 'https://provider-b.test/v1', 'active', 'admin', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_models (id, group_id, provider_id, model_key, upstream_model, status, created_by_user_id, created_at, updated_at) VALUES ('model-b', 'class-b', 'provider-b', 'balanced', 'model-b-v1', 'active', 'admin', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO provider_price_versions (id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, idempotency_key, created_by_user_id, created_at) VALUES ('price-b', 'class-b', 'provider-b', 'model-b', 'CHF', 'perMillionTokens', 1, 1, 'price-b', 'admin', 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('class-b-policy', 'class-b', ?, 'class-b-hash', 'class-b-compiled', 'admin', 'class b governed', '[\"policy\"]', 2)").bind(serde_json::json!({"llm":{"enabled":true,"quotas":[{"metric":"costMicros","limit":900000,"period":"monthly","hard":true}]}}).to_string()).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('class-b', 'class-b-policy', 2)").execute(&pool).await.unwrap();
        let learner_b = Principal {
            user_id: "learner-b".into(),
            service_key_id: None,
            session_id: "learner-b-session".into(),
            device_id: "learner-b-device".into(),
            active_group_id: Some("class-b".into()),
            identity_type: IdentityType::Learner,
            is_root: false,
        };
        let request_b = ReserveQuotaRequest {
            request_id: "class-b-700".into(),
            active_group_id: "class-b".into(),
            provider_id: "provider-b".into(),
            model_id: "model-b".into(),
            price_version_id: "price-b".into(),
            amounts: BTreeMap::from([("requests".into(), 1), ("costMicros".into(), 700_000)]),
            expires_at: None,
        };
        service
            .reserve(&learner_b, request_b.clone())
            .await
            .unwrap();
        let mut aggregate_denied = request_b;
        aggregate_denied.request_id = "class-b-over-school".into();
        aggregate_denied
            .amounts
            .insert("costMicros".into(), 200_000);
        assert!(
            matches!(service.reserve(&learner_b, aggregate_denied).await, Err(AppError::Conflict(message)) if message.contains("quota exceeded"))
        );
        let definitions = service.list_definitions(&teacher, "class").await.unwrap();
        let hidden_ids = definitions
            .iter()
            .filter(|definition| definition.inherited && !definition.source_visible)
            .map(|definition| definition.id.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(hidden_ids.len(), 2);
        assert!(hidden_ids
            .iter()
            .all(|id| id.starts_with("inherited-") && !id.contains("root")));
        assert!(definitions.iter().any(|definition| definition.inherited
            && !definition.source_visible
            && definition.limit == 1_000_000
            && definition.owner_group_id == "class"));
        let summary = service
            .usage_summary(&teacher, "class", None, 50)
            .await
            .unwrap();
        let after_inherited = summary
            .buckets
            .iter()
            .find(|bucket| bucket.inherited && bucket.metric == QuotaMetric::CostMicros)
            .unwrap();
        assert_eq!(
            before_numbers,
            (
                after_inherited.used,
                after_inherited.reserved,
                after_inherited.remaining,
            ),
            "sibling reservations must not change redacted inherited numerics"
        );
        assert!(summary.buckets.iter().any(|bucket| bucket.inherited
            && !bucket.source_visible
            && bucket.limit == Some(1_000_000)
            && bucket.scope_id == "class"));
        assert!(service
            .delete_definition(&admin, "root-cost", "delete-governed-root")
            .await
            .is_err());
        sqlx::query("DELETE FROM active_policies WHERE group_id = 'school'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE quota_definitions SET status = 'deleted' WHERE id = 'root-cost'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('school', 'policy', 3)").execute(&pool).await.unwrap();
        assert!(matches!(
            service.reserve(&learner, next).await,
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn missing_governed_policy_fails_closed_and_expiry_releases_on_touch() {
        let (pool, service, learner, mut request) = quota_fixture(1_000_000).await;
        sqlx::query("DELETE FROM active_policies")
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            service.reserve(&learner, request.clone()).await,
            Err(AppError::Forbidden(_))
        ));
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('school', 'policy', 1)").execute(&pool).await.unwrap();
        request.request_id = "expires".into();
        let reservation = service.reserve(&learner, request).await.unwrap();
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        assert_eq!(
            release_expired_in_transaction(&mut tx, reservation.expires_at)
                .await
                .unwrap(),
            1
        );
        tx.commit().await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM quota_reservations WHERE id = ?")
                .bind(&reservation.id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "expired"
        );
    }

    #[tokio::test]
    async fn revoked_membership_and_archived_group_fail_before_reservation() {
        let (pool, service, learner, mut request) = quota_fixture(1_000_000).await;
        sqlx::query("UPDATE group_memberships SET status = 'archived', archived_at = ? WHERE user_id = 'learner'").bind(now()).execute(&pool).await.unwrap();
        assert!(matches!(
            service.reserve(&learner, request.clone()).await,
            Err(AppError::Forbidden(_))
        ));
        sqlx::query("UPDATE group_memberships SET status = 'active', archived_at = NULL WHERE user_id = 'learner'").execute(&pool).await.unwrap();
        sqlx::query("UPDATE groups SET status = 'archived', archived_at = ? WHERE id = 'class'")
            .bind(now())
            .execute(&pool)
            .await
            .unwrap();
        request.request_id = "archived-group".into();
        assert!(matches!(
            service.reserve(&learner, request).await,
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn child_limit_can_only_tighten_parent_and_zero_denies_all_usage() {
        let (pool, service, learner, mut request) = quota_fixture(1_000_000).await;
        let admin = admin_principal();
        let enlarged = service
            .upsert_definition(
                &admin,
                "class",
                QuotaScopeKind::Group,
                "class",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                1_000_001,
                "enlarge",
            )
            .await;
        assert!(matches!(enlarged, Err(AppError::BadRequest(_))));
        service
            .upsert_definition(
                &admin,
                "class",
                QuotaScopeKind::Group,
                "class",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                900_000,
                "child-nine-hundred",
            )
            .await
            .unwrap();
        assert!(service
            .upsert_definition(
                &admin,
                "school",
                QuotaScopeKind::Group,
                "school",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                800_000,
                "parent-below-child",
            )
            .await
            .is_err());
        let zero = service
            .upsert_definition(
                &admin,
                "class",
                QuotaScopeKind::Group,
                "class",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                0,
                "zero",
            )
            .await
            .unwrap();
        request.request_id = "zero-denied".into();
        assert!(matches!(
            service.reserve(&learner, request.clone()).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quota_reservations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        service
            .delete_definition(&admin, &zero.id, "delete-zero")
            .await
            .unwrap();
        service
            .delete_definition(&admin, &zero.id, "delete-zero")
            .await
            .unwrap();
        request.request_id = "after-delete".into();
        assert!(service.reserve(&learner, request).await.is_ok());
    }

    #[tokio::test]
    async fn reservation_requires_requests_and_consistent_token_estimates() {
        let (_pool, service, learner, mut request) = quota_fixture(1_000_000).await;
        request.amounts.remove("requests");
        assert!(matches!(
            service.reserve(&learner, request.clone()).await,
            Err(AppError::BadRequest(_))
        ));
        let mut cost_omitted = request.clone();
        cost_omitted.request_id = "cost-omitted".into();
        cost_omitted.amounts.insert("requests".into(), 1);
        cost_omitted.amounts.remove("costMicros");
        assert!(matches!(
            service.reserve(&learner, cost_omitted).await,
            Err(AppError::BadRequest(_))
        ));
        service
            .upsert_definition(
                &admin_principal(),
                "school",
                QuotaScopeKind::Group,
                "school",
                QuotaMetric::InputTokens,
                QuotaPeriod::Daily,
                10_000,
                "input-governed",
            )
            .await
            .unwrap();
        let mut input_omitted = request.clone();
        input_omitted.request_id = "input-omitted".into();
        input_omitted.amounts.insert("requests".into(), 1);
        assert!(matches!(
            service.reserve(&learner, input_omitted).await,
            Err(AppError::BadRequest(_))
        ));
        request.request_id = "token-mismatch".into();
        request.amounts.insert("requests".into(), 1);
        request.amounts.insert("inputTokens".into(), 10);
        request.amounts.insert("outputTokens".into(), 20);
        request.amounts.insert("totalTokens".into(), 31);
        assert!(matches!(
            service.reserve(&learner, request).await,
            Err(AppError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn concurrent_capability_revocation_wins_before_list_and_summary_snapshots() {
        let (pool, service, _learner, _request) = quota_fixture(1_000_000).await;
        let mut revocation = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = 'admin-membership' AND capability IN (?, ?)")
            .bind(Capability::LlmConfigure.as_str()).bind(Capability::PoliciesView.as_str()).execute(&mut *revocation).await.unwrap();
        let list_service = service.clone();
        let list_actor = admin_principal();
        let list =
            tokio::spawn(async move { list_service.list_definitions(&list_actor, "school").await });
        tokio::task::yield_now().await;
        revocation.commit().await.unwrap();
        assert!(matches!(list.await.unwrap(), Err(AppError::Forbidden(_))));

        let (pool, service, _learner, _request) = quota_fixture(1_000_000).await;
        let mut revocation = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = 'admin-membership' AND capability = ?")
            .bind(Capability::AnalyticsView.as_str()).execute(&mut *revocation).await.unwrap();
        let summary_service = service.clone();
        let summary_actor = admin_principal();
        let summary = tokio::spawn(async move {
            summary_service
                .usage_summary(&summary_actor, "school", None, 50)
                .await
        });
        tokio::task::yield_now().await;
        revocation.commit().await.unwrap();
        assert!(matches!(
            summary.await.unwrap(),
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn active_calendar_change_cannot_reopen_filled_cap_and_future_term_is_pending() {
        let (pool, service, learner, mut request) = quota_fixture(200_000).await;
        service.reserve(&learner, request.clone()).await.unwrap();
        let admin = admin_principal();
        assert!(matches!(
            service
                .configure_calendar(&admin, "school", "America/New_York", 1, MAX_SAFE_INTEGER,)
                .await,
            Err(AppError::Conflict(_))
        ));
        assert!(sqlx::query("UPDATE school_quota_calendars SET timezone = 'Asia/Tokyo' WHERE root_group_id = 'school'")
            .execute(&pool).await.is_err());
        assert!(matches!(
            service
                .configure_calendar(&admin, "school", "Europe/Zurich", 2, MAX_SAFE_INTEGER - 1,)
                .await,
            Err(AppError::Conflict(_))
        ));
        let future_start = now() + 86_400;
        let active = service
            .configure_calendar(
                &admin,
                "school",
                "America/New_York",
                future_start,
                future_start + 31 * 86_400,
            )
            .await
            .unwrap();
        assert_eq!(active.timezone, "Europe/Zurich");
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT pending_timezone FROM school_quota_calendars WHERE root_group_id = 'school'").fetch_one(&pool).await.unwrap(), "America/New_York");
        request.request_id = "still-filled-after-calendar-attempt".into();
        request.amounts.insert("costMicros".into(), 1);
        assert!(
            matches!(service.reserve(&learner, request).await, Err(AppError::Conflict(message)) if message.contains("quota exceeded"))
        );
    }

    #[tokio::test]
    async fn learner_summary_numerics_do_not_change_when_classmate_uses_quota() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        service.reserve(&learner, request.clone()).await.unwrap();
        let before = service
            .usage_summary(&learner, "class", None, 50)
            .await
            .unwrap();
        let before_cost = before
            .buckets
            .iter()
            .find(|bucket| bucket.metric == QuotaMetric::CostMicros)
            .unwrap();
        let before_numbers = (
            before_cost.used,
            before_cost.reserved,
            before_cost.remaining,
        );
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('classmate', 'classmate@test.invalid', 'classmate@test.invalid', 'Classmate', 'active', 'learner', 0, 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('classmate-membership', 'class', 'classmate', 'active', 1)").execute(&pool).await.unwrap();
        let classmate = Principal {
            user_id: "classmate".into(),
            service_key_id: None,
            session_id: "classmate-session".into(),
            device_id: "classmate-device".into(),
            active_group_id: Some("class".into()),
            identity_type: IdentityType::Learner,
            is_root: false,
        };
        let mut peer_request = request;
        peer_request.request_id = "classmate-request".into();
        peer_request.amounts.insert("costMicros".into(), 300_000);
        service.reserve(&classmate, peer_request).await.unwrap();
        let after = service
            .usage_summary(&learner, "class", None, 50)
            .await
            .unwrap();
        let after_cost = after
            .buckets
            .iter()
            .find(|bucket| bucket.metric == QuotaMetric::CostMicros)
            .unwrap();
        assert_eq!(
            before_numbers,
            (after_cost.used, after_cost.reserved, after_cost.remaining)
        );
        assert_eq!(after_cost.constraint_state, "governed-no-peer-aggregate");
        assert_eq!(after_cost.remaining, None);
    }

    #[tokio::test]
    async fn recurring_definitions_snapshot_successive_days_and_months() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        service
            .upsert_definition(
                &admin_principal(),
                "school",
                QuotaScopeKind::Group,
                "school",
                QuotaMetric::Requests,
                QuotaPeriod::Daily,
                10,
                "daily-requests",
            )
            .await
            .unwrap();
        for (index, instant) in [
            "2026-01-15T12:00:00Z",
            "2026-01-16T12:00:00Z",
            "2026-02-15T12:00:00Z",
        ]
        .into_iter()
        .enumerate()
        {
            let mut request = request.clone();
            request.request_id = format!("recurring-{index}");
            let reservation = service
                .reserve_at(
                    &learner,
                    request,
                    chrono::DateTime::parse_from_rfc3339(instant)
                        .unwrap()
                        .timestamp(),
                )
                .await
                .unwrap();
            service
                .reconcile(ReconcileQuotaRequest {
                    reservation_id: reservation.id,
                    provider_id: "provider".into(),
                    model_id: "model".into(),
                    price_version_id: "price".into(),
                    actual: BTreeMap::from([
                        ("requests".into(), 1),
                        ("costMicros".into(), 200_000),
                    ]),
                })
                .await
                .unwrap();
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quota_definition_periods contract JOIN quota_definitions definition ON definition.id = contract.definition_id WHERE definition.metric = 'requests' AND definition.period = 'daily'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quota_definition_periods WHERE definition_id = 'root-cost'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            2
        );
    }

    #[tokio::test]
    async fn post_accounting_limit_change_creates_an_immutable_revision() {
        let (pool, service, learner, request) = quota_fixture(1_000_000).await;
        let old = service
            .reserve_at(
                &learner,
                request,
                chrono::DateTime::parse_from_rfc3339("2026-01-15T12:00:00Z")
                    .unwrap()
                    .timestamp(),
            )
            .await
            .unwrap();
        service
            .reconcile(ReconcileQuotaRequest {
                reservation_id: old.id.clone(),
                provider_id: "provider".into(),
                model_id: "model".into(),
                price_version_id: "price".into(),
                actual: BTreeMap::from([("requests".into(), 1), ("costMicros".into(), 200_000)]),
            })
            .await
            .unwrap();
        let revision = service
            .upsert_definition(
                &admin_principal(),
                "school",
                QuotaScopeKind::Group,
                "school",
                QuotaMetric::CostMicros,
                QuotaPeriod::Monthly,
                900_000,
                "revise-root-cost",
            )
            .await
            .unwrap();
        assert_ne!(revision.id, "root-cost");
        let mut next_request = ReserveQuotaRequest {
            request_id: "after-revision".into(),
            ..request_for_fixture()
        };
        next_request.amounts.insert("costMicros".into(), 100_000);
        let next = service
            .reserve_at(
                &learner,
                next_request,
                chrono::DateTime::parse_from_rfc3339("2026-02-15T12:00:00Z")
                    .unwrap()
                    .timestamp(),
            )
            .await
            .unwrap();
        service
            .reconcile(ReconcileQuotaRequest {
                reservation_id: next.id.clone(),
                provider_id: "provider".into(),
                model_id: "model".into(),
                price_version_id: "price".into(),
                actual: BTreeMap::from([("requests".into(), 1), ("costMicros".into(), 100_000)]),
            })
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT status FROM quota_definitions WHERE id = 'root-cost'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "superseded"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT definition_id FROM quota_reservation_periods WHERE reservation_id = ? AND metric = 'costMicros' AND definition_id IS NOT NULL")
                .bind(&old.id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "root-cost"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT definition_id FROM quota_reservation_periods WHERE reservation_id = ? AND metric = 'costMicros' AND definition_id IS NOT NULL")
                .bind(&next.id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            revision.id
        );
    }

    #[tokio::test]
    async fn finalized_calendar_rejects_forged_instances_and_contracts() {
        let (pool, _service, _learner, _request) = quota_fixture(1_000_000).await;
        assert!(sqlx::query("INSERT INTO school_quota_period_instances (root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at) VALUES ('school', 1, 'monthly', 123, 456)")
            .execute(&pool)
            .await
            .is_err());
        assert!(sqlx::query("INSERT INTO quota_definition_periods (definition_id, root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at, limit_value, created_at) VALUES ('root-cost', 'school', 1, 'monthly', 123, 456, 1000000, 1)")
            .execute(&pool)
            .await
            .is_err());
        let authoritative = sqlx::query("SELECT period_starts_at, period_ends_at FROM school_quota_period_instances WHERE root_group_id = 'school' AND calendar_version = 1 AND quota_period = 'monthly' ORDER BY period_starts_at LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(sqlx::query("INSERT INTO quota_definition_periods (definition_id, root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at, limit_value, created_at) VALUES ('root-cost', 'school', 1, 'monthly', ?, ?, 999999, 1)")
            .bind(authoritative.get::<i64, _>("period_starts_at"))
            .bind(authoritative.get::<i64, _>("period_ends_at"))
            .execute(&pool)
            .await
            .is_err());
        assert!(sqlx::query("INSERT INTO quota_definition_periods (definition_id, root_group_id, calendar_version, quota_period, period_starts_at, period_ends_at, limit_value, created_at) VALUES ('forged-revision', 'school', 1, 'monthly', ?, ?, 1000000, 1)")
            .bind(authoritative.get::<i64, _>("period_starts_at"))
            .bind(authoritative.get::<i64, _>("period_ends_at"))
            .execute(&pool)
            .await
            .is_err());
        assert!(sqlx::query(
            "UPDATE quota_definitions SET status = 'superseded' WHERE id = 'root-cost'"
        )
        .execute(&pool)
        .await
        .is_err());
    }

    async fn quota_fixture(cap: i64) -> (SqlitePool, QuotaService, Principal, ReserveQuotaRequest) {
        let path = std::env::temp_dir().join(format!("mlearn-quota-{}.db", Uuid::now_v7()));
        let options = crate::db::sqlite_connect_options(path.to_str().unwrap()).unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(12)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (id, kind, is_root) in [("admin", "admin", 1), ("learner", "learner", 0)] {
            sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, 1)")
                .bind(id).bind(format!("{id}@test.invalid")).bind(format!("{id}@test.invalid")).bind(id).bind(kind).bind(is_root).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('school', NULL, 'School', 'school', 'active', 1), ('class', 'school', 'Class', 'class', 'active', 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('admin-membership', 'school', 'admin', 'active', 1), ('learner-membership', 'class', 'learner', 'active', 1)").execute(&pool).await.unwrap();
        for capability in [
            Capability::LlmConfigure,
            Capability::AnalyticsView,
            Capability::PoliciesView,
            Capability::PoliciesEdit,
            Capability::PoliciesPublish,
        ] {
            sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('admin-membership', ?)").bind(capability.as_str()).execute(&pool).await.unwrap();
        }
        let service = QuotaService::new(pool.clone());
        service
            .configure_calendar(
                &admin_principal(),
                "school",
                "Europe/Zurich",
                chrono::DateTime::parse_from_rfc3339("2025-01-01T00:00:00Z")
                    .unwrap()
                    .timestamp(),
                chrono::DateTime::parse_from_rfc3339("2028-01-01T00:00:00Z")
                    .unwrap()
                    .timestamp(),
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, created_by_user_id, created_at, updated_at) VALUES ('root-cost', 'school', 'group', 'school', 'costMicros', 'monthly', ?, 'admin', 1, 1)").bind(cap).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_providers (id, group_id, name, provider_kind, base_url, status, created_by_user_id, created_at, updated_at) VALUES ('provider', 'class', 'Provider', 'openaiCompatible', 'https://provider.test/v1', 'active', 'admin', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_models (id, group_id, provider_id, model_key, upstream_model, status, created_by_user_id, created_at, updated_at) VALUES ('model', 'class', 'provider', 'balanced', 'model-v1', 'active', 'admin', 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO provider_price_versions (id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, idempotency_key, created_by_user_id, created_at) VALUES ('price', 'class', 'provider', 'model', 'CHF', 'perMillionTokens', 1, 1, 'price', 'admin', 1)").execute(&pool).await.unwrap();
        let document = serde_json::json!({"llm":{"enabled":true,"quotas":[{"metric":"costMicros","limit":cap,"period":"monthly","hard":true}]}}).to_string();
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('policy', 'school', ?, 'hash', 'compiled', 'admin', 'governed', '[]', 1)").bind(document).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('school', 'policy', 1)").execute(&pool).await.unwrap();
        let learner = Principal {
            user_id: "learner".into(),
            service_key_id: None,
            session_id: "learner-session".into(),
            device_id: "learner-device".into(),
            active_group_id: Some("class".into()),
            identity_type: IdentityType::Learner,
            is_root: false,
        };
        let request = request_for_fixture();
        (pool, service, learner, request)
    }

    fn request_for_fixture() -> ReserveQuotaRequest {
        ReserveQuotaRequest {
            request_id: "request".into(),
            active_group_id: "class".into(),
            provider_id: "provider".into(),
            model_id: "model".into(),
            price_version_id: "price".into(),
            amounts: BTreeMap::from([("requests".into(), 1), ("costMicros".into(), 200_000)]),
            expires_at: None,
        }
    }

    fn admin_principal() -> Principal {
        Principal {
            user_id: "admin".into(),
            service_key_id: None,
            session_id: "admin-session".into(),
            device_id: "admin-device".into(),
            active_group_id: Some("school".into()),
            identity_type: IdentityType::Admin,
            is_root: true,
        }
    }
}
