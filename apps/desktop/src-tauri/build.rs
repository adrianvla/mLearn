fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let native = root.join("../../client/modules/mlearn-native");
        let provider = native.join("ios/AppleMediaProvider.swift");
        let entry = native.join("macos/MediaHelper.swift");
        println!("cargo:rerun-if-changed={}", provider.display());
        println!("cargo:rerun-if-changed={}", entry.display());
        let target = std::env::var("TARGET").expect("Cargo target");
        let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
            Ok("aarch64") => "arm64",
            Ok("x86_64") => "x86_64",
            _ => panic!("Unsupported Apple media helper architecture"),
        };
        let binaries = root.join("binaries");
        std::fs::create_dir_all(&binaries).expect("Create media helper build directory");
        let helper = binaries.join(format!("mlearn-media-{target}"));
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output"));
        let compiled = output.join("mlearn-media");
        let recipe = output.join("media-inputs");
        let compiler = std::process::Command::new("xcrun")
            .args(["swiftc", "--version"])
            .output()
            .expect("Identify Apple Swift compiler");
        assert!(
            compiler.status.success(),
            "Cannot identify Apple Swift compiler"
        );
        let mut inputs = include_bytes!("build.rs").to_vec();
        for bytes in [
            std::fs::read(&provider).expect("Read Apple media provider"),
            std::fs::read(&entry).expect("Read Apple media entry"),
            target.as_bytes().to_vec(),
            compiler.stdout,
        ] {
            inputs.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            inputs.extend(bytes);
        }
        // Rewriting a sidecar is a source change to Tauri's development watcher.
        // Keep unchanged compiler inputs and output stable across Cargo reruns.
        if !compiled.is_file() || std::fs::read(&recipe).ok().as_deref() != Some(inputs.as_slice())
        {
            let status = std::process::Command::new("xcrun")
                .args([
                    "swiftc",
                    "-parse-as-library",
                    "-swift-version",
                    "5",
                    "-O",
                    "-target",
                    &format!("{arch}-apple-macos13.0"),
                ])
                .arg(&provider)
                .arg(&entry)
                .arg("-o")
                .arg(&compiled)
                .status()
                .expect("Run Apple Swift compiler for bundled media provider");
            assert!(status.success(), "Apple media provider failed to compile");
            std::fs::write(&recipe, inputs).expect("Record Apple media compiler inputs");
        }
        let bytes = std::fs::read(&compiled).expect("Read compiled Apple media provider");
        if std::fs::read(&helper).ok().as_deref() != Some(bytes.as_slice()) {
            std::fs::copy(&compiled, &helper).expect("Publish bundled Apple media provider");
        }
        println!(
            "cargo:rustc-env=MLEARN_APPLE_MEDIA_HELPER={}",
            helper.display()
        );
    }
    println!("cargo:rerun-if-env-changed=MLEARN_RELEASE_CATALOG_TRUST");
    let trust_file =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.mlearn/dev-trust.json");
    println!("cargo:rerun-if-changed={}", trust_file.display());
    let trust = if std::env::var("PROFILE").as_deref() == Ok("debug") {
        std::fs::read_to_string(&trust_file).ok()
    } else {
        // Publisher supplies {url, publicKey}; the local development key is never trusted in release.
        std::env::var("MLEARN_RELEASE_CATALOG_TRUST").ok()
    };
    if let Some(trust) = trust {
        if trust.contains(['\n', '\r']) {
            panic!("Catalog trust must be single-line JSON");
        }
        println!("cargo:rustc-env=MLEARN_CATALOG_TRUST={trust}");
    }
    tauri_build::build();
}
