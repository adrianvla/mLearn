use mlearn_desktop_ocr::session::{Graph, initialize};
use std::path::Path;

fn main() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let library = args.first().ok_or("Usage: inspect ORT_LIBRARY MODEL...")?;
    initialize(Path::new(library))?;
    for model in &args[1..] {
        let graph = Graph::open(Path::new(model), false)?;
        println!(
            "{}",
            serde_json::json!({
                "model": Path::new(model).file_name().and_then(|name| name.to_str()),
                "schema": graph.schema()?,
                "backend": graph.backend,
            })
        );
    }
    Ok(())
}
