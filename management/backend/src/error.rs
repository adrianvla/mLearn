use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

use crate::dto::ErrorDto;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Docker daemon unavailable: {0}")]
    DockerUnavailable(String),

    #[error("Permission denied accessing Docker socket")]
    DockerPermissionDenied,

    #[error("Container not found: {0}")]
    ContainerNotFound(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Policy denied: {0}")]
    PolicyDenied(String),

    #[error("Configuration unavailable: {0}")]
    ConfigurationUnavailable(String),

    #[error("Quota exceeded: {0}")]
    QuotaExceeded(String),

    #[error("Invalid active group: {0}")]
    InvalidActiveGroup(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("{0}")]
    Conflict(String),

    #[error("Too many authentication attempts")]
    TooManyRequests,

    #[error("Action not allowed on this container")]
    ActionNotAllowed,

    #[error("{0}")]
    NotImplemented(String),

    #[error("{0}")]
    BadRequest(String),

    #[error("Docker API error: {0}")]
    Docker(#[from] bollard::errors::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::DockerUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::DockerPermissionDenied => StatusCode::FORBIDDEN,
            Self::ContainerNotFound(_) => StatusCode::NOT_FOUND,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::PolicyDenied(_) => StatusCode::FORBIDDEN,
            Self::ConfigurationUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::QuotaExceeded(_) | Self::RateLimited(_) => {
                StatusCode::TOO_MANY_REQUESTS
            }
            Self::InvalidActiveGroup(_) => StatusCode::CONFLICT,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            Self::ActionNotAllowed => StatusCode::FORBIDDEN,
            Self::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Docker(err) => docker_status_code(err),
        }
    }
}

fn docker_status_code(err: &bollard::errors::Error) -> StatusCode {
    use bollard::errors::Error;
    use std::io::ErrorKind;

    match err {
        Error::DockerResponseServerError { status_code, .. } => match *status_code {
            404 => StatusCode::NOT_FOUND,
            409 => StatusCode::CONFLICT,
            401 | 403 => StatusCode::FORBIDDEN,
            400 => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        },
        Error::IOError { err } => match err.kind() {
            ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
            ErrorKind::ConnectionRefused | ErrorKind::NotFound => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        },
        Error::SocketNotFoundError(_) | Error::UnsupportedURISchemeError { .. } => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let message = self.to_string();
        tracing::warn!(status = %status, error = %message, "request failed");
        (status, axum::Json(ErrorDto { error: message })).into_response()
    }
}

impl From<crate::validation::ValidationError> for AppError {
    fn from(err: crate::validation::ValidationError) -> Self {
        Self::BadRequest(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::errors::Error;
    use std::io::{Error as IoError, ErrorKind};

    #[test]
    fn maps_named_variants_to_expected_status_codes() {
        assert_eq!(
            AppError::DockerUnavailable("offline".into()).status_code(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            AppError::DockerPermissionDenied.status_code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            AppError::ContainerNotFound("abc".into()).status_code(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            AppError::Unauthorized.status_code(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            AppError::Forbidden("denied".into()).status_code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            AppError::Conflict("exists".into()).status_code(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            AppError::ActionNotAllowed.status_code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            AppError::NotImplemented("missing source".into()).status_code(),
            StatusCode::NOT_IMPLEMENTED
        );
        assert_eq!(
            AppError::BadRequest("nope".into()).status_code(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            AppError::Internal("boom".into()).status_code(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn maps_docker_response_not_found_to_404() {
        let err = Error::DockerResponseServerError {
            status_code: 404,
            message: "no such container".into(),
        };
        assert_eq!(docker_status_code(&err), StatusCode::NOT_FOUND);
    }

    #[test]
    fn maps_docker_response_conflict_to_409() {
        let err = Error::DockerResponseServerError {
            status_code: 409,
            message: "already exists".into(),
        };
        assert_eq!(docker_status_code(&err), StatusCode::CONFLICT);
    }

    #[test]
    fn maps_docker_io_permission_denied_to_403() {
        let err = Error::IOError {
            err: IoError::from(ErrorKind::PermissionDenied),
        };
        assert_eq!(docker_status_code(&err), StatusCode::FORBIDDEN);
    }

    #[test]
    fn maps_docker_io_connection_refused_to_503() {
        let err = Error::IOError {
            err: IoError::from(ErrorKind::ConnectionRefused),
        };
        assert_eq!(docker_status_code(&err), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn maps_docker_io_not_found_to_503() {
        let err = Error::IOError {
            err: IoError::from(ErrorKind::NotFound),
        };
        assert_eq!(docker_status_code(&err), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn maps_socket_not_found_to_503() {
        let err = Error::SocketNotFoundError("/var/run/docker.sock".into());
        assert_eq!(docker_status_code(&err), StatusCode::SERVICE_UNAVAILABLE);
    }
}
