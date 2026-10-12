fn main() {
    println!("cargo:rerun-if-env-changed=MLEARN_RELEASE_CATALOG_TRUST");
    let trust_file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.mlearn/dev-trust.json");
    println!("cargo:rerun-if-changed={}", trust_file.display());
    let trust = if std::env::var("PROFILE").as_deref() == Ok("debug") {
        std::fs::read_to_string(&trust_file).ok()
    } else {
        // Publisher supplies {url, publicKey}; the local development key is never trusted in release.
        std::env::var("MLEARN_RELEASE_CATALOG_TRUST").ok()
    };
    if let Some(trust) = trust {
        if trust.contains(['\n', '\r']) { panic!("Catalog trust must be single-line JSON"); }
        println!("cargo:rustc-env=MLEARN_CATALOG_TRUST={trust}");
    }
    tauri_build::build();
}
