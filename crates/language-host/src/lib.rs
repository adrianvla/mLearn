mod execute;
mod resources;
pub use resources::{Resource, ResourceKind};
pub use execute::{AssetMap, CompiledPlugin, ExecutionPolicy, ResourcePaths, Resources};

/// Executable origin is fixed by the native host, never by renderer input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodePolicy { MobileBundled, DesktopDownloaded }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodeOrigin { Bundle, Download }
impl CodePolicy {
    pub fn authorize(self, origin: CodeOrigin) -> Result<(), String> {
        match (self, origin) {
            (Self::MobileBundled, CodeOrigin::Bundle) | (Self::DesktopDownloaded, CodeOrigin::Download) => Ok(()),
            _ => Err("Executable origin is prohibited on this platform".into()),
        }
    }
    pub fn label(self) -> &'static str {
        match self { Self::MobileBundled => "mobile-bundled", Self::DesktopDownloaded => "desktop-downloaded" }
    }
}
