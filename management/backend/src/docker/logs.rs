use bollard::container::LogOutput;
use bollard::query_parameters::LogsOptionsBuilder;
use bollard::Docker;
use futures_util::StreamExt;

use crate::dto::LogLine;
use crate::error::AppError;

pub async fn get_container_logs(
    docker: &Docker,
    id: &str,
    tail: u64,
) -> Result<Vec<LogLine>, AppError> {
    let options = LogsOptionsBuilder::default()
        .stdout(true)
        .stderr(true)
        .timestamps(true)
        .tail(&tail.to_string())
        .build();

    let mut stream = docker.logs(id, Some(options));
    let mut lines = Vec::new();

    while let Some(chunk) = stream.next().await {
        let (stream_name, message) = match chunk? {
            LogOutput::StdOut { message } => ("stdout", message),
            LogOutput::StdErr { message } => ("stderr", message),
            _ => continue,
        };

        let raw = String::from_utf8_lossy(message.as_ref());
        let (timestamp, message_text) = match raw.split_once(' ') {
            Some((ts, rest)) => (Some(ts.to_string()), rest.to_string()),
            None => (None, raw.into_owned()),
        };

        lines.push(LogLine {
            stream: stream_name.to_string(),
            timestamp,
            message: message_text,
        });
    }

    Ok(lines)
}
