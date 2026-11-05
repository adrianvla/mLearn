//! Explicit publisher utility. Cargo builds/tests never acquire OCR resources.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::write::SimpleFileOptions;

#[derive(Serialize)]
struct Entry {
    sha256: String,
    byte_length: usize,
}

fn files(
    root: &Path,
    directory: &Path,
    result: &mut BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            return Err("Native publisher input must not contain symlinks".into());
        }
        if kind.is_dir() {
            files(root, &entry.path(), result)?;
        } else if kind.is_file() {
            let path = entry.path();
            let name = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_str()
                .ok_or("Non-UTF8 native resource name")?
                .replace('\\', "/");
            if name == "inventory.json" || name.len() > 256 || result.len() >= 65536 {
                return Err("Native publisher input exceeds its path/file bounds".into());
            }
            result.insert(name, path);
        } else {
            return Err("Native publisher input must contain ordinary files".into());
        }
    }
    Ok(())
}

fn identity(path: &Path) -> Result<Entry, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut size = 0_usize;
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        size = size
            .checked_add(count)
            .ok_or("Native artifact size overflow")?;
        digest.update(&buffer[..count]);
    }
    Ok(Entry {
        sha256: format!("{:x}", digest.finalize()),
        byte_length: size,
    })
}

fn archive(root: &Path, output: &Path) -> Result<serde_json::Value, String> {
    let mut paths = BTreeMap::new();
    files(root, root, &mut paths)?;
    if paths.is_empty() {
        return Err("Native publisher archive must not be empty".into());
    }
    let mut inventory = BTreeMap::new();
    let mut total = 0_usize;
    for (name, path) in &paths {
        let entry = identity(path)?;
        total = total
            .checked_add(entry.byte_length)
            .ok_or("Native archive size overflow")?;
        if total > 4 * 1024 * 1024 * 1024 {
            return Err("Native expanded archive exceeds 4 GiB".into());
        }
        inventory.insert(name, entry);
    }
    let index = serde_json::to_vec(&inventory).map_err(|error| error.to_string())?;
    if index.len() > 16 * 1024 * 1024 {
        return Err("Native inventory exceeds 16 MiB".into());
    }
    let mut archive = zip::ZipWriter::new(File::create(output).map_err(|error| error.to_string())?);
    for (name, path) in paths {
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(1))
            .unix_permissions(0o444);
        archive
            .start_file(name, options)
            .map_err(|error| error.to_string())?;
        std::io::copy(
            &mut File::open(path).map_err(|error| error.to_string())?,
            &mut archive,
        )
        .map_err(|error| error.to_string())?;
    }
    archive
        .start_file("inventory.json", SimpleFileOptions::default())
        .map_err(|error| error.to_string())?;
    archive
        .write_all(&index)
        .map_err(|error| error.to_string())?;
    archive
        .finish()
        .map_err(|error| error.to_string())?
        .sync_all()
        .map_err(|error| error.to_string())?;
    let artifact = identity(output)?;
    if artifact.byte_length > 2 * 1024 * 1024 * 1024 {
        return Err("Native compressed archive exceeds 2 GiB".into());
    }
    Ok(
        serde_json::json!({"sha256":artifact.sha256,"byteLength":artifact.byte_length,
        "indexSha256":format!("{:x}",Sha256::digest(index))}),
    )
}

fn main() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err(
            "Usage: package_native_ocr RUNTIME_DIRECTORY MODELS_DIRECTORY OUTPUT_DIRECTORY".into(),
        );
    }
    let output = Path::new(&args[2]);
    std::fs::create_dir_all(output).map_err(|error| error.to_string())?;
    let runtime = archive(Path::new(&args[0]), &output.join("runtime.zip"))?;
    let models = archive(Path::new(&args[1]), &output.join("models.zip"))?;
    let metadata =
        serde_json::to_vec_pretty(&serde_json::json!({"runtime":runtime,"models":models}))
            .map_err(|error| error.to_string())?;
    std::fs::write(output.join("artifacts.json"), metadata).map_err(|error| error.to_string())?;
    println!("NATIVE_OCR_RESOURCES_PACKAGED");
    Ok(())
}
