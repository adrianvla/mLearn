//! Test-only JSON-lines host for the real native owner, not an application backend.
use mlearn_language_host::CodePolicy;
use mlearn_runtime::{catalog::CatalogTrust, BoundedReadError, Runtime, RuntimeExecutor};
use serde::Deserialize;
use std::io::{BufRead, Read, Write};
use std::sync::{mpsc, Arc, Mutex};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Invocation {
    id: u32,
    command: String,
    request: Option<String>,
    read_id: Option<String>,
}

fn read_error(error: BoundedReadError) -> serde_json::Value {
    serde_json::json!({"code": error.code(), "message": error.to_string()})
}

fn invoke(
    runtime: &RuntimeExecutor,
    invocation: &Invocation,
) -> Result<serde_json::Value, serde_json::Value> {
    let request = || {
        invocation
            .request
            .as_deref()
            .ok_or_else(|| serde_json::json!("Missing native request"))
    };
    let id = || {
        invocation
            .read_id
            .as_deref()
            .ok_or_else(|| serde_json::json!("Missing bounded read handle"))
    };
    match invocation.command.as_str() {
        "runtime_execute" => Ok(serde_json::Value::String(runtime.execute(request()?))),
        "begin_bounded_read" => runtime
            .begin_bounded_read()
            .map(serde_json::Value::String)
            .map_err(read_error),
        "execute_bounded_read" => Ok(serde_json::Value::String(
            runtime.execute_bounded_read(id()?, request()?),
        )),
        "cancel_bounded_read" => runtime
            .cancel_bounded_read(id()?)
            .map(|_| serde_json::Value::Null)
            .map_err(read_error),
        "cancel_source_open" => {
            runtime.cancel_source_open();
            Ok(serde_json::Value::Null)
        }
        _ => Err(serde_json::json!(
            "This browser-core harness does not provide native window/media/clipboard services"
        )),
    }
}

fn reply(
    stdout: &Mutex<std::io::Stdout>,
    id: u32,
    result: Result<serde_json::Value, serde_json::Value>,
) -> Result<(), String> {
    let output = match result {
        Ok(value) => serde_json::json!({"id":id,"value":value}),
        Err(error) => serde_json::json!({"id":id,"error":error}),
    };
    let mut stdout = stdout
        .lock()
        .map_err(|_| "QA output lock poisoned".to_owned())?;
    writeln!(stdout, "{output}").map_err(|error| error.to_string())?;
    stdout.flush().map_err(|error| error.to_string())
}

fn worker(
    receiver: Arc<Mutex<mpsc::Receiver<Invocation>>>,
    runtime: &RuntimeExecutor,
    stdout: &Mutex<std::io::Stdout>,
) -> Result<(), String> {
    loop {
        let received = receiver
            .lock()
            .map_err(|_| "QA input lock poisoned".to_owned())?
            .recv();
        let invocation = match received {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        reply(stdout, invocation.id, invoke(runtime, &invocation))?;
    }
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
        let (controls, control_receiver) = mpsc::sync_channel::<Invocation>(2);
        let mut workers = Vec::with_capacity(5);
        for (count, receiver) in [(3, receiver), (2, control_receiver)] {
            let receiver = Arc::new(Mutex::new(receiver));
            for _ in 0..count {
                let receiver = Arc::clone(&receiver);
                let runtime = &runtime;
                let stdout = &stdout;
                workers.push(scope.spawn(move || worker(receiver, runtime, stdout)));
            }
        }
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
            if matches!(
                invocation.command.as_str(),
                "begin_bounded_read" | "cancel_source_open"
            ) {
                reply(&stdout, invocation.id, invoke(&runtime, &invocation))?;
                continue;
            }
            let destination = if invocation.command == "cancel_bounded_read" {
                &controls
            } else {
                &sender
            };
            // Never block this input/control dispatcher behind the ordinary queue.
            if let Err(error) = destination.try_send(invocation) {
                let (invocation, error) = match error {
                    mpsc::TrySendError::Full(invocation) => {
                        (invocation, read_error(BoundedReadError::Busy))
                    }
                    mpsc::TrySendError::Disconnected(invocation) => (
                        invocation,
                        serde_json::json!({"code":"operation_failed","message":"QA worker disconnected"}),
                    ),
                };
                reply(&stdout, invocation.id, Err(error))?;
            }
        }
        drop(sender);
        drop(controls);
        for worker in workers {
            worker.join().map_err(|_| "QA worker panicked")??;
        }
        Ok(())
    })?;
    // Drop joins the real native generation owner, including an in-flight HTTP read.
    drop(runtime);
    Ok(())
}
