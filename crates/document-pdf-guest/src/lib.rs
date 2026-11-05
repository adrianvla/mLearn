//! Internal trusted source-format processor, not a language package or catalog entry.
//! The native build exposes only the bounded wire contract, never a native PDF parser.
#[cfg(target_arch = "wasm32")]
mod extraction;
pub mod wire;
#[cfg(target_arch = "wasm32")]
mlearn_language_sdk::export_plugin!(extraction::handle);
