use std::alloc::System;
use std::error::Error;
use std::time::Instant;

use mlearn_japanese_engine::JapaneseEngine;
use serde_json::json;
use stats_alloc::{Region, StatsAlloc, INSTRUMENTED_SYSTEM};

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

fn allocation_json(stats: stats_alloc::Stats) -> serde_json::Value {
    json!({
        "allocations":stats.allocations, "deallocations":stats.deallocations,
        "reallocations":stats.reallocations, "bytes_allocated":stats.bytes_allocated,
        "bytes_deallocated":stats.bytes_deallocated, "bytes_reallocated":stats.bytes_reallocated,
    })
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let dictionary = args
        .next()
        .ok_or("usage: probe system.dic [subtitles.srt]")?;
    let read_start = Instant::now();
    let lifetime = Region::new(GLOBAL);
    let bytes = std::fs::read(dictionary)?;
    let read_us = read_start.elapsed().as_micros();
    let initialization = Region::new(GLOBAL);
    let init_start = Instant::now();
    let mut engine = JapaneseEngine::from_dictionary_bytes(bytes)?;
    let init_us = init_start.elapsed().as_micros();
    let init_allocations = initialization.change();
    println!(
        "{}",
        json!({
            "kind":"initialization", "dictionary_read_us":read_us,
            "engine_init_us":init_us, "allocations":allocation_json(init_allocations),
            "dictionary_bytes":mlearn_japanese_engine::DICTIONARY_BYTES,
        })
    );

    let mut inputs = [
        "食べました",
        "行った",
        "東京都に行った",
        "国家公務員",
        " \t東京都に😀行った　ＡＢＣ ㍿ ｶﾞｯﾂﾎﾟｰｽﾞ\n",
        "附属 付属 すだち かーーーわいい 漢字(かんじ)",
        "",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    if let Some(path) = args.next() {
        let srt = std::fs::read_to_string(path)?;
        for cue in srt.replace("\r\n", "\n").split("\n\n") {
            let text = cue.lines().skip(2).collect::<Vec<_>>().join("\n");
            if !text.is_empty() {
                inputs.push(text);
            }
        }
    }
    for text in &inputs {
        let start = Instant::now();
        let tokens = engine.analyze(text)?;
        for token in &tokens {
            if text.get(token.start..token.end) != Some(token.surface.as_str()) {
                return Err("token span does not address its original surface".into());
            }
        }
        println!(
            "{}",
            json!({
                "kind":"analysis", "input":text,
                "elapsed_us":start.elapsed().as_micros(), "tokens":tokens,
            })
        );
    }
    let warm = Region::new(GLOBAL);
    let start = Instant::now();
    let mut token_count = 0;
    for _ in 0..100 {
        for text in &inputs {
            token_count += engine.analyze(text)?.len();
        }
    }
    let warm_us = start.elapsed().as_micros();
    let warm_allocations = warm.change();
    println!(
        "{}",
        json!({
            "kind":"warm_batch", "calls":100 * inputs.len(),
            "tokens":token_count, "elapsed_us":warm_us,
            "allocations":allocation_json(warm_allocations),
        })
    );
    drop(engine);
    drop(inputs);
    println!(
        "{}",
        json!({
            "kind":"after_drop", "allocations":allocation_json(lifetime.change()),
        })
    );
    Ok(())
}
