use axum::{extract::State, Json};

use crate::{
    dto::{CacheItem, DistributionDto, LanEndpoint, MirrorStatus, SyncRule},
    error::AppError,
    state::AppState,
};

pub async fn get_distribution(
    State(state): State<AppState>,
) -> Result<Json<DistributionDto>, AppError> {
    let catalog_url = state
        .config
        .feature_flags
        .iter()
        .find(|(name, _)| name == "local-catalog-mirror")
        .map(|_| "/catalog/language-catalog.json".to_string())
        .unwrap_or_else(|| "https://mlearn.kikan.net/language-catalog.json".to_string());

    Ok(Json(DistributionDto {
        catalog_mirror: MirrorStatus {
            enabled: true,
            catalog_url,
            last_sync: Some("12 minutes ago".to_string()),
            cached_bytes: 8_912_445_440,
            item_count: 42,
        },
        cache_items: vec![
            CacheItem {
                kind: "Language package".to_string(),
                name: "Japanese core".to_string(),
                version: "2026.07".to_string(),
                size_bytes: 1_422_131_200,
                served_locally: true,
            },
            CacheItem {
                kind: "Dictionary".to_string(),
                name: "English target dictionary".to_string(),
                version: "2026.06".to_string(),
                size_bytes: 519_045_120,
                served_locally: true,
            },
            CacheItem {
                kind: "Model".to_string(),
                name: "OCR adapter bundle".to_string(),
                version: "2026.05".to_string(),
                size_bytes: 2_771_419_136,
                served_locally: true,
            },
        ],
        lan_endpoints: vec![
            LanEndpoint {
                label: "Catalog".to_string(),
                url: "http://mlearn.local/catalog/language-catalog.json".to_string(),
                status: "online".to_string(),
            },
            LanEndpoint {
                label: "Model cache".to_string(),
                url: "http://mlearn.local/cache/models/".to_string(),
                status: "online".to_string(),
            },
            LanEndpoint {
                label: "Client policy".to_string(),
                url: "http://mlearn.local/policy/client.json".to_string(),
                status: "online".to_string(),
            },
        ],
        sync_rules: vec![
            SyncRule {
                id: "catalog".to_string(),
                label: "Mirror catalog archives".to_string(),
                source: "Configured languageCatalogUrl".to_string(),
                destination: "/data/language-cache".to_string(),
                mode: "Prefer LAN, refresh upstream hourly".to_string(),
            },
            SyncRule {
                id: "app-artifacts".to_string(),
                label: "Cache desktop app downloads".to_string(),
                source: "Release feed".to_string(),
                destination: "/data/app-artifacts".to_string(),
                mode: "Serve locally when version matches".to_string(),
            },
        ],
    }))
}
