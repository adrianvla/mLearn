use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

use crate::{
    error::AppError,
    identity::Principal,
    policy::{
        compiler::compile_in_transaction, policy_setting_registry, signing::PolicyPublicKey,
        CompiledPolicy, CreatePolicy, DraftValidation, PolicyCollection, PolicyDraft,
        PolicyHistoryPage, PolicyService, PolicySummary, PolicyVersion,
    },
    state::AppState,
};

#[derive(Deserialize)]
struct PublishRequest {
    summary: String,
    #[serde(default)]
    validated_document_hash: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDraftRequest {
    document: Value,
    expected_document_hash: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    cursor: Option<String>,
    limit: Option<usize>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/api/groups/{group_id}/policies",
            get(list_policies).post(create_policy),
        )
        .route(
            "/api/policies/{policy_id}/draft",
            get(get_policy_draft).put(save_policy_draft),
        )
        .route("/api/policies/{policy_id}/history", get(policy_history))
        .route(
            "/api/policies/{policy_id}/validate",
            post(validate_policy_draft),
        )
        .route("/api/policies/{policy_id}/publish", post(publish_policy))
        .route("/api/policy-registry", get(policy_registry))
        .route(
            "/api/groups/{group_id}/policy/draft",
            get(get_draft).put(save_draft),
        )
        .route(
            "/api/groups/{group_id}/policy/validate",
            post(validate_draft),
        )
        .route("/api/groups/{group_id}/policy/publish", post(publish))
        .route("/api/groups/{group_id}/policy/history", get(history))
        .route("/api/groups/{group_id}/policy/effective", get(effective))
        .route("/api/policy/me", get(effective_for_session))
        .route("/api/policy/public-key", get(public_key))
        .with_state(state)
}

async fn policy_registry(
    principal: Principal,
) -> Result<Json<Vec<crate::policy::PolicySettingDescriptor>>, AppError> {
    if principal.service_key_id.is_some() {
        return Err(AppError::Forbidden(
            "policy registry requires a human session".into(),
        ));
    }
    Ok(Json(policy_setting_registry()))
}

async fn list_policies(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<PolicyCollection>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .list_policies(&principal, &group_id)
            .await?,
    ))
}

async fn create_policy(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Json(input): Json<CreatePolicy>,
) -> Result<Json<PolicySummary>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .create_policy(&principal, &group_id, input)
            .await?,
    ))
}

async fn get_policy_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(policy_id): Path<String>,
) -> Result<Json<Option<PolicyDraft>>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .get_policy_draft(&principal, &policy_id)
            .await?,
    ))
}

async fn policy_history(
    State(state): State<AppState>,
    principal: Principal,
    Path(policy_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<PolicyHistoryPage>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .history_for_policy(
                &principal,
                &policy_id,
                query.cursor.as_deref(),
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

async fn save_policy_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(policy_id): Path<String>,
    Json(request): Json<SaveDraftRequest>,
) -> Result<Json<PolicyDraft>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .save_policy_draft(
                &principal,
                &policy_id,
                request.document,
                request.expected_document_hash.as_deref(),
            )
            .await?,
    ))
}

async fn validate_policy_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(policy_id): Path<String>,
) -> Result<Json<DraftValidation>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .validate_policy_draft(&principal, &policy_id)
            .await?,
    ))
}

async fn publish_policy(
    State(state): State<AppState>,
    principal: Principal,
    Path(policy_id): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<PolicyVersion>, AppError> {
    let hash = request
        .validated_document_hash
        .ok_or_else(|| AppError::BadRequest("validatedDocumentHash is required".into()))?;
    Ok(Json(
        PolicyService::new(state.db)
            .publish_policy(&principal, &policy_id, &request.summary, &hash)
            .await?,
    ))
}

const POLICY_SNAPSHOT_LIFETIME: Duration = Duration::minutes(15);

async fn effective_for_session(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<Json<crate::policy::PolicyDocument>, AppError> {
    if principal.service_key_id.is_some() {
        return Err(AppError::Forbidden(
            "session policy snapshots require a human actor".into(),
        ));
    }
    let group_id = principal
        .active_group_id
        .as_deref()
        .ok_or_else(|| AppError::Forbidden("an active group session is required".into()))?;
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    let eligible: i64 = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM group_memberships membership
            JOIN groups ON groups.id = membership.group_id
            WHERE membership.group_id = ? AND membership.user_id = ?
              AND membership.status = 'active' AND groups.status != 'archived'
        )",
    )
    .bind(group_id)
    .bind(&principal.user_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(database_error)?;
    if eligible != 1 {
        return Err(AppError::Forbidden(
            "active group membership is required".into(),
        ));
    }
    let mut snapshot = compile_in_transaction(&mut transaction, group_id)
        .await?
        .document;
    transaction.commit().await.map_err(database_error)?;

    let issued_at = OffsetDateTime::now_utc();
    snapshot.issued_at = issued_at.format(&Rfc3339).map_err(|error| {
        AppError::Internal(format!("policy timestamp formatting failed: {error}"))
    })?;
    snapshot.expires_at = (issued_at + POLICY_SNAPSHOT_LIFETIME)
        .format(&Rfc3339)
        .map_err(|error| {
            AppError::Internal(format!("policy timestamp formatting failed: {error}"))
        })?;
    Ok(Json(state.policy_signer.sign_snapshot(snapshot)?))
}

async fn public_key(State(state): State<AppState>) -> Json<PolicyPublicKey> {
    Json(state.policy_signer.public_key())
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

async fn get_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<Option<PolicyDraft>>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .get_draft(&principal, &group_id)
            .await?,
    ))
}

async fn save_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Json(document): Json<Value>,
) -> Result<Json<PolicyDraft>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .save_draft(&principal, &group_id, document)
            .await?,
    ))
}

async fn validate_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<DraftValidation>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .validate_draft(&principal, &group_id)
            .await?,
    ))
}

async fn publish(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<PolicyVersion>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .publish(&principal, &group_id, &request.summary)
            .await?,
    ))
}

async fn history(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<PolicyHistoryPage>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .history(
                &principal,
                &group_id,
                query.cursor.as_deref(),
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

async fn effective(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<CompiledPolicy>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .effective_for_group(&principal, &group_id)
            .await?,
    ))
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
        api_keys::ApiKeyService, auth::hash_token, authorization::Capability, config::Config,
        groups::tests::GroupFixture, policy::PolicyService, state::AppState,
    };

    async fn policy_app(fixture: &GroupFixture) -> (Router, String) {
        for capability in [
            Capability::PoliciesView,
            Capability::PoliciesEdit,
            Capability::PoliciesPublish,
        ] {
            sqlx::query(
                "INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)",
            )
            .bind(capability.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
        }
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("policy-route-secret"));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, fixture.pool.clone());
        let session = state
            .identity
            .issue_session(
                &fixture.german_a_teacher.user_id,
                None,
                Some(&fixture.german_a),
            )
            .await
            .unwrap();
        (
            super::router(state.clone()).with_state(state),
            session.access_token,
        )
    }

    #[tokio::test]
    async fn unauthorized_sibling_effective_query_returns_forbidden() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;

        let response = app
            .oneshot(
                Request::get(format!("/api/groups/{}/policy/effective", fixture.german_b))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn view_service_key_reads_effective_policy_but_cannot_mutate_draft() {
        let fixture = GroupFixture::german_tree().await;
        let (app, _) = policy_app(&fixture).await;
        let key = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::PoliciesView],
                None,
            )
            .await
            .unwrap();

        let read = app
            .clone()
            .oneshot(
                Request::get(format!("/api/groups/{}/policy/effective", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(read.status(), StatusCode::OK);

        let write = app
            .oneshot(
                Request::put(format!("/api/groups/{}/policy/draft", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({"features": {}}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(write.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn history_route_returns_cursor_page_shape() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        for summary in ["first", "second"] {
            service
                .publish(&fixture.german_a_teacher, &fixture.german_a, summary)
                .await
                .unwrap();
        }

        let response = app
            .oneshot(
                Request::get(format!(
                    "/api/groups/{}/policy/history?limit=1",
                    fixture.german_a
                ))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["items"].as_array().unwrap().len(), 1);
        assert!(body["items"][0]["compiledHash"].is_string());
        assert!(body["nextCursor"].is_string());
    }

    #[tokio::test]
    async fn current_session_receives_a_signed_policy_for_its_active_group() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"settings":{"subtitle_font_size":{"value":1e-7,"locked":true}}}),
            )
            .await
            .unwrap();
        service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "numeric JCS policy",
            )
            .await
            .unwrap();

        let public_key_response = app
            .clone()
            .oneshot(
                Request::get("/api/policy/public-key")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let public_key_body: Value = serde_json::from_slice(
            &to_bytes(public_key_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/policy/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["activeGroupId"], fixture.german_a);
        assert!(!body["keyId"].as_str().unwrap().is_empty());
        assert_eq!(body["keyId"], public_key_body["keyId"]);
        assert!(!body["signature"].as_str().unwrap().is_empty());
        assert_eq!(body["settings"]["subtitle_font_size"]["value"], json!(1e-7));
        let issued_at = time::OffsetDateTime::parse(
            body["issuedAt"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .unwrap();
        let expires_at = time::OffsetDateTime::parse(
            body["expiresAt"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .unwrap();
        assert!(expires_at > issued_at);
        assert!(expires_at - issued_at <= time::Duration::minutes(15));

        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use ed25519_dalek::{Signature, Verifier, VerifyingKey};
        let public_key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(public_key_body["publicKey"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let signature = Signature::from_slice(
            &URL_SAFE_NO_PAD
                .decode(body["signature"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let mut unsigned = body;
        unsigned.as_object_mut().unwrap().remove("signature");
        let canonical = serde_json_canonicalizer::to_vec(&unsigned).unwrap();
        assert!(VerifyingKey::from_bytes(&public_key)
            .unwrap()
            .verify(&canonical, &signature)
            .is_ok());
    }

    #[tokio::test]
    async fn public_key_is_available_without_authentication() {
        let fixture = GroupFixture::german_tree().await;
        let (app, _) = policy_app(&fixture).await;

        let response = app
            .oneshot(
                Request::get("/api/policy/public-key")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["algorithm"], "Ed25519");
        assert!(!body["keyId"].as_str().unwrap().is_empty());
        assert!(!body["publicKey"].as_str().unwrap().is_empty());
        assert!(body.get("privateKey").is_none());
    }

    #[tokio::test]
    async fn removed_membership_cannot_receive_a_new_policy_snapshot() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        sqlx::query("UPDATE group_memberships SET status = 'archived' WHERE id = 'membership-a'")
            .execute(&fixture.pool)
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/policy/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn archived_active_group_cannot_receive_a_new_policy_snapshot() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        sqlx::query("UPDATE groups SET status = 'archived' WHERE id = ?")
            .bind(&fixture.german_a)
            .execute(&fixture.pool)
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/policy/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn service_key_cannot_use_the_session_policy_route() {
        let fixture = GroupFixture::german_tree().await;
        let (app, _) = policy_app(&fixture).await;
        let key = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::PoliciesView],
                None,
            )
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/policy/me")
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn legacy_active_policy_with_unsafe_integer_cannot_be_signed() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        let legacy_document =
            r#"{"settings":{"subtitle_font_size":{"value":9007199254740992,"locked":true}}}"#;
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('legacy-unsafe-number', ?, ?, 'legacy-document', 'legacy-compiled', ?, 'legacy unsafe number', '[]', 1)")
            .bind(&fixture.german_a)
            .bind(legacy_document)
            .bind(&fixture.german_a_teacher.user_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES (?, 'legacy-unsafe-number', 1)")
            .bind(&fixture.german_a)
            .execute(&fixture.pool)
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/policy/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(body.get("signature").is_none());
    }
}
