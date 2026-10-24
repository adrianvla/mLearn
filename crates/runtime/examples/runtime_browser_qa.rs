//! Test-only JSON-lines host for the real native owner, not an application backend.
use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, RuntimeExecutor, catalog::CatalogTrust};
use serde::Deserialize;
use std::io::{BufRead, Read, Write};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Invocation {
    id: u32,
    command: String,
    request: Option<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let profile = arguments
        .next()
        .ok_or("Usage: runtime_browser_qa ISOLATED_PROFILE CATALOG_TRUST_JSON")?;
    let trust: CatalogTrust = serde_json::from_str(
        &arguments
            .next()
            .ok_or("An explicit authenticated fixture catalog is required")?,
    )?;
    if arguments.next().is_some() {
        return Err("Unexpected QA host argument".into());
    }
    let runtime = RuntimeExecutor::new(Runtime::open(
        std::path::Path::new(&profile),
        CodePolicy::DesktopDownloaded,
        Some(trust),
        vec![],
    )?);
    let mut stdout = std::io::stdout().lock();
    writeln!(
        stdout,
        "{}",
        serde_json::json!({"event":"ready","policy":"desktop_downloaded"})
    )?;
    stdout.flush()?;
    let mut stdin = std::io::stdin().lock();
    loop {
        let mut line = Vec::new();
        let length = stdin.by_ref().take(524_289).read_until(b'\n', &mut line)?;
        if length == 0 {
            break;
        }
        if length > 524_288 {
            return Err("QA invocation exceeds its bounded envelope".into());
        }
        let invocation: Invocation = serde_json::from_slice(&line)?;
        let result = match invocation.command.as_str() {
            "runtime_execute" => invocation
                .request
                .as_ref()
                .map(|request| serde_json::Value::String(runtime.execute(request)))
                .ok_or("Missing native request"),
            "cancel_source_open" => {
                runtime
                    .cancellation_handle()
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                Ok(serde_json::Value::Null)
            }
            _ => Err(
                "This browser-core harness does not provide native window/media/clipboard services",
            ),
        };
        let output = match result {
            Ok(value) => serde_json::json!({"id":invocation.id,"value":value}),
            Err(error) => serde_json::json!({"id":invocation.id,"error":error}),
        };
        writeln!(stdout, "{output}")?;
        stdout.flush()?;
    }
    // Drop joins the real native generation owner, including an in-flight HTTP read.
    drop(runtime);
    Ok(())
}
