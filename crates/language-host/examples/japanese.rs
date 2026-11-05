//! Real ABI measurement/proof. Explicit paths keep private corpora out of tests.
use mlearn_language_host::{AssetMap, CompiledPlugin, ExecutionPolicy, Resource, ResourceKind, Resources};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

fn resource(path: &Path, kind: ResourceKind) -> Result<Resource, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let size = usize::try_from(file.metadata().map_err(|e| e.to_string())?.len()).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Resource::open(path, size, &format!("{:x}", hash.finalize()), kind)
}
fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 5 { return Err("Usage: japanese MODULE DICTIONARY LEXICON REFERENCE_JSONL".into()); }
    let code = std::fs::read(&args[1]).map_err(|e| e.to_string())?;
    let resources = Resources::from([
        ("sudachi.dic".into(), resource(Path::new(&args[2]), ResourceKind::BytesV1)?),
        ("lexicon.sqlite".into(), resource(Path::new(&args[3]), ResourceKind::KeyValueSqliteV1)?),
    ]);
    let plugin = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), resources, ExecutionPolicy::PersistentV1)?;
    println!("{}", json!({"kind":"description","value":plugin.invoke("language.describe.v1", Value::Null)?}));
    let reference = std::fs::read_to_string(&args[4]).map_err(|e| e.to_string())?;
    let cases: Vec<Value> = reference.lines().map(serde_json::from_str::<Value>).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?.into_iter().filter(|v| v["kind"] == "analysis").collect();
    let mut targets = std::collections::BTreeSet::new();
    for case in &cases {
        let input = case["input"].as_str().ok_or("Invalid reference text")?;
        let output = plugin.invoke("text.analyze.v1", json!({"texts":[input]}))?;
        let tokens = output[0].as_array().ok_or("Invalid token batch")?;
        let expected = case["tokens"].as_array().ok_or("Invalid reference tokens")?.iter().filter(|t| t["start"] != t["end"]).collect::<Vec<_>>();
        if tokens.len() != expected.len() { return Err(format!("Token count differs for {input:?}")); }
        let mut cursor = 0;
        for (token, expected) in tokens.iter().zip(expected) {
            let end = token["end"].as_u64().ok_or("Missing end")? as usize;
            if token["start"] != cursor || input.get(cursor..end) != token["text"].as_str() || token["start"] != expected["start"] || token["end"] != expected["end"] || token["text"] != expected["surface"] {
                return Err(format!("Original UTF-8 source mismatch: {token} / {expected}"));
            }
            cursor = end;
            for target in token["targets"].as_array().ok_or("Missing targets")? {
                targets.insert(target.as_str().ok_or("Invalid target")?.to_owned());
            }
        }
        if cursor != input.len() { return Err("Source coverage incomplete".into()); }
        println!("{}", json!({"kind":"analysis","input":input,"tokens":tokens}));
    }
    if targets.is_empty() { return Err("No genuine lexical associations".into()); }
    for target in &targets {
        let entry = plugin.invoke("target.inspect.v1", json!({"targetId":target}))?;
        if entry["targetId"] != *target || entry["definition"].as_str().is_none_or(str::is_empty) || entry["reading"].as_str().is_none_or(str::is_empty) { return Err("Missing genuine lexical entry".into()); }
        println!("{}", json!({"kind":"entry","value":entry}));
    }
    let texts: Vec<_> = cases.iter().map(|v| v["input"].clone()).collect();
    let started = std::time::Instant::now();
    for _ in 0..10 { plugin.invoke("text.analyze.v1", json!({"texts":texts}))?; }
    println!("{}", json!({"kind":"proof","inputs":cases.len(),"inspected":targets.len(),"warm_batches":10,"elapsed_us":started.elapsed().as_micros()}));
    Ok(())
}
