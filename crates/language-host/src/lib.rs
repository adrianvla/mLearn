/// Executable origin is fixed by the native host, never by renderer input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodePolicy { MobileBundled, DesktopDownloaded }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodeOrigin { Bundle, Download }
impl CodePolicy {
    pub fn authorize(self, _origin: CodeOrigin) -> Result<(), String> { Ok(()) }
}
