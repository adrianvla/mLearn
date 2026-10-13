use mlearn_language_host::{CodeOrigin, CodePolicy};

#[test]
fn mobile_accepts_bundled_but_never_downloaded_executable_code() {
    assert!(CodePolicy::MobileBundled.authorize(CodeOrigin::Bundle).is_ok());
    assert!(CodePolicy::MobileBundled.authorize(CodeOrigin::Download).is_err());
}

#[test]
fn desktop_accepts_downloaded_but_never_bundled_language_code() {
    assert!(CodePolicy::DesktopDownloaded.authorize(CodeOrigin::Download).is_ok());
    assert!(CodePolicy::DesktopDownloaded.authorize(CodeOrigin::Bundle).is_err());
}
