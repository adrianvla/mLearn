//! Integration fixture, not a language analyzer. It has no application-core dependency.
use mlearn_language_sdk::{Call, serde_json::{self, Value}};

pub fn greet(call: Call, prefix: &str) -> Result<Value, String> {
    if call.capability != "example::hello" { return Err("Unsupported capability".into()); }
    let name = call.input.get("name").and_then(Value::as_str).ok_or("Expected a name")?.trim();
    if name.is_empty() || name.len() > 512 { return Err("Name must contain 1–512 bytes".into()); }
    Ok(serde_json::json!({"message": format!("{prefix}{name}!"), "implementation": "Rust plugin / Wasmi"}))
}

fn handle(call: Call) -> Result<Value, String> {
    let data: Value = serde_json::from_slice(&mlearn_language_sdk::read_asset("greeting.json")?).map_err(|e| e.to_string())?;
    let prefix = data.get("prefix").and_then(Value::as_str).ok_or("Invalid greeting asset")?;
    greet(call, prefix)
}

mlearn_language_sdk::export_plugin!(handle);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn respects_unicode_and_rejects_invalid_input() {
        let call = Call { capability: "example::hello".into(), input: serde_json::json!({"name": "アドリアン"}) };
        assert_eq!(greet(call, "Hello, ").unwrap()["message"], "Hello, アドリアン!");
        assert!(greet(Call { capability: "other::unknown".into(), input: Value::Null }, "").is_err());
    }
}
