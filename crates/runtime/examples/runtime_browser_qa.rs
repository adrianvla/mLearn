//! Test-only JSON-lines host for the real native owner, not an application backend.
use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, RuntimeExecutor, catalog::CatalogTrust};
use serde::Deserialize;
use std::io::{BufRead, Read, Write};
use std::sync::{Arc, Mutex, mpsc};

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
    let stdout = Mutex::new(std::io::stdout());
    {
        let mut output = stdout.lock().map_err(|_| "QA output lock poisoned")?;
        writeln!(
            output,
            "{}",
            serde_json::json!({"event":"ready","policy":"desktop_downloaded"})
        )?;
        output.flush()?;
    }
    std::thread::scope(|scope| -> Result<(), Box<dyn std::error::Error>> {
        // Match the native host's blocking-worker boundary: a transfer must not
        // serialize the status/cancel calls that control it. The real executor
        // retains its own three-call/guest admission policy.
        let (sender, receiver) = mpsc::sync_channel::<Invocation>(32);
        let receiver = Arc::new(Mutex::new(receiver));
        let mut workers = Vec::with_capacity(3);
        for _ in 0..3 {
            let receiver = Arc::clone(&receiver);
            let runtime = &runtime;
            let stdout = &stdout;
            workers.push(scope.spawn(move || -> Result<(), String> {
                loop {
                    let received = receiver
                        .lock()
                        .map_err(|_| "QA input lock poisoned".to_owned())?
                        .recv();
                    let invocation = match received {
                        Ok(invocation) => invocation,
                        Err(_) => return Ok(()),
                    };
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
                    let mut stdout = stdout
                        .lock()
                        .map_err(|_| "QA output lock poisoned".to_owned())?;
                    writeln!(stdout, "{output}").map_err(|error| error.to_string())?;
                    stdout.flush().map_err(|error| error.to_string())?;
                }
            }));
        }
        drop(receiver);
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
            sender.send(invocation)?;
        }
        drop(sender);
        for worker in workers {
            worker.join().map_err(|_| "QA worker panicked")??;
        }
        Ok(())
    })?;
    // Drop joins the real native generation owner, including an in-flight HTTP read.
    drop(runtime);
    Ok(())
}
