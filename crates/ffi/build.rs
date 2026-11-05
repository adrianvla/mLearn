use std::{fs, path::{Path, PathBuf}};
fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let bundle = root.join("bundle.json");
    println!("cargo:rerun-if-changed={}", bundle.display());
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let mobile = matches!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("ios" | "android")) || std::env::var_os("CARGO_FEATURE_MOBILE_BUNDLE").is_some();
    let mut source = String::from("fn bundled_plugins() -> Result<Vec<mlearn_runtime::BundledPlugin>, String> { let mut plugins = Vec::new();\n");
    if mobile {
        let text = fs::read_to_string(&bundle).expect("Run npm run build:plugin before building the mobile Rust module");
        let manifests: Vec<serde_json::Value> = serde_json::from_str(&text).expect("Invalid build-time bundle manifest");
        for (index, manifest) in manifests.iter().enumerate() {
            let copy = |relative: &str, name: &str| {
                assert!(Path::new(relative).components().all(|part| matches!(part, std::path::Component::Normal(_))), "Unsafe bundle path");
                let path = root.join(relative);
                println!("cargo:rerun-if-changed={}", path.display());
                fs::copy(path, out.join(name)).expect("Missing plugin build artifact");
            };
            copy(manifest["code"]["path"].as_str().unwrap(), &format!("code-{index}.wasm"));
            source.push_str(&format!("let manifest = serde_json::from_str::<mlearn_runtime::catalog::Manifest>({:?}).map_err(|e| e.to_string())?;\nlet mut assets = std::collections::BTreeMap::new();\n", manifest.to_string()));
            for (asset_index, (key, artifact)) in manifest["assets"].as_object().unwrap().iter().enumerate() {
                let name = format!("asset-{index}-{asset_index}.bin");
                copy(artifact["path"].as_str().unwrap(), &name);
                source.push_str(&format!("assets.insert({key:?}.into(), std::borrow::Cow::Borrowed(&include_bytes!(concat!(env!(\"OUT_DIR\"), \"/{name}\"))[..]));\n"));
            }
            source.push_str(&format!("plugins.push(mlearn_runtime::BundledPlugin {{ manifest, code: include_bytes!(concat!(env!(\"OUT_DIR\"), \"/code-{index}.wasm\")).to_vec(), assets }});\n"));
        }
    }
    source.push_str("Ok(plugins) }\n");
    fs::write(out.join("bundled.rs"), source).unwrap();
}
