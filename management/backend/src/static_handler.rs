use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use include_dir::{include_dir, Dir};

static FRONTEND_DIST: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../frontend/dist");

pub async fn serve_spa(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = FRONTEND_DIST.get_file(path) {
        return file_response(path, file.contents());
    }

    if !path.contains('.') {
        if let Some(file) = FRONTEND_DIST.get_file("index.html") {
            return file_response("index.html", file.contents());
        }
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

fn file_response(path: &str, contents: &[u8]) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    match Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .body(Body::from(contents.to_vec()))
    {
        Ok(response) => response,
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response(),
    }
}
