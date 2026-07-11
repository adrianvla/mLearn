#![allow(dead_code)] // Resolve-at-use contract is consumed by LLM Gateway Task 3.

use std::{
    future::Future,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    pin::Pin,
};

use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::error::AppError;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    #[serde(rename = "openaiCompatible")]
    OpenAiCompatible,
    Ollama,
}

impl ProviderKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openaiCompatible",
            Self::Ollama => "ollama",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "openaiCompatible" => Ok(Self::OpenAiCompatible),
            "ollama" => Ok(Self::Ollama),
            _ => Err(AppError::Internal(
                "persisted provider kind is invalid".into(),
            )),
        }
    }
}

#[doc(hidden)]
pub trait EndpointResolver: Send + Sync {
    fn resolve<'a>(
        &'a self,
        host: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>>;
}

#[doc(hidden)]
pub struct TokioEndpointResolver;

impl EndpointResolver for TokioEndpointResolver {
    fn resolve<'a>(
        &'a self,
        host: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            tokio::net::lookup_host((host, port))
                .await
                .map(|addresses| addresses.collect())
                .map_err(|_| AppError::BadRequest("provider hostname could not be resolved".into()))
        })
    }
}

#[derive(Clone)]
pub(crate) struct PinnedEndpoint {
    client: reqwest::Client,
    base_url: Url,
}

impl PinnedEndpoint {
    pub(crate) async fn resolve(
        kind: ProviderKind,
        value: &str,
        resolver: &dyn EndpointResolver,
    ) -> Result<Self, AppError> {
        let validated = validate_base_url(kind, value)?;
        let base_url = Url::parse(&validated)
            .map_err(|_| AppError::BadRequest("provider base URL is invalid".into()))?;
        let host = base_url
            .host_str()
            .ok_or_else(|| AppError::BadRequest("provider base URL requires a host".into()))?;
        let targets = resolve_public_targets(kind, &validated, resolver).await?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(host, &targets)
            .build()
            .map_err(|_| {
                AppError::Internal("pinned provider client initialization failed".into())
            })?;
        Ok(Self { client, base_url })
    }

    pub(crate) fn request(
        &self,
        method: reqwest::Method,
        relative_path: &str,
    ) -> Result<reqwest::RequestBuilder, AppError> {
        let relative_path = relative_path.trim_matches('/');
        if relative_path.is_empty()
            || relative_path.contains(['?', '#', '\\', '%'])
            || relative_path.split('/').any(|segment| {
                segment.is_empty()
                    || matches!(segment, "." | "..")
                    || segment.eq_ignore_ascii_case("%2e")
                    || segment.eq_ignore_ascii_case("%2e%2e")
            })
            || Url::parse(relative_path).is_ok()
        {
            return Err(AppError::BadRequest(
                "provider request path must be a safe relative path".into(),
            ));
        }
        let mut url = self.base_url.clone();
        let base_path = url.path().trim_end_matches('/');
        url.set_path(&format!("{base_path}/{relative_path}"));
        Ok(self.client.request(method, url))
    }
}

pub(crate) fn validate_base_url(kind: ProviderKind, value: &str) -> Result<String, AppError> {
    let url = Url::parse(value)
        .map_err(|_| AppError::BadRequest("provider base URL is invalid".into()))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::BadRequest(
            "provider base URL cannot contain credentials, query, or fragment".into(),
        ));
    }
    let host = url
        .host()
        .ok_or_else(|| AppError::BadRequest("provider base URL requires a host".into()))?;
    let host_name = host
        .to_string()
        .to_ascii_lowercase()
        .trim_end_matches('.')
        .to_string();
    if is_forbidden_host(&host, &host_name) {
        return Err(AppError::BadRequest(
            "provider base URL targets a forbidden network".into(),
        ));
    }
    let safe_ollama_service = kind == ProviderKind::Ollama
        && matches!(host_name.as_str(), "ollama" | "mlearn-backend")
        && url.scheme() == "http";
    if safe_ollama_service && url.path() != "/" {
        return Err(AppError::BadRequest(
            "built-in Ollama base URL must use the service root".into(),
        ));
    }
    if url.scheme() != "https" && !safe_ollama_service {
        return Err(AppError::BadRequest(
            "provider base URL must use HTTPS".into(),
        ));
    }
    if !matches!(url.scheme(), "https" | "http") {
        return Err(AppError::BadRequest(
            "provider base URL scheme is unsupported".into(),
        ));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub(crate) async fn resolve_public_targets(
    kind: ProviderKind,
    value: &str,
    resolver: &dyn EndpointResolver,
) -> Result<Vec<SocketAddr>, AppError> {
    let validated = validate_base_url(kind, value)?;
    let url = Url::parse(&validated)
        .map_err(|_| AppError::BadRequest("provider base URL is invalid".into()))?;
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("provider base URL requires a host".into()))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::BadRequest("provider base URL requires a port".into()))?;
    let targets = resolver.resolve(host, port).await?;
    if targets.is_empty() {
        return Err(AppError::BadRequest(
            "provider hostname resolved to no targets".into(),
        ));
    }
    let internal_ollama = kind == ProviderKind::Ollama
        && matches!(
            host.to_ascii_lowercase().as_str(),
            "ollama" | "mlearn-backend"
        );
    if !internal_ollama && targets.iter().any(|target| forbidden_ip(target.ip())) {
        return Err(AppError::BadRequest(
            "provider hostname resolved to a forbidden network".into(),
        ));
    }
    let mut targets = targets;
    targets.sort_unstable();
    targets.dedup();
    Ok(targets)
}

fn is_forbidden_host(host: &Host<&str>, name: &str) -> bool {
    if name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".internal")
        || name == "metadata.google.internal"
    {
        return true;
    }
    match host {
        Host::Ipv4(ip) => forbidden_v4(*ip),
        Host::Ipv6(ip) => forbidden_v6(*ip),
        Host::Domain(_) => false,
    }
}

fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => forbidden_v4(ip),
        IpAddr::V6(ip) => forbidden_v6(ip),
    }
}

fn forbidden_v4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.octets()[0] == 0
        || ip.octets()[0] >= 224
}

fn forbidden_v6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (ip.segments()[0] & 0xfe00) == 0xfc00
        || (ip.segments()[0] & 0xffc0) == 0xfe80
        || matches!(ip.to_ipv4_mapped(), Some(v4) if forbidden_v4(v4))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        future::Future,
        net::SocketAddr,
        pin::Pin,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
    };

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::{EndpointResolver, PinnedEndpoint, ProviderKind};

    struct FixedResolver(Vec<SocketAddr>);

    impl EndpointResolver for FixedResolver {
        fn resolve<'a>(
            &'a self,
            _host: &'a str,
            _port: u16,
        ) -> Pin<
            Box<dyn Future<Output = Result<Vec<SocketAddr>, crate::error::AppError>> + Send + 'a>,
        > {
            let targets = self.0.clone();
            Box::pin(async move { Ok(targets) })
        }
    }

    struct ChangingResolver(Mutex<VecDeque<Vec<SocketAddr>>>);

    impl EndpointResolver for ChangingResolver {
        fn resolve<'a>(
            &'a self,
            _host: &'a str,
            _port: u16,
        ) -> Pin<
            Box<dyn Future<Output = Result<Vec<SocketAddr>, crate::error::AppError>> + Send + 'a>,
        > {
            Box::pin(async move {
                self.0.lock().unwrap().pop_front().ok_or_else(|| {
                    crate::error::AppError::Internal("test resolver exhausted".into())
                })
            })
        }
    }

    async fn response_server(
        status: &str,
        headers: &str,
        body: &str,
    ) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        );
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (address, handle)
    }

    async fn tracked_server(
        body: &'static str,
    ) -> (SocketAddr, Arc<AtomicBool>, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let connected = Arc::new(AtomicBool::new(false));
        let connected_for_task = connected.clone();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            connected_for_task.store(true, Ordering::SeqCst);
            let mut request = [0_u8; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (address, connected, handle)
    }

    #[tokio::test]
    async fn pinned_endpoint_retains_hostname_and_rejects_absolute_request_targets() {
        let endpoint = PinnedEndpoint::resolve(
            ProviderKind::Ollama,
            "http://ollama:11434",
            &FixedResolver(vec!["127.0.0.1:11434".parse().unwrap()]),
        )
        .await
        .unwrap();
        let request = endpoint
            .request(reqwest::Method::POST, "api/chat")
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.url().host_str(), Some("ollama"));
        assert_eq!(request.url().path(), "/api/chat");
        assert!(endpoint
            .request(reqwest::Method::GET, "http://127.0.0.1/metadata")
            .is_err());
    }

    #[tokio::test]
    async fn dns_changes_after_validation_cannot_change_the_connection_target() {
        let (first, first_server) = response_server("200 OK", "", "first").await;
        let (second, second_connected, second_server) = tracked_server("second").await;
        let resolver = ChangingResolver(Mutex::new(VecDeque::from([vec![first], vec![second]])));
        let endpoint = PinnedEndpoint::resolve(
            ProviderKind::Ollama,
            &format!("http://ollama:{}", first.port()),
            &resolver,
        )
        .await
        .unwrap();
        assert_eq!(
            resolver.resolve("ollama", first.port()).await.unwrap(),
            vec![second]
        );

        let body = endpoint
            .request(reqwest::Method::GET, "api/status")
            .unwrap()
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "first");
        assert!(!second_connected.load(Ordering::SeqCst));
        second_server.abort();
        first_server.await.unwrap();
    }

    #[tokio::test]
    async fn redirect_to_private_target_is_never_followed() {
        let (private, private_connected, private_server) = tracked_server("private").await;
        let (source, source_server) = response_server(
            "302 Found",
            &format!("Location: http://{private}/metadata\r\n"),
            "",
        )
        .await;
        let endpoint = PinnedEndpoint::resolve(
            ProviderKind::Ollama,
            &format!("http://ollama:{}", source.port()),
            &FixedResolver(vec![source]),
        )
        .await
        .unwrap();

        let response = endpoint
            .request(reqwest::Method::GET, "api/status")
            .unwrap()
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        assert!(!private_connected.load(Ordering::SeqCst));
        private_server.abort();
        source_server.await.unwrap();
    }
}
