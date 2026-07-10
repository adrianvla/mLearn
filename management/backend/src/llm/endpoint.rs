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

pub(crate) trait EndpointResolver: Send + Sync {
    fn resolve<'a>(
        &'a self,
        host: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>>;
}

pub(crate) struct TokioEndpointResolver;

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

pub fn validate_base_url(kind: ProviderKind, value: &str) -> Result<String, AppError> {
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
