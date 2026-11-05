//! Process-local media transport. Only the runtime resolver can supply a path.
use base64::Engine;
use hyper::{
    Request, Response, StatusCode,
    body::{Body, Bytes, Frame, Incoming, SizeHint},
    server::conn::http1,
    service::service_fn,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use std::{
    convert::Infallible,
    io,
    net::TcpListener,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    thread::JoinHandle,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncSeekExt, ReadBuf},
    sync::oneshot,
    task::JoinSet,
};

const CHUNK: usize = 64 * 1024;
const CONNECTIONS: usize = 4;
const HEADER_LIMIT: usize = 16 * 1024;

pub(crate) const ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    #[cfg(debug_assertions)]
    "http://localhost:8081",
];

pub(crate) type Resolver = Arc<dyn Fn(&str) -> Result<PathBuf, StatusCode> + Send + Sync>;
pub(crate) type AuthoredResolver =
    Arc<dyn Fn(&str) -> Result<(PathBuf, String), StatusCode> + Send + Sync>;
pub(crate) type DocumentResolver = Arc<
    dyn Fn(&str, &str) -> Result<mlearn_core::DocumentResourceLocation, StatusCode> + Send + Sync,
>;

pub(crate) struct MediaListener {
    listener: TcpListener,
    authority: String,
    token: String,
    pub(crate) documents: Option<DocumentResolver>,
    #[cfg(test)]
    released: Option<std::sync::mpsc::Sender<()>>,
}

impl MediaListener {
    pub(crate) fn bind() -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        Ok(Self {
            authority: listener.local_addr()?.to_string(),
            listener,
            token: uuid::Uuid::new_v4().simple().to_string(),
            documents: None,
            #[cfg(test)]
            released: None,
        })
    }

    pub(crate) fn base_url(&self) -> String {
        format!("http://{}/{}/", self.authority, self.token)
    }

    #[cfg(test)]
    pub(crate) fn start(self, resolve: Resolver) -> io::Result<MediaServer> {
        self.start_with_authored(resolve, None)
    }

    pub(crate) fn start_with_authored(
        self,
        resolve: Resolver,
        authored: Option<AuthoredResolver>,
    ) -> io::Result<MediaServer> {
        // One reactor and at most four outstanding filesystem jobs, not a pool per stream.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(CONNECTIONS)
            .build()?;
        let (shutdown, stopped) = oneshot::channel();
        let thread = std::thread::Builder::new()
            .name("mlearn-media".into())
            .spawn(move || {
                let result = runtime.block_on(self.serve(resolve, authored, stopped));
                if let Err(error) = result {
                    eprintln!("Media listener stopped: {error}");
                }
                runtime.shutdown_timeout(Duration::from_secs(1));
            })?;
        Ok(MediaServer {
            shutdown: Some(shutdown),
            thread: Some(thread),
        })
    }

    async fn serve(
        self,
        resolve: Resolver,
        authored: Option<AuthoredResolver>,
        mut stopped: oneshot::Receiver<()>,
    ) -> io::Result<()> {
        let listener = tokio::net::TcpListener::from_std(self.listener)?;
        let mut connections = JoinSet::new();
        let resolver_slots = Arc::new(tokio::sync::Semaphore::new(CONNECTIONS));
        loop {
            tokio::select! {
                biased;
                _ = &mut stopped => break,
                result = connections.join_next(), if !connections.is_empty() => {
                    if let Some(Err(error)) = result {
                        eprintln!("Media connection task failed: {error}");
                    }
                }
                accepted = listener.accept() => {
                    let (socket, _) = accepted?;
                    // Reject excess sockets before parsing or spawning work. The OS backlog
                    // is not an unbounded application task queue.
                    if connections.len() >= CONNECTIONS {
                        drop(socket);
                        continue;
                    }
                    let authority = self.authority.clone();
                    let prefix = format!("/{}/", self.token);
                    let resolve = resolve.clone();
                    let authored = authored.clone();
                    let documents = self.documents.clone();
                    let resolver_slots = resolver_slots.clone();
                    #[cfg(test)]
                    let released = self.released.clone();
                    connections.spawn(async move {
                        let service = service_fn(move |request| {
                            handle(
                                request,
                                authority.clone(),
                                prefix.clone(),
                                resolve.clone(),
                                authored.clone(),
                                documents.clone(),
                                resolver_slots.clone(),
                            )
                        });
                        let result = http1::Builder::new()
                            .keep_alive(false)
                            .max_headers(32)
                            .max_buf_size(HEADER_LIMIT)
                            .header_read_timeout(Duration::from_secs(5))
                            .timer(TokioTimer::new())
                            .serve_connection(TokioIo::new(socket), service)
                            .await;
                        if let Err(error) = result {
                            // Disconnects cancel the response body and release its file.
                            if !error.is_incomplete_message() && !error.is_closed() {
                                eprintln!("Media connection ended: {error}");
                            }
                        }
                        // The owner test subscribes before disconnecting. This
                        // receipt observes release without a timing-based retry.
                        #[cfg(test)]
                        if let Some(released) = released {
                            released.send(()).expect("release observer is alive");
                        }
                    });
                }
            }
        }
        drop(listener);
        connections.abort_all();
        while let Some(result) = connections.join_next().await {
            if let Err(error) = result
                && !error.is_cancelled()
            {
                eprintln!("Media shutdown task failed: {error}");
            }
        }
        Ok(())
    }
}

pub(crate) struct MediaServer {
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl MediaServer {
    pub(crate) fn shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take()
            && shutdown.send(()).is_err()
        {
            eprintln!("Media listener already stopped");
        }
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            eprintln!("Media listener thread failed");
        }
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// Hyper polls this reader only when the socket can accept more data. There is no
// detached producer, whole-file allocation, or queue retaining data after disconnect.
struct FileBody {
    file: Option<tokio::fs::File>,
    remaining: u64,
    buffer: Box<[u8; CHUNK]>,
}

impl FileBody {
    fn empty() -> Self {
        Self {
            file: None,
            remaining: 0,
            buffer: Box::new([0; CHUNK]),
        }
    }
}

impl Body for FileBody {
    type Data = Bytes;
    type Error = io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        let this = self.get_mut();
        if this.remaining == 0 {
            return Poll::Ready(None);
        }
        let count = usize::try_from(this.remaining).map_or(CHUNK, |remaining| remaining.min(CHUNK));
        let mut buffer = ReadBuf::new(&mut this.buffer[..count]);
        let Some(file) = &mut this.file else {
            return Poll::Ready(None);
        };
        match Pin::new(file).poll_read(cx, &mut buffer) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(error)) => Poll::Ready(Some(Err(error))),
            Poll::Ready(Ok(())) => {
                let bytes = buffer.filled();
                if bytes.is_empty() {
                    return Poll::Ready(Some(Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "Media file changed during playback",
                    ))));
                }
                this.remaining -= u64::try_from(bytes.len()).map_err(io::Error::other)?;
                Poll::Ready(Some(Ok(Frame::data(Bytes::copy_from_slice(bytes)))))
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.remaining == 0
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::with_exact(self.remaining)
    }
}

fn empty(status: StatusCode) -> Response<FileBody> {
    let mut response = Response::new(FileBody::empty());
    *response.status_mut() = status;
    response.headers_mut().insert(
        "cache-control",
        hyper::header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn handle(
    request: Request<Incoming>,
    authority: String,
    prefix: String,
    resolve: Resolver,
    authored: Option<AuthoredResolver>,
    documents: Option<DocumentResolver>,
    resolver_slots: Arc<tokio::sync::Semaphore>,
) -> Result<Response<FileBody>, Infallible> {
    Ok(
        match respond(
            request,
            &authority,
            &prefix,
            resolve,
            authored,
            documents,
            resolver_slots,
        )
        .await
        {
            Ok(response) => response,
            Err(status) => empty(status),
        },
    )
}

async fn respond(
    request: Request<Incoming>,
    authority: &str,
    prefix: &str,
    resolve: Resolver,
    authored: Option<AuthoredResolver>,
    documents: Option<DocumentResolver>,
    resolver_slots: Arc<tokio::sync::Semaphore>,
) -> Result<Response<FileBody>, StatusCode> {
    let headers = request.headers();
    if headers.get_all("host").iter().count() != 1
        || headers.get("host").and_then(|v| v.to_str().ok()) != Some(authority)
        || request.uri().scheme().is_some()
        || request.uri().query().is_some()
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if headers.get_all("origin").iter().count() > 1 {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(origin) = headers.get("origin")
        && !ORIGINS
            .iter()
            .any(|allowed| origin.as_bytes() == allowed.as_bytes())
    {
        return Err(StatusCode::FORBIDDEN);
    }
    // Media elements may omit Origin. The secret URL is still required; no
    // wildcard CORS, cookie authority, paths, or directory routes are accepted.
    let id = request
        .uri()
        .path()
        .strip_prefix(prefix)
        .ok_or(StatusCode::FORBIDDEN)?;
    let document_ids = id
        .strip_prefix("document/")
        .map(|ids| {
            let (source, resource) = ids.split_once('/').ok_or(StatusCode::NOT_FOUND)?;
            let decode = |value: &str| {
                if value.is_empty() || value.len() > 684 {
                    return Err(StatusCode::NOT_FOUND);
                }
                let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(value)
                    .map_err(|_| StatusCode::NOT_FOUND)?;
                let value = String::from_utf8(bytes).map_err(|_| StatusCode::NOT_FOUND)?;
                if value.len() > 512 {
                    return Err(StatusCode::NOT_FOUND);
                }
                Ok(value)
            };
            Ok::<_, StatusCode>((decode(source)?, decode(resource)?))
        })
        .transpose()?;
    let (is_authored, id) = id
        .strip_prefix("authored/")
        .map_or((false, id), |id| (true, id));
    if document_ids.is_none()
        && (id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    {
        return Err(StatusCode::NOT_FOUND);
    }
    if request.method() != hyper::Method::GET && request.method() != hyper::Method::HEAD {
        let mut response = empty(StatusCode::METHOD_NOT_ALLOWED);
        response.headers_mut().insert(
            "allow",
            hyper::header::HeaderValue::from_static("GET, HEAD"),
        );
        return Ok(response);
    }
    if headers.contains_key("transfer-encoding")
        || headers.get("content-length").is_some_and(|v| v != "0")
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let id = id.to_owned();
    // A disconnected request can drop its JoinHandle while a blocking runtime
    // lookup still waits on analysis. Keep the slot in that job, not its caller;
    // replacement connections cannot accumulate detached resolver jobs.
    let slot = resolver_slots
        .acquire_owned()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let (path, authored_mime, document_length) = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        if let Some((source, resource)) = document_ids {
            let location = documents.ok_or(StatusCode::NOT_FOUND)?(&source, &resource)?;
            if !matches!(
                location.mime_type.as_str(),
                "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml"
            ) || location.byte_length == 0
                || location.byte_length > 2 * 1024 * 1024
            {
                return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
            }
            Ok((
                PathBuf::from(location.path),
                Some(location.mime_type),
                Some(u64::from(location.byte_length)),
            ))
        } else if is_authored {
            let resolver = authored.ok_or(StatusCode::NOT_FOUND)?;
            let (path, mime) = resolver(&id)?;
            Ok((path, Some(mime), None))
        } else {
            resolve(&id).map(|path| (path, None, None))
        }
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    file.set_max_buf_size(CHUNK);
    let metadata = file.metadata().await.map_err(|_| StatusCode::NOT_FOUND)?;
    if !metadata.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let length = metadata.len();
    if document_length.is_some_and(|expected| expected != length || length > 2 * 1024 * 1024) {
        return Err(StatusCode::NOT_FOUND);
    }
    // RFC 9110: Range is defined for GET, and is ignored on HEAD.
    let range = if request.method() == hyper::Method::GET && !headers.contains_key("if-range") {
        let values = headers.get_all("range");
        if values.iter().count() > 1 {
            return unsatisfiable(length);
        }
        match values.iter().next() {
            Some(value) => {
                let ranges = value
                    .to_str()
                    .ok()
                    .filter(|value| !value.contains(','))
                    .and_then(|value| http_range::HttpRange::parse(value, length).ok());
                match ranges {
                    Some(ranges) if ranges.len() == 1 && ranges[0].length > 0 => Some(ranges[0]),
                    _ => return unsatisfiable(length),
                }
            }
            None => None,
        }
    } else {
        None
    };
    let (start, count) = range.map_or((0, length), |range| (range.start, range.length));
    file.seek(io::SeekFrom::Start(start))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let source_mime = match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
    {
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        _ => "video/mp4",
    };
    let mime = authored_mime.as_deref().unwrap_or(source_mime);
    if !matches!(
        mime,
        "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/gif"
            | "image/svg+xml"
            | "audio/mp4"
            | "audio/mpeg"
            | "audio/wav"
            | "audio/x-wav"
            | "audio/ogg"
            | "audio/webm"
            | "audio/flac"
            | "video/mp4"
            | "video/quicktime"
            | "video/webm"
            | "video/x-matroska"
    ) {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let mut response = Response::builder()
        .status(if range.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header("content-type", mime)
        .header("content-length", count)
        .header("accept-ranges", "bytes")
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
    if document_length.is_some() {
        // SVG may be a source image, never an active same-origin document.
        response = response.header(
            "content-security-policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
    }
    if let Some(origin) = headers.get("origin") {
        response = response
            .header("access-control-allow-origin", origin)
            .header("vary", "Origin");
    }
    if range.is_some() {
        response = response.header(
            "content-range",
            format!("bytes {start}-{}/{length}", start + count - 1),
        );
    }
    let body = if request.method() == hyper::Method::HEAD {
        FileBody::empty()
    } else {
        FileBody {
            file: Some(file),
            remaining: count,
            buffer: Box::new([0; CHUNK]),
        }
    };
    response
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn unsatisfiable(length: u64) -> Result<Response<FileBody>, StatusCode> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header("content-range", format!("bytes */{length}"))
        .header("cache-control", "no-store")
        .body(FileBody::empty())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
#[path = "media/tests.rs"]
mod tests;
