use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    sync::mpsc,
};

struct Fixture {
    _root: tempfile::TempDir,
    _server: MediaServer,
    address: SocketAddr,
    path: String,
    bytes: Vec<u8>,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("synthetic.webm");
        let bytes: Vec<_> = (0..3 * 1024 * 1024 + 17)
            .map(|i| u8::try_from(i % 251).unwrap())
            .collect();
        std::fs::write(&path, &bytes).unwrap();
        let listener = MediaListener::bind().unwrap();
        let address = listener.listener.local_addr().unwrap();
        let route = format!("/{}/video-fixture", listener.token);
        let server = listener
            .start(Arc::new(move |id| {
                if id == "video-fixture" {
                    Ok(path.clone())
                } else {
                    Err(StatusCode::NOT_FOUND)
                }
            }))
            .unwrap();
        Self {
            _root: root,
            _server: server,
            address,
            path: route,
            bytes,
        }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        headers: &str,
    ) -> (u16, BTreeMap<String, String>, Vec<u8>) {
        let mut socket = TcpStream::connect(self.address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write!(
            socket,
            "{method} {path} HTTP/1.1\r\nHost: {}\r\n{headers}\r\n",
            self.address
        )
        .unwrap();
        let mut reader = BufReader::new(socket);
        let (status, headers) = read_headers(&mut reader);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        (status, headers, bytes)
    }
}

fn read_headers(reader: &mut BufReader<TcpStream>) -> (u16, BTreeMap<String, String>) {
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let status = line.split_whitespace().nth(1).unwrap().parse().unwrap();
    let mut headers = BTreeMap::new();
    loop {
        line.clear();
        reader.read_line(&mut line).unwrap();
        if line == "\r\n" {
            break;
        }
        let (name, value) = line.trim().split_once(':').unwrap();
        headers.insert(name.to_ascii_lowercase(), value.trim().into());
    }
    (status, headers)
}

#[test]
fn full_get_streams_beyond_old_body_limit_over_http() {
    // Given a synthetic file larger than the previous 2 MiB complete-body ceiling.
    let fixture = Fixture::new();
    // When a real TCP client makes the ordinary GET observed in the WebKit trace.
    let (status, headers, bytes) = fixture.request("GET", &fixture.path, "");
    // Then it receives a truthful full response, with no artificial partial content.
    assert_eq!(status, 200);
    assert_eq!(headers["content-length"], fixture.bytes.len().to_string());
    assert_eq!(headers["content-type"], "video/webm");
    assert_eq!(headers["accept-ranges"], "bytes");
    assert!(!headers.contains_key("content-range"));
    assert_eq!(bytes, fixture.bytes);
    println!(
        "HTTP_PROOF full GET status={status} headers={headers:?} bytes={} sha256={:x}",
        bytes.len(),
        Sha256::digest(&bytes)
    );
}

#[test]
fn byte_ranges_suffix_and_invalid_ranges_have_truthful_http_responses() {
    // Given the same real listener and deterministic media bytes.
    let fixture = Fixture::new();
    let length = fixture.bytes.len();
    // When clients request bounded, suffix, open-ended, and invalid ranges.
    for (range, expected) in [
        ("bytes=1-65537", Some((1, 65538))),
        ("bytes=-19", Some((length - 19, length))),
        ("bytes=3145728-", Some((3145728, length))),
        ("bytes=0-999999999", Some((0, length))),
        ("bytes=999999999-", None),
        ("bytes=9-1", None),
        ("bytes=-0", None),
        ("bytes=0-1,4-5", None),
        ("bytes=999999999-,0-1", None),
        ("invalid", None),
        ("bytes=18446744073709551616-", None),
    ] {
        let (status, headers, bytes) =
            fixture.request("GET", &fixture.path, &format!("Range: {range}\r\n"));
        // Then exact offsets and bodies agree; invalid requests advertise the real size.
        match expected {
            Some((start, end)) => {
                assert_eq!(status, 206, "{range}");
                assert_eq!(
                    headers["content-range"],
                    format!("bytes {start}-{}/{length}", end - 1)
                );
                assert_eq!(headers["content-length"], (end - start).to_string());
                assert_eq!(bytes, fixture.bytes[start..end], "{range}");
                println!(
                    "HTTP_PROOF range={range} status={status} content-range={} bytes={} sha256={:x}",
                    headers["content-range"],
                    bytes.len(),
                    Sha256::digest(&bytes)
                );
            }
            None => {
                assert_eq!(status, 416, "{range}");
                assert_eq!(headers["content-range"], format!("bytes */{length}"));
                assert!(bytes.is_empty());
            }
        }
    }
}

#[test]
fn head_and_if_range_do_not_fabricate_partial_bodies() {
    // Given a valid source and an unmatchable validator (this transport emits none).
    let fixture = Fixture::new();
    // When HEAD contains Range, or GET contains If-Range.
    for (method, extra) in [
        ("HEAD", "Range: bytes=0-1\r\n"),
        ("GET", "Range: bytes=0-1\r\nIf-Range: \"unknown\"\r\n"),
    ] {
        let (status, headers, bytes) = fixture.request(method, &fixture.path, extra);
        // Then HEAD describes the whole representation; If-Range falls back to full GET.
        assert_eq!(status, 200);
        assert_eq!(headers["content-length"], fixture.bytes.len().to_string());
        assert!(!headers.contains_key("content-range"));
        if method == "HEAD" {
            assert!(bytes.is_empty());
        } else {
            assert_eq!(bytes, fixture.bytes);
        }
    }
}

#[test]
fn authority_origin_method_and_source_identity_are_enforced_over_http() {
    // Given a server whose resolver admits only video-fixture.
    let fixture = Fixture::new();
    let prefix = fixture.path.strip_suffix("video-fixture").unwrap();
    // When hostile requests cross the actual HTTP parser.
    for (method, path, headers, expected) in [
        ("GET", "/wrong-token/video-fixture".to_owned(), "", 403),
        ("GET", format!("{prefix}missing"), "", 404),
        ("GET", format!("{prefix}"), "", 404),
        ("GET", format!("{prefix}../../etc/passwd"), "", 404),
        ("GET", format!("{prefix}%2Fetc%2Fpasswd"), "", 404),
        (
            "GET",
            fixture.path.clone(),
            "Origin: https://evil.invalid\r\n",
            403,
        ),
        ("GET", fixture.path.clone(), "Origin: null\r\n", 403),
        (
            "GET",
            fixture.path.clone(),
            "Origin: tauri://localhost\r\nOrigin: https://evil.invalid\r\n",
            403,
        ),
        ("GET", fixture.path.clone(), "Content-Length: 1\r\n", 400),
        ("POST", fixture.path.clone(), "", 405),
        ("GET", format!("{}?path=/etc/passwd", fixture.path), "", 403),
    ] {
        let (status, _, bytes) = fixture.request(method, &path, headers);
        // Then no bytes or filesystem detail escape.
        assert_eq!(status, expected, "{method} {path}");
        assert!(bytes.is_empty());
    }
    let mut socket = TcpStream::connect(fixture.address).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(
        socket,
        "GET {} HTTP/1.1\r\nHost: attacker.invalid\r\n\r\n",
        fixture.path
    )
    .unwrap();
    let (status, _) = read_headers(&mut BufReader::new(socket));
    assert_eq!(status, 403);
    let (status, headers, _) =
        fixture.request("HEAD", &fixture.path, "Origin: tauri://localhost\r\n");
    assert_eq!(status, 200);
    assert_eq!(headers["access-control-allow-origin"], "tauri://localhost");
}

#[test]
fn empty_media_has_zero_length_and_no_valid_byte_range() {
    // Given an admitted but empty file.
    let fixture = Fixture::new();
    std::fs::write(fixture._root.path().join("synthetic.webm"), []).unwrap();
    // When a full GET and a byte GET cross HTTP.
    let (status, headers, bytes) = fixture.request("GET", &fixture.path, "");
    let (range_status, range_headers, _) =
        fixture.request("GET", &fixture.path, "Range: bytes=0-0\r\n");
    // Then no subtraction underflows or fabricated bytes appear.
    assert_eq!(status, 200);
    assert_eq!(headers["content-length"], "0");
    assert!(bytes.is_empty());
    assert_eq!(range_status, 416);
    assert_eq!(range_headers["content-range"], "bytes */0");
}

#[test]
fn blocked_source_resolution_waits_without_blocking_the_http_reactor() {
    // Given a resolver gate held before the request, like a runtime mutex held
    // by analysis. Subscribe to entry before sending any bytes.
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("synthetic.webm");
    let expected = b"synthetic media after analysis";
    std::fs::write(&path, expected).unwrap();
    let (entered, entries) = mpsc::channel();
    let (release, gate) = mpsc::channel();
    let gate = std::sync::Mutex::new(gate);
    let listener = MediaListener::bind().unwrap();
    let address = listener.listener.local_addr().unwrap();
    let route = format!("/{}/video-fixture", listener.token);
    let _server = listener
        .start(Arc::new(move |id| {
            if id != "video-fixture" {
                return Err(StatusCode::NOT_FOUND);
            }
            entered.send(()).unwrap();
            gate.lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            Ok(path.clone())
        }))
        .unwrap();
    let mut socket = TcpStream::connect(address).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(socket, "GET {route} HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
    entries.recv_timeout(Duration::from_secs(10)).unwrap();
    // When another HTTP request arrives while resolution is blocked, it is
    // serviced by the reactor, then the explicit gate releases the first one.
    let mut other = TcpStream::connect(address).unwrap();
    other
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(
        other,
        "GET /unauthorized HTTP/1.1\r\nHost: {address}\r\n\r\n"
    )
    .unwrap();
    assert_eq!(read_headers(&mut BufReader::new(other)).0, 403);
    release.send(()).unwrap();
    let mut reader = BufReader::new(socket);
    let (status, headers) = read_headers(&mut reader);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    // Then ordinary contention ends in a successful full response, not 503.
    assert_eq!(status, 200);
    assert_eq!(headers["content-length"], expected.len().to_string());
    assert_eq!(bytes, expected);
    println!(
        "CONTENTION_PROOF blocked_resolver=event-gated reactor=responsive released_status=200"
    );
}

#[test]
fn concurrent_work_is_bounded_and_shutdown_releases_listener_and_files() {
    // Given four requests held at the synchronous resolver boundary. Signals
    // subscribe before requests; there are no sleeps or scheduling assumptions.
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("synthetic.webm");
    std::fs::File::create(&file)
        .unwrap()
        .set_len(512 * 1024 * 1024)
        .unwrap();
    let mut listener = MediaListener::bind().unwrap();
    let (released, release_receipts) = mpsc::channel();
    listener.released = Some(released);
    let address = listener.listener.local_addr().unwrap();
    let route = format!("/{}/video-fixture", listener.token);
    let (entered, entries) = mpsc::channel();
    let mut releases = Vec::new();
    let mut gates = BTreeMap::new();
    for index in 0..=CONNECTIONS {
        let (release, gate) = mpsc::channel();
        releases.push(release);
        gates.insert(format!("video-{index}"), gate);
    }
    let gates = std::sync::Mutex::new(gates);
    let media_file = file.clone();
    let mut server = listener
        .start(Arc::new(move |id| {
            let gate = gates
                .lock()
                .unwrap()
                .remove(id)
                .ok_or(StatusCode::NOT_FOUND)?;
            entered.send(()).unwrap();
            gate.recv_timeout(Duration::from_secs(10)).unwrap();
            Ok(media_file.clone())
        }))
        .unwrap();
    let mut sockets = Vec::new();
    for index in 0..CONNECTIONS {
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let path = route.replace("video-fixture", &format!("video-{index}"));
        write!(socket, "GET {path} HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
        entries.recv_timeout(Duration::from_secs(10)).unwrap();
        sockets.push(BufReader::new(socket));
    }
    // When a fifth request arrives while all four admitted connections own work.
    let mut excess = TcpStream::connect(address).unwrap();
    excess
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut byte = [0];
    let rejected = excess.read(&mut byte);
    // Then the listener rejects it without spawning or resolving a fifth stream.
    assert!(
        matches!(rejected, Ok(0))
            || rejected.is_err_and(|e| e.kind() == io::ErrorKind::ConnectionReset)
    );
    for _ in 0..CONNECTIONS {
        releases.remove(0).send(()).unwrap();
    }
    for socket in &mut sockets {
        assert_eq!(read_headers(socket).0, 200);
    }
    // Disconnect one in-flight stream and await its exact release event.
    drop(sockets.remove(0));
    release_receipts
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    let mut replacement = TcpStream::connect(address).unwrap();
    replacement
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let path = route.replace("video-fixture", &format!("video-{CONNECTIONS}"));
    write!(
        replacement,
        "GET {path} HTTP/1.1\r\nHost: {address}\r\n\r\n"
    )
    .unwrap();
    entries.recv_timeout(Duration::from_secs(10)).unwrap();
    releases.remove(0).send(()).unwrap();
    let mut replacement = BufReader::new(replacement);
    assert_eq!(read_headers(&mut replacement).0, 200);
    sockets.push(replacement);
    // Stop the owner with all four replacement/remaining streams still active.
    server.shutdown();
    assert!(TcpStream::connect(address).is_err());
    for mut socket in sockets {
        // Discard the bounded kernel send backlog; EOF must arrive after shutdown.
        io::copy(&mut socket, &mut io::sink()).unwrap();
    }
    std::fs::remove_file(&file).unwrap();
    println!(
        "RESOURCE_PROOF max_connections={CONNECTIONS} chunk_bytes={CHUNK} disconnect=released-and-reused shutdown=joined listener=closed file=removed"
    );
}
