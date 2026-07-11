use time::OffsetDateTime;

use super::ProvisioningService;
use crate::{
    authorization::Capability, error::AppError, groups::tests::GroupFixture, identity::IdentityType,
};

async fn insert_existing_user(pool: &sqlx::SqlitePool, group_id: &str, suffix: &str) {
    let user_id = format!("global-user-{suffix}");
    let email = format!("global-{suffix}@example.test");
    sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, 'Original', 'active', 'learner', 0, 1, 1)")
        .bind(&user_id).bind(&email).bind(&email).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES (?, ?, ?, 'active', 1)")
        .bind(format!("global-membership-{suffix}")).bind(group_id).bind(user_id).execute(pool).await.unwrap();
}

async fn insert_ambiguous_slug_tree(pool: &sqlx::SqlitePool, parent_id: &str) {
    for (id, parent, slug) in [
        ("branch-one", parent_id, "branch-one"),
        ("branch-two", parent_id, "branch-two"),
        ("cohort-one", "branch-one", "cohort"),
        ("cohort-two", "branch-two", "cohort"),
    ] {
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES (?, ?, ?, ?, 'active', 1)")
            .bind(id).bind(parent).bind(id).bind(slug).execute(pool).await.unwrap();
    }
}

#[tokio::test]
async fn invitation_acceptance_rejects_revoked_creator_authority() {
    let fixture = GroupFixture::german_tree().await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let invitation = service
        .create_invitation(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "revoked@example.test",
            IdentityType::Learner,
            vec![Capability::GroupView],
            OffsetDateTime::now_utc().unix_timestamp() + 3600,
        )
        .await
        .unwrap();
    sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = 'membership-a'")
        .execute(&fixture.pool)
        .await
        .unwrap();

    let result = service
        .accept_invitation(&invitation.secret, "revoked@example.test", "Revoked")
        .await;

    assert!(matches!(result, Err(AppError::Forbidden(_))));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE normalized_email = 'revoked@example.test'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn invitation_acceptance_rechecks_permission_delegate_without_capabilities() {
    let fixture = GroupFixture::german_tree().await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let invitation = service
        .create_invitation(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "no-capabilities@example.test",
            IdentityType::Learner,
            Vec::new(),
            OffsetDateTime::now_utc().unix_timestamp() + 3600,
        )
        .await
        .unwrap();
    sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = 'membership-a' AND capability = 'permissions.delegate'")
        .execute(&fixture.pool)
        .await
        .unwrap();

    let result = service
        .accept_invitation(
            &invitation.secret,
            "no-capabilities@example.test",
            "No Capabilities",
        )
        .await;

    assert!(matches!(result, Err(AppError::Forbidden(_))));
}

#[tokio::test]
async fn join_code_acceptance_rejects_archived_target_group() {
    let fixture = GroupFixture::german_tree().await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let join_code = service
        .create_join_code(
            &fixture.german_a_teacher,
            &fixture.german_a,
            IdentityType::Learner,
            vec![Capability::GroupView],
            OffsetDateTime::now_utc().unix_timestamp() + 3600,
            10,
        )
        .await
        .unwrap();
    sqlx::query("UPDATE groups SET status = 'archived', archived_at = ? WHERE id = ?")
        .bind(OffsetDateTime::now_utc().unix_timestamp())
        .bind(&fixture.german_a)
        .execute(&fixture.pool)
        .await
        .unwrap();

    let result = service
        .accept_invitation(&join_code.secret, "archived@example.test", "Archived")
        .await;

    assert!(matches!(
        result,
        Err(AppError::Forbidden(_) | AppError::Conflict(_))
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE normalized_email = 'archived@example.test'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap(),
        0
    );
}

async fn assert_child_cannot_overwrite_existing_user(existing_group: &str, suffix: &str) {
    let fixture = GroupFixture::german_tree().await;
    let existing_group = match existing_group {
        "parent" => &fixture.german,
        "sibling" => &fixture.german_b,
        _ => unreachable!(),
    };
    insert_existing_user(&fixture.pool, existing_group, suffix).await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let csv = format!("email,display_name,identity_type,group_slug\nglobal-{suffix}@example.test,Changed,teacher,german-a\n");

    let result = service
        .import_csv(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &csv,
            &format!("{suffix}-global-update"),
        )
        .await;

    assert!(matches!(
        result,
        Err(AppError::Forbidden(_) | AppError::Conflict(_))
    ));
    let fields: (String, String) =
        sqlx::query_as("SELECT display_name, identity_type FROM users WHERE id = ?")
            .bind(format!("global-user-{suffix}"))
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(fields, ("Original".into(), "learner".into()));
}

#[tokio::test]
async fn child_import_cannot_overwrite_user_with_sibling_membership() {
    assert_child_cannot_overwrite_existing_user("sibling", "sibling").await;
}

#[tokio::test]
async fn child_import_cannot_overwrite_user_with_parent_membership() {
    assert_child_cannot_overwrite_existing_user("parent", "parent").await;
}

#[tokio::test]
async fn import_rejects_idempotency_key_reused_with_different_payload() {
    let fixture = GroupFixture::german_tree().await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let first =
        "email,display_name,identity_type,group_slug\nfirst@example.test,First,learner,german-a\n";
    let second = "email,display_name,identity_type,group_slug\nsecond@example.test,Second,learner,german-a\n";
    service
        .import_csv(
            &fixture.german_a_teacher,
            &fixture.german_a,
            first,
            "same-key",
        )
        .await
        .unwrap();

    let result = service
        .import_csv(
            &fixture.german_a_teacher,
            &fixture.german_a,
            second,
            "same-key",
        )
        .await;

    assert!(matches!(result, Err(AppError::Conflict(_))));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE normalized_email = 'second@example.test'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn preview_reports_ambiguous_group_slug_as_row_error() {
    let fixture = GroupFixture::german_tree().await;
    insert_ambiguous_slug_tree(&fixture.pool, &fixture.german_a).await;
    let service = ProvisioningService::new(fixture.pool);
    let csv = "email,display_name,identity_type,group_slug\nambiguous@example.test,Ambiguous,learner,cohort\n";

    let preview = service
        .preview_csv(&fixture.german_a_teacher, &fixture.german_a, csv)
        .await
        .unwrap();

    assert_eq!(preview.valid_rows, 0);
    assert_eq!(preview.errors.len(), 1);
    assert_eq!(preview.errors[0].row, 2);
    assert!(preview.errors[0].message.contains("ambiguous"));
}

#[tokio::test]
async fn import_rejects_ambiguous_group_slug_without_writes() {
    let fixture = GroupFixture::german_tree().await;
    insert_ambiguous_slug_tree(&fixture.pool, &fixture.german_a).await;
    let service = ProvisioningService::new(fixture.pool.clone());
    let csv = "email,display_name,identity_type,group_slug\nambiguous@example.test,Ambiguous,learner,cohort\n";

    let result = service
        .import_csv(
            &fixture.german_a_teacher,
            &fixture.german_a,
            csv,
            "ambiguous-import",
        )
        .await;

    assert!(matches!(result, Err(AppError::BadRequest(_))));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE normalized_email = 'ambiguous@example.test'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap(),
        0
    );
}
