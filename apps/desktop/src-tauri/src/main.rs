#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // WebKitGTK 2.50+ rejects nonstandard media protocols before decoding.
        // This fixed protocol resolves only admitted source IDs in our host; it
        // does not grant arbitrary filesystem access or enable other schemes.
        // Remove this exception if media moves to a standard streaming scheme.
        // SAFETY: this is the first action in main, before Tauri starts threads
        // or launches the WebKit subprocess that consumes the environment.
        unsafe { std::env::set_var("WEBKIT_GST_ALLOWED_URI_PROTOCOLS", "mlearn-media") };
    }
    mlearn_desktop::run();
}
