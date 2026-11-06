//! Isolated native-UI fixture using the actual bundled package and public runtime.
//! This prepares data only; it does not certify Expo or device interaction.
use mlearn_language_host::CodePolicy;
use mlearn_runtime::{catalog::Manifest, BundledPlugin, Runtime};
use serde_json::{json, Value};
use std::{borrow::Cow, error::Error, io, path::PathBuf};

fn execute(runtime: &mut Runtime, request: Value) -> Result<Value, Box<dyn Error>> {
    let response: Value = serde_json::from_str(&runtime.execute(&request.to_string()))?;
    if response["type"] == "error" {
        return Err(io::Error::other(response.to_string()).into());
    }
    Ok(response)
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next().ok_or("Expected seed or inspect")?;
    let profile = PathBuf::from(args.next().ok_or("Expected isolated profile path")?);
    let bundle_root = args.next().map(PathBuf::from);
    if args.next().is_some() || (mode != "seed" && mode != "inspect") {
        return Err("Usage: mobile_review_seed seed|inspect ISOLATED_PROFILE [BUNDLE_ROOT]".into());
    }
    if mode == "seed" && profile.exists() {
        return Err("Seed requires a new profile; existing data is never replaced".into());
    }
    if mode == "inspect" && !profile.join("profile.sqlite3").is_file() {
        return Err("Inspect requires an existing copied native profile".into());
    }
    let artifacts = bundle_root.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn")
    });
    let manifests: Vec<Manifest> =
        serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json"))?)?;
    let manifest = manifests
        .into_iter()
        .find(|item| item.id == "org.mlearn.english")
        .ok_or("Built English package is unavailable")?;
    let plugin = BundledPlugin {
        code: std::fs::read(artifacts.join(&manifest.code.path))?,
        assets: manifest
            .assets
            .iter()
            .map(|(key, artifact)| {
                Ok((
                    key.clone(),
                    Cow::Owned(std::fs::read(artifacts.join(&artifact.path))?),
                ))
            })
            .collect::<Result<_, io::Error>>()?,
        manifest,
    };
    let mut runtime = Runtime::open(&profile, CodePolicy::MobileBundled, None, vec![plugin])?;
    if mode == "inspect" {
        let sessions = execute(&mut runtime, json!({"type":"review_sessions"}))?;
        let evidence = execute(
            &mut runtime,
            json!({
                "type":"knowledge_evidence", "query":{"key":{
                    "packageId":"org.mlearn.english",
                    "targetId":"org.mlearn.english:grammar/past-simple-negative",
                    "capability":"org.mlearn.english:grammar-form"
                },"after":null}
            }),
        )?;
        println!("{}", json!({"sessions":sessions,"evidence":evidence}));
        return Ok(());
    }
    let entry = execute(
        &mut runtime,
        json!({
            "type":"inspect_target", "packageId":"org.mlearn.english",
            "targetId":"org.mlearn.english:grammar/past-simple-negative"
        }),
    )?;
    let saved = execute(
        &mut runtime,
        json!({
            "type":"create_material", "command":{
                "commandId":"m11-native-material", "distinct":true, "content":{
                    "packageId":"org.mlearn.english",
                    "packageRevision":entry["packageRevision"],
                    "targetId":"org.mlearn.english:grammar/past-simple-negative",
                    "sense":null, "phrase":"Past simple negative",
                    "reading":"", "meaning":"", "context":"", "notes":"",
                    "examples":[], "source":null, "attachments":[]
                }
            }
        }),
    )?;
    let material_id = saved["outcome"]["material"]["id"]
        .as_str()
        .ok_or("Native fixture Material was not saved")?;
    let session = execute(
        &mut runtime,
        json!({
            "type":"review", "command":{"kind":"start","start":{
                "commandId":"m11-native-start", "sessionId":"m11-native-grammar",
                "mode":{"kind":"practice","items":[{"materialId":material_id,"source":null}]}
            }}
        }),
    )?;
    if session["commit"]["session"]["encounter"]["task"]["responseSpec"]["kind"] != "typed_text" {
        return Err("Expected an actual package-authored typed grammar task".into());
    }
    println!("{session}");
    Ok(())
}
