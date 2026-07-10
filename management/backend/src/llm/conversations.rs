use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    authorization::{AuthorizationService, Capability},
    crypto::{EncryptedSecret, SecretCipher},
    error::AppError,
    identity::{IdentityType, Principal},
    llm::provider::{GatewayMessage, NormalizedProviderRequest, MAX_MESSAGE_BYTES},
};

const MAX_CAPTURE_BYTES: usize = MAX_MESSAGE_BYTES;
const DEFAULT_RETENTION_SECONDS: i64 = 90 * 24 * 60 * 60;

#[derive(Clone)]
pub struct ConversationService {
    pool: SqlitePool,
    cipher: SecretCipher,
    retention_seconds: i64,
}

pub struct ConversationRecorder {
    service: ConversationService,
    pub conversation_id: String,
    pub request_id: String,
    reservation_id: String,
    started_at_ms: i64,
    response: Zeroizing<Vec<u8>>,
    response_tool_data: Zeroizing<Vec<u8>>,
    truncated: bool,
}

#[derive(Clone)]
pub(crate) struct BeginConversation<'a> {
    pub reservation_id: &'a str,
    pub learner_user_id: &'a str,
    pub group_id: &'a str,
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub price_version_id: &'a str,
    pub policy_version_id: Option<&'a str>,
    pub(crate) request: &'a NormalizedProviderRequest,
}

#[derive(Clone, Debug)]
pub struct FinalConversation {
    pub status: &'static str,
    pub usage_quality: &'static str,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_micros: i64,
    pub error_code: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub group_id: String,
    pub learner_user_id: String,
    pub status: String,
    pub created_at: i64,
    pub provider_id: String,
    pub model_id: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_micros: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    pub sequence: i64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub summary: ConversationSummary,
    pub messages: Vec<ConversationMessage>,
}

pub struct ConversationFilter<'a> {
    pub learner_user_id: Option<&'a str>,
    pub provider_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub status: Option<&'a str>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub policy_blocked: Option<bool>,
}

impl ConversationService {
    pub fn new(pool: SqlitePool, cipher: SecretCipher) -> Self {
        Self {
            pool,
            cipher,
            retention_seconds: DEFAULT_RETENTION_SECONDS,
        }
    }

    pub fn with_retention_days(pool: SqlitePool, cipher: SecretCipher, days: u16) -> Self {
        Self {
            pool,
            cipher,
            retention_seconds: i64::from(days) * 24 * 60 * 60,
        }
    }

    pub(crate) async fn begin(
        &self,
        input: BeginConversation<'_>,
    ) -> Result<ConversationRecorder, AppError> {
        let now = now();
        let conversation_id = Uuid::now_v7().to_string();
        let request_id = Uuid::now_v7().to_string();
        let retained_until = now
            .checked_add(self.retention_seconds)
            .ok_or_else(|| AppError::Internal("conversation retention overflow".into()))?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        self.redact_expired_in_transaction(&mut tx, now).await?;
        sqlx::query("INSERT INTO conversations (id, owner_group_id, learner_user_id, created_at, updated_at, retained_until, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
            .bind(&conversation_id).bind(input.group_id).bind(input.learner_user_id).bind(now).bind(now).bind(retained_until).execute(&mut *tx).await.map_err(db)?;
        sqlx::query("INSERT INTO llm_requests (id, conversation_id, reservation_id, provider_id, model_id, price_version_id, policy_version_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
            .bind(&request_id).bind(&conversation_id).bind(input.reservation_id).bind(input.provider_id).bind(input.model_id).bind(input.price_version_id).bind(input.policy_version_id).bind(now).execute(&mut *tx).await.map_err(db)?;
        for (sequence, message) in input.request.messages.iter().enumerate() {
            insert_message(
                &self.cipher,
                &mut tx,
                &conversation_id,
                &request_id,
                sequence as i64,
                message,
                None,
                false,
                now,
            )
            .await?;
        }
        tx.commit().await.map_err(db)?;
        Ok(ConversationRecorder {
            service: self.clone(),
            conversation_id,
            request_id,
            reservation_id: input.reservation_id.into(),
            started_at_ms: unix_millis(),
            response: Zeroizing::new(Vec::new()),
            response_tool_data: Zeroizing::new(Vec::new()),
            truncated: false,
        })
    }

    async fn redact_expired_in_transaction(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        timestamp: i64,
    ) -> Result<u64, AppError> {
        let changed = sqlx::query("UPDATE conversation_messages SET encrypted_content = NULL, encrypted_tool_data = NULL, retained = 0 WHERE retained = 1 AND conversation_id IN (SELECT id FROM conversations WHERE retained_until <= ?)")
            .bind(timestamp).execute(&mut **tx).await.map_err(db)?.rows_affected();
        Ok(changed)
    }

    pub async fn maintain_retention(&self, principal: &Principal) -> Result<u64, AppError> {
        if !principal.is_root {
            return Err(AppError::Forbidden("root access required".into()));
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        let changed = self.redact_expired_in_transaction(&mut tx, now()).await?;
        if changed > 0 {
            let root_group: Option<String> =
                sqlx::query_scalar("SELECT id FROM groups WHERE parent_id IS NULL")
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(db)?;
            sqlx::query("INSERT INTO audit_events (id,actor_user_id,action,target_type,target_id,metadata_json,created_at,authorized_group_id,request_id) VALUES (?,?,'conversations.retention_redacted','conversation_retention',NULL,?,?,?,NULL)")
                .bind(Uuid::now_v7().to_string()).bind(&principal.user_id)
                .bind(format!("{{\"redactedMessages\":{changed}}}")).bind(now()).bind(root_group)
                .execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        Ok(changed)
    }

    pub async fn list(
        &self,
        principal: &Principal,
        group_id: &str,
        cursor: Option<i64>,
        limit: usize,
        filter: ConversationFilter<'_>,
    ) -> Result<Vec<ConversationSummary>, AppError> {
        if limit == 0 || limit > 100 {
            return Err(AppError::BadRequest("limit must be 1..100".into()));
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        authorize_read(
            &AuthorizationService::new(self.pool.clone()),
            &mut tx,
            principal,
            group_id,
        )
        .await?;
        let learner_only = i64::from(principal.identity_type == IdentityType::Learner);
        let policy_blocked = filter.policy_blocked.map(i64::from);
        let rows = sqlx::query("WITH RECURSIVE subtree(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN subtree s ON g.parent_id=s.id) SELECT c.id,c.owner_group_id,c.learner_user_id,c.status,c.created_at,r.provider_id,r.model_id,r.input_tokens,r.output_tokens,r.cost_micros FROM conversations c JOIN subtree s ON s.id=c.owner_group_id JOIN llm_requests r ON r.conversation_id=c.id WHERE c.created_at < ? AND (? = 0 OR c.learner_user_id = ?) AND (? IS NULL OR c.learner_user_id = ?) AND (? IS NULL OR r.provider_id = ?) AND (? IS NULL OR r.model_id = ?) AND (? IS NULL OR r.status = ?) AND (? IS NULL OR c.created_at >= ?) AND (? IS NULL OR c.created_at < ?) AND (? IS NULL OR (r.error_code = 'policy_denied') = ?) ORDER BY c.created_at DESC,c.id DESC LIMIT ?")
            .bind(group_id).bind(cursor.unwrap_or(i64::MAX)).bind(learner_only).bind(&principal.user_id)
            .bind(filter.learner_user_id).bind(filter.learner_user_id).bind(filter.provider_id).bind(filter.provider_id)
            .bind(filter.model_id).bind(filter.model_id).bind(filter.status).bind(filter.status)
            .bind(filter.from).bind(filter.from).bind(filter.to).bind(filter.to).bind(policy_blocked).bind(policy_blocked)
            .bind(limit as i64).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(rows.into_iter().map(summary).collect())
    }

    pub async fn get(
        &self,
        principal: &Principal,
        id: &str,
    ) -> Result<ConversationDetail, AppError> {
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        let row = sqlx::query("SELECT c.id,c.owner_group_id,c.learner_user_id,c.status,c.created_at,r.provider_id,r.model_id,r.input_tokens,r.output_tokens,r.cost_micros,r.id request_id FROM conversations c JOIN llm_requests r ON r.conversation_id=c.id WHERE c.id=?").bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or_else(|| AppError::BadRequest("conversation not found".into()))?;
        let group_id: String = row.get("owner_group_id");
        authorize_read(
            &AuthorizationService::new(self.pool.clone()),
            &mut tx,
            principal,
            &group_id,
        )
        .await?;
        if principal.identity_type == IdentityType::Learner
            && row.get::<String, _>("learner_user_id") != principal.user_id
        {
            return Err(AppError::Forbidden(
                "learner conversation access denied".into(),
            ));
        }
        let request_id: String = row.get("request_id");
        let message_rows = sqlx::query("SELECT id,sequence,role,encrypted_content,truncated,retained FROM conversation_messages WHERE request_id=? ORDER BY sequence").bind(&request_id).fetch_all(&mut *tx).await.map_err(db)?;
        let mut messages = Vec::with_capacity(message_rows.len());
        for message in message_rows {
            if message.get::<i64, _>("retained") == 0 {
                continue;
            }
            let message_id: String = message.get("id");
            let sequence: i64 = message.get("sequence");
            let role: String = message.get("role");
            let envelope: String = message.get("encrypted_content");
            let aad = message_aad(id, &request_id, &message_id, &role, sequence);
            let encrypted = EncryptedSecret::parse(envelope)?;
            let plaintext = self.cipher.decrypt(&encrypted, aad.as_bytes())?;
            let content = String::from_utf8(plaintext.to_vec())
                .map_err(|_| AppError::Internal("stored conversation content is invalid".into()))?;
            messages.push(ConversationMessage {
                role,
                content,
                sequence,
                truncated: message.get::<i64, _>("truncated") == 1,
            });
        }
        let summary = summary(row);
        tx.commit().await.map_err(db)?;
        Ok(ConversationDetail { summary, messages })
    }
}

impl ConversationRecorder {
    pub fn record_delta(&mut self, delta: &str) {
        let remaining = MAX_CAPTURE_BYTES.saturating_sub(self.response.len());
        if delta.len() <= remaining {
            self.response.extend_from_slice(delta.as_bytes());
        } else {
            let mut boundary = remaining.min(delta.len());
            while boundary > 0 && !delta.is_char_boundary(boundary) {
                boundary -= 1;
            }
            self.response
                .extend_from_slice(&delta.as_bytes()[..boundary]);
            self.truncated = true;
        }
    }
    pub fn record_tool_delta(&mut self, delta: &str) {
        let remaining = MAX_CAPTURE_BYTES.saturating_sub(self.response_tool_data.len());
        let mut boundary = remaining.min(delta.len());
        while boundary > 0 && !delta.is_char_boundary(boundary) {
            boundary -= 1;
        }
        self.response_tool_data
            .extend_from_slice(&delta.as_bytes()[..boundary]);
        if boundary < delta.len() {
            self.truncated = true;
        }
    }
    pub fn final_record(
        &self,
        usage_quality: &'static str,
        amounts: &BTreeMap<String, i64>,
        error_code: Option<&'static str>,
    ) -> FinalConversation {
        FinalConversation {
            status: if error_code.is_some() {
                "failed"
            } else if self.truncated {
                "truncated"
            } else {
                "completed"
            },
            usage_quality,
            input_tokens: amounts["inputTokens"],
            output_tokens: amounts["outputTokens"],
            cost_micros: amounts["costMicros"],
            error_code,
        }
    }
    pub(crate) async fn finalize_in_transaction(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        final_record: &FinalConversation,
    ) -> Result<(), AppError> {
        let now = now();
        let sequence: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sequence),-1)+1 FROM conversation_messages WHERE request_id=?",
        )
        .bind(&self.request_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
        let msg = GatewayMessage {
            role: "assistant".into(),
            content: String::from_utf8_lossy(&self.response).into_owned(),
            tool_calls: None,
            tool_call_id: None,
        };
        insert_message(
            &self.service.cipher,
            tx,
            &self.conversation_id,
            &self.request_id,
            sequence,
            &msg,
            (!self.response_tool_data.is_empty()).then_some(self.response_tool_data.as_slice()),
            self.truncated,
            now,
        )
        .await?;
        let latency = unix_millis().saturating_sub(self.started_at_ms);
        let updated=sqlx::query("UPDATE llm_requests SET status=?,usage_quality=?,input_tokens=?,output_tokens=?,cost_micros=?,latency_ms=?,error_code=?,completed_at=? WHERE id=? AND reservation_id=? AND status='pending'")
            .bind(final_record.status).bind(final_record.usage_quality).bind(final_record.input_tokens).bind(final_record.output_tokens).bind(final_record.cost_micros).bind(latency).bind(final_record.error_code).bind(now).bind(&self.request_id).bind(&self.reservation_id).execute(&mut **tx).await.map_err(db)?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(
                "conversation request was already finalized".into(),
            ));
        }
        sqlx::query(
            "UPDATE conversations SET status=?,updated_at=? WHERE id=? AND status='pending'",
        )
        .bind(final_record.status)
        .bind(now)
        .bind(&self.conversation_id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
        Ok(())
    }
}

async fn insert_message(
    cipher: &SecretCipher,
    tx: &mut Transaction<'_, Sqlite>,
    conversation_id: &str,
    request_id: &str,
    sequence: i64,
    message: &GatewayMessage,
    raw_tool_data: Option<&[u8]>,
    truncated: bool,
    created_at: i64,
) -> Result<(), AppError> {
    if message.content.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::BadRequest("message content is too large".into()));
    }
    let id = Uuid::now_v7().to_string();
    let aad = message_aad(conversation_id, request_id, &id, &message.role, sequence);
    let encrypted = cipher.encrypt(message.content.as_bytes(), aad.as_bytes())?;
    let structured_tool_data;
    let tool_bytes = if let Some(raw) = raw_tool_data {
        Some(raw)
    } else if message.tool_calls.is_some() || message.tool_call_id.is_some() {
        structured_tool_data = Zeroizing::new(
            serde_json::to_vec(&(message.tool_calls.as_ref(), message.tool_call_id.as_ref()))
                .map_err(|_| AppError::BadRequest("tool data is invalid".into()))?,
        );
        Some(structured_tool_data.as_slice())
    } else {
        None
    };
    let tool_data = tool_bytes
        .map(|bytes| cipher.encrypt(bytes, aad.replace("content", "tools").as_bytes()))
        .transpose()?;
    sqlx::query("INSERT INTO conversation_messages(id,conversation_id,request_id,sequence,role,encrypted_content,encrypted_tool_data,content_bytes,truncated,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(id).bind(conversation_id).bind(request_id).bind(sequence).bind(&message.role).bind(encrypted.as_persisted()).bind(tool_data.as_ref().map(EncryptedSecret::as_persisted)).bind(message.content.len() as i64).bind(i64::from(truncated)).bind(created_at).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
fn message_aad(c: &str, r: &str, m: &str, role: &str, seq: i64) -> String {
    format!("mlearn:conversation:v1:conversation={c}:request={r}:message={m}:role={role}:sequence={seq}:content")
}
async fn authorize_read(
    authz: &AuthorizationService,
    tx: &mut Transaction<'_, Sqlite>,
    principal: &Principal,
    group_id: &str,
) -> Result<(), AppError> {
    if principal.identity_type == IdentityType::Learner {
        if principal.service_key_id.is_none()
            && principal.active_group_id.as_deref() == Some(group_id)
        {
            return Ok(());
        }
        return Err(AppError::Forbidden(
            "learner conversation access denied".into(),
        ));
    }
    authz
        .require_in_transaction(tx, principal, group_id, Capability::ConversationsView)
        .await
}
fn summary(row: sqlx::sqlite::SqliteRow) -> ConversationSummary {
    ConversationSummary {
        id: row.get("id"),
        group_id: row.get("owner_group_id"),
        learner_user_id: row.get("learner_user_id"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        provider_id: row.get("provider_id"),
        model_id: row.get("model_id"),
        input_tokens: row.get("input_tokens"),
        output_tokens: row.get("output_tokens"),
        cost_micros: row.get("cost_micros"),
    }
}
fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}
fn unix_millis() -> i64 {
    time::OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .saturating_div(1_000_000) as i64
}
fn db(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("conversation database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
        Executor,
    };
    use std::{fs, str::FromStr};

    #[test]
    fn message_aad_binds_every_identity_dimension_and_randomizes_ciphertext() {
        let cipher = SecretCipher::from_key([42; 32]);
        let aad = message_aad("conversation-a", "request-a", "message-a", "user", 0);
        let first = cipher
            .encrypt(b"private learner prompt", aad.as_bytes())
            .unwrap();
        let second = cipher
            .encrypt(b"private learner prompt", aad.as_bytes())
            .unwrap();
        assert_ne!(first.as_persisted(), second.as_persisted());
        assert!(!first.as_persisted().contains("private learner prompt"));
        for changed in [
            message_aad("conversation-b", "request-a", "message-a", "user", 0),
            message_aad("conversation-a", "request-b", "message-a", "user", 0),
            message_aad("conversation-a", "request-a", "message-b", "user", 0),
            message_aad("conversation-a", "request-a", "message-a", "assistant", 0),
            message_aad("conversation-a", "request-a", "message-a", "user", 1),
        ] {
            assert!(cipher.decrypt(&first, changed.as_bytes()).is_err());
        }
    }

    #[tokio::test]
    async fn streaming_capture_is_bounded_and_marks_truncation() {
        let service = ConversationService::new(
            sqlx::sqlite::SqlitePoolOptions::new()
                .connect_lazy("sqlite::memory:")
                .unwrap(),
            SecretCipher::from_key([1; 32]),
        );
        let mut recorder = ConversationRecorder {
            service,
            conversation_id: "c".into(),
            request_id: "r".into(),
            reservation_id: "q".into(),
            started_at_ms: 0,
            response: Zeroizing::new(Vec::new()),
            response_tool_data: Zeroizing::new(Vec::new()),
            truncated: false,
        };
        recorder.record_delta(&"x".repeat(MAX_CAPTURE_BYTES + 1));
        assert_eq!(recorder.response.len(), MAX_CAPTURE_BYTES);
        assert!(recorder.truncated);
    }

    #[tokio::test]
    async fn plaintext_never_reaches_database_or_wal_bytes() {
        let path = std::env::temp_dir().join(format!("mlearn-conversation-{}.db", Uuid::now_v7()));
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .unwrap()
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        pool.execute("CREATE TABLE encrypted_messages(value TEXT NOT NULL)")
            .await
            .unwrap();
        let cipher = SecretCipher::from_key([8; 32]);
        let plaintext = "unique-private-prompt-never-persist";
        let encrypted = cipher.encrypt(plaintext.as_bytes(), b"bound-row").unwrap();
        sqlx::query("INSERT INTO encrypted_messages(value) VALUES (?)")
            .bind(encrypted.as_persisted())
            .execute(&pool)
            .await
            .unwrap();
        for candidate in [
            path.clone(),
            std::path::PathBuf::from(format!("{}-wal", path.display())),
        ] {
            if let Ok(bytes) = fs::read(&candidate) {
                assert!(!bytes
                    .windows(plaintext.len())
                    .any(|window| window == plaintext.as_bytes()));
            }
        }
        pool.close().await;
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }
}
