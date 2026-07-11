use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{
    authorization::AuthorizationService,
    identity::IdentityType,
};

mod csv_import;
mod invitations;
mod shared;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowError {
    pub row: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub valid_rows: usize,
    pub errors: Vec<CsvRowError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub import_id: String,
    pub created_users: usize,
    pub updated_users: usize,
    pub memberships_created: usize,
    pub replayed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvitation {
    pub id: String,
    pub group_id: String,
    pub expires_at: i64,
    pub secret: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionedUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub identity_type: IdentityType,
    pub group_id: String,
}

#[derive(Clone)]
pub struct ProvisioningService {
    pub(super) pool: SqlitePool,
    pub(super) authorization: AuthorizationService,
}

impl ProvisioningService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }
}

#[cfg(test)]
mod review_tests;

#[cfg(test)]
mod tests {
    use time::OffsetDateTime;

    use crate::{
        authorization::Capability, error::AppError, groups::tests::GroupFixture,
        identity::IdentityType,
    };

    const CSV: &str = "email,display_name,identity_type,group_slug\nlearner@example.test,Learner,learner,german-b\n";

    #[tokio::test]
    async fn teacher_import_cannot_target_sibling_group() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());

        let result = service
            .preview_csv(&fixture.german_a_teacher, &fixture.german_b, CSV)
            .await;

        assert!(matches!(result, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn preview_reports_row_errors_without_writing() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();

        let preview = service
            .preview_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "email,display_name,identity_type,group_slug\nbad,,owner,german-a\n",
            )
            .await
            .unwrap();

        assert_eq!(preview.valid_rows, 0);
        assert_eq!(preview.errors[0].row, 2);
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn import_is_idempotent_and_audits_user_and_membership_atomically() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let csv = "email,display_name,identity_type,group_slug\nlearner@example.test,Learner,learner,german-a\n";
        let first = service
            .import_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                csv,
                "import-1",
            )
            .await
            .unwrap();
        let second = service
            .import_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                csv,
                "import-1",
            )
            .await
            .unwrap();

        assert_eq!(first.import_id, second.import_id);
        assert!(second.replayed);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM users WHERE normalized_email = 'learner@example.test'",
            )
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM audit_events WHERE request_id = 'import-1'",
            )
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            3
        );
    }

    #[tokio::test]
    async fn invitation_acceptance_checks_email_expiry_and_capability_ceiling() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let invitation = service
            .create_invitation(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "invited@example.test",
                IdentityType::Learner,
                vec![Capability::GroupView],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
            )
            .await
            .unwrap();

        assert!(matches!(
            service
                .accept_invitation(&invitation.secret, "other@example.test", "Other")
                .await,
            Err(AppError::Forbidden(_))
        ));
        let accepted = service
            .accept_invitation(&invitation.secret, "invited@example.test", "Invited")
            .await
            .unwrap();
        assert_eq!(accepted.identity_type, IdentityType::Learner);

        let overreach = service
            .create_invitation(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "admin@example.test",
                IdentityType::Admin,
                vec![Capability::PoliciesPublish],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
            )
            .await;
        assert!(matches!(overreach, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn join_codes_reject_management_capabilities() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let result = service
            .create_join_code(
                &fixture.german_a_teacher,
                &fixture.german_a,
                IdentityType::Teacher,
                vec![Capability::MembersManage],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
                10,
            )
            .await;

        assert!(matches!(result, Err(AppError::BadRequest(_))));
    }
}
