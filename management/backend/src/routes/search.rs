use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::{authorization::Capability, error::AppError, identity::Principal, state::AppState};

const DEFAULT_LIMIT: usize = 10;
const MAX_LIMIT: usize = 50;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchQuery {
    q: String,
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Vec<SearchResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub kind: String,
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub subtitle: String,
    pub href: String,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/search", get(search))
        .with_state(state)
}

async fn search(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, AppError> {
    let results = search_results(
        &state.db,
        &principal,
        &query.q,
        query.limit.unwrap_or(DEFAULT_LIMIT),
    )
    .await?;
    Ok(Json(SearchResponse { results }))
}

async fn search_results(
    pool: &SqlitePool,
    principal: &Principal,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, AppError> {
    let normalized = query.trim().to_lowercase();
    let length = normalized.chars().count();
    if !(2..=100).contains(&length) {
        return Err(AppError::BadRequest(
            "search query must contain between 2 and 100 characters".into(),
        ));
    }
    let pattern = format!("%{}%", escape_like(&normalized));
    let limit = limit.clamp(1, MAX_LIMIT);
    let mut results = search_users(pool, principal, &pattern).await?;
    results.extend(search_groups(pool, principal, &pattern).await?);
    results.extend(search_policies(pool, principal, &pattern).await?);
    results.truncate(limit);
    Ok(results)
}

async fn search_users(
    pool: &SqlitePool,
    principal: &Principal,
    pattern: &str,
) -> Result<Vec<SearchResult>, AppError> {
    let rows = sqlx::query(
        r#"WITH RECURSIVE roots(id) AS (
                SELECT membership.group_id
                FROM group_memberships membership
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                JOIN groups source ON source.id = membership.group_id
                WHERE ? IS NULL AND membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ? AND source.status != 'archived'
                UNION
                SELECT key.group_id
                FROM api_keys key
                JOIN api_key_capabilities capability ON capability.api_key_id = key.id
                JOIN groups source ON source.id = key.group_id
                WHERE key.id = ? AND key.status = 'active'
                  AND (key.expires_at IS NULL OR key.expires_at > unixepoch())
                  AND capability.capability = ? AND source.status != 'archived'
            ), subtree(id) AS (
                SELECT id FROM roots
                UNION
                SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            )
            SELECT user.id, user.display_name, user.email,
                   MIN(membership.group_id) AS group_id, MIN(groups.name) AS group_name
            FROM users user
            JOIN group_memberships membership ON membership.user_id = user.id
            JOIN subtree ON subtree.id = membership.group_id
            JOIN groups ON groups.id = membership.group_id
            WHERE membership.status = 'active'
              AND (lower(trim(user.display_name)) LIKE ? ESCAPE '\'
                   OR user.normalized_email LIKE ? ESCAPE '\')
            GROUP BY user.id, user.display_name, user.email
            ORDER BY lower(trim(user.display_name)), user.id"#,
    )
    .bind(&principal.service_key_id)
    .bind(&principal.user_id)
    .bind(Capability::MembersView.as_str())
    .bind(&principal.service_key_id)
    .bind(Capability::MembersView.as_str())
    .bind(pattern)
    .bind(pattern)
    .fetch_all(pool)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let group_id: String = row.get("group_id");
            SearchResult {
                kind: "user".into(),
                id: row.get("id"),
                group_id: group_id.clone(),
                title: row.get("display_name"),
                subtitle: row.get("email"),
                href: format!("/users?groupId={group_id}"),
            }
        })
        .collect())
}

async fn search_groups(
    pool: &SqlitePool,
    principal: &Principal,
    pattern: &str,
) -> Result<Vec<SearchResult>, AppError> {
    let rows = sqlx::query(
        r#"WITH RECURSIVE visible(id) AS (
                SELECT membership.group_id
                FROM group_memberships membership
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                JOIN groups source ON source.id = membership.group_id
                WHERE ? IS NULL AND membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ? AND source.status != 'archived'
                UNION
                SELECT key.group_id
                FROM api_keys key
                JOIN api_key_capabilities capability ON capability.api_key_id = key.id
                JOIN groups source ON source.id = key.group_id
                WHERE key.id = ? AND key.status = 'active'
                  AND (key.expires_at IS NULL OR key.expires_at > unixepoch())
                  AND capability.capability = ? AND source.status != 'archived'
                UNION
                SELECT child.id FROM groups child JOIN visible parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            )
            SELECT groups.id, groups.name, groups.slug
            FROM groups JOIN visible ON visible.id = groups.id
            WHERE lower(trim(groups.name)) LIKE ? ESCAPE '\'
               OR lower(trim(groups.slug)) LIKE ? ESCAPE '\'
            ORDER BY lower(trim(groups.name)), groups.id"#,
    )
    .bind(&principal.service_key_id)
    .bind(&principal.user_id)
    .bind(Capability::GroupView.as_str())
    .bind(&principal.service_key_id)
    .bind(Capability::GroupView.as_str())
    .bind(pattern)
    .bind(pattern)
    .fetch_all(pool)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            SearchResult {
                kind: "group".into(),
                id: id.clone(),
                group_id: id.clone(),
                title: row.get("name"),
                subtitle: row.get("slug"),
                href: format!("/groups?groupId={id}"),
            }
        })
        .collect())
}

async fn search_policies(
    pool: &SqlitePool,
    principal: &Principal,
    pattern: &str,
) -> Result<Vec<SearchResult>, AppError> {
    let rows = sqlx::query(
        r#"WITH RECURSIVE policy_roots(id) AS (
                SELECT membership.group_id
                FROM group_memberships membership
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                JOIN groups source ON source.id = membership.group_id
                WHERE ? IS NULL AND membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ? AND source.status != 'archived'
                UNION
                SELECT key.group_id
                FROM api_keys key
                JOIN api_key_capabilities capability ON capability.api_key_id = key.id
                JOIN groups source ON source.id = key.group_id
                WHERE key.id = ? AND key.status = 'active'
                  AND (key.expires_at IS NULL OR key.expires_at > unixepoch())
                  AND capability.capability = ? AND source.status != 'archived'
            ), policy_subtree(id) AS (
                SELECT id FROM policy_roots
                UNION
                SELECT child.id FROM groups child JOIN policy_subtree parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            ), visible_roots(id) AS (
                SELECT membership.group_id
                FROM group_memberships membership
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                JOIN groups source ON source.id = membership.group_id
                WHERE ? IS NULL AND membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ? AND source.status != 'archived'
                UNION
                SELECT key.group_id
                FROM api_keys key
                JOIN api_key_capabilities capability ON capability.api_key_id = key.id
                JOIN groups source ON source.id = key.group_id
                WHERE key.id = ? AND key.status = 'active'
                  AND (key.expires_at IS NULL OR key.expires_at > unixepoch())
                  AND capability.capability = ? AND source.status != 'archived'
            ), visible(id) AS (
                SELECT id FROM visible_roots
                UNION
                SELECT child.id FROM groups child JOIN visible parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            )
            SELECT policy.id, policy.group_id, policy.name, policy.description, groups.name AS group_name
            FROM policies policy
            JOIN policy_subtree ON policy_subtree.id = policy.group_id
            JOIN visible ON visible.id = policy.group_id
            JOIN groups ON groups.id = policy.group_id
            WHERE lower(trim(policy.name)) LIKE ? ESCAPE '\'
               OR lower(trim(policy.description)) LIKE ? ESCAPE '\'
            ORDER BY lower(trim(policy.name)), policy.id"#,
    )
    .bind(&principal.service_key_id)
    .bind(&principal.user_id)
    .bind(Capability::PoliciesView.as_str())
    .bind(&principal.service_key_id)
    .bind(Capability::PoliciesView.as_str())
    .bind(&principal.service_key_id)
    .bind(&principal.user_id)
    .bind(Capability::GroupView.as_str())
    .bind(&principal.service_key_id)
    .bind(Capability::GroupView.as_str())
    .bind(pattern)
    .bind(pattern)
    .fetch_all(pool)
    .await
    .map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let group_id: String = row.get("group_id");
            SearchResult {
                kind: "policy".into(),
                id: row.get("id"),
                group_id: group_id.clone(),
                title: row.get("name"),
                subtitle: row.get("group_name"),
                href: format!("/policies?groupId={group_id}"),
            }
        })
        .collect())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use crate::{groups::tests::GroupFixture, routes::search::search_results};

    #[tokio::test]
    async fn search_scopes_users_groups_and_policies_to_the_authorized_subtree() {
        let fixture = GroupFixture::german_tree().await;
        sqlx::query(
            "INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', 'policies.view')",
        )
        .execute(&fixture.pool)
        .await
        .unwrap();
        insert_user(
            &fixture.pool,
            "visible-user",
            "German visible learner",
            "visible@example.test",
        )
        .await;
        insert_user(
            &fixture.pool,
            "hidden-user",
            "German hidden learner",
            "hidden@example.test",
        )
        .await;
        insert_membership(
            &fixture.pool,
            "visible-user-membership",
            &fixture.project_1,
            "visible-user",
        )
        .await;
        insert_membership(
            &fixture.pool,
            "hidden-user-membership",
            &fixture.german_b,
            "hidden-user",
        )
        .await;
        insert_policy(
            &fixture.pool,
            "visible-policy",
            &fixture.german_a,
            "German visible policy",
            &fixture.german_a_teacher.user_id,
        )
        .await;
        insert_policy(
            &fixture.pool,
            "hidden-policy",
            &fixture.german_b,
            "German hidden policy",
            &fixture.german_a_teacher.user_id,
        )
        .await;

        let results = search_results(&fixture.pool, &fixture.german_a_teacher, "german", 10)
            .await
            .unwrap();

        assert!(results
            .iter()
            .any(|result| result.id == "visible-user" && result.kind == "user"));
        assert!(results
            .iter()
            .any(|result| result.id == "visible-policy" && result.kind == "policy"));
        assert!(results
            .iter()
            .any(|result| result.id == fixture.german_a && result.kind == "group"));
        assert!(!results.iter().any(|result| result.id == "hidden-user"));
        assert!(!results.iter().any(|result| result.id == "hidden-policy"));
        assert!(!results
            .iter()
            .any(|result| result.group_id == fixture.german_b));
        assert!(results.iter().all(|result| !result.href.is_empty()));
    }

    #[tokio::test]
    async fn search_rejects_queries_outside_the_bounded_length() {
        let fixture = GroupFixture::german_tree().await;

        let short = search_results(&fixture.pool, &fixture.german_a_teacher, "a", 10).await;
        let long = search_results(
            &fixture.pool,
            &fixture.german_a_teacher,
            &"a".repeat(101),
            10,
        )
        .await;

        assert!(short.is_err());
        assert!(long.is_err());
    }

    #[tokio::test]
    async fn search_escapes_like_wildcards_in_the_query() {
        let fixture = GroupFixture::german_tree().await;
        insert_user(
            &fixture.pool,
            "wild-user",
            "A% learner",
            "wild@example.test",
        )
        .await;
        insert_membership(
            &fixture.pool,
            "wild-user-membership",
            &fixture.project_1,
            "wild-user",
        )
        .await;

        let results = search_results(&fixture.pool, &fixture.german_a_teacher, "a%", 10)
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "wild-user");
    }

    async fn insert_user(pool: &sqlx::SqlitePool, id: &str, display_name: &str, email: &str) {
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'learner', 0, 1, 1)")
            .bind(id)
            .bind(email)
            .bind(email)
            .bind(display_name)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_membership(pool: &sqlx::SqlitePool, id: &str, group_id: &str, user_id: &str) {
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES (?, ?, ?, 'active', 1)")
            .bind(id)
            .bind(group_id)
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_policy(
        pool: &sqlx::SqlitePool,
        id: &str,
        group_id: &str,
        name: &str,
        author_id: &str,
    ) {
        sqlx::query("INSERT INTO policies (id, group_id, name, description, enabled, priority, created_by_user_id, created_at, updated_at, revision) VALUES (?, ?, ?, '', 1, 0, ?, 1, 1, 1)")
            .bind(id)
            .bind(group_id)
            .bind(name)
            .bind(author_id)
            .execute(pool)
            .await
            .unwrap();
    }
}
