use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
};

use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroize;

use crate::error::AppError;

pub(crate) fn load_or_generate_32(path: &Path, purpose: &str) -> Result<[u8; 32], AppError> {
    match read_32(path, purpose) {
        Ok(key) => return Ok(key),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(key_error("read", path, purpose, error)),
    }
    let mut generated = [0_u8; 32];
    OsRng.fill_bytes(&mut generated);
    persist_new_32(path, &generated, purpose)?;
    generated.zeroize();
    read_32(path, purpose).map_err(|error| key_error("read", path, purpose, error))
}

pub(crate) fn read_32(path: &Path, purpose: &str) -> std::io::Result<[u8; 32]> {
    #[cfg(not(unix))]
    if fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(std::io::Error::new(
            ErrorKind::PermissionDenied,
            format!("refusing {purpose} symlink"),
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let mut file = options.open(path)?;
    if !file.metadata()?.file_type().is_file() {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            format!("{purpose} must be a regular file"),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        if file.metadata()?.permissions().mode() & 0o7777 != 0o600 {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                format!("{purpose} permissions must be 0600"),
            ));
        }
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    bytes.try_into().map_err(|_| {
        std::io::Error::new(
            ErrorKind::InvalidData,
            format!("{purpose} must be exactly 32 bytes"),
        )
    })
}

pub(crate) fn persist_new_32(path: &Path, bytes: &[u8; 32], purpose: &str) -> Result<(), AppError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| key_error("create directory for", path, purpose, error))?;
    }
    let temp_path = temporary_path(path);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&temp_path)
        .map_err(|error| key_error("create temporary", path, purpose, error))?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        match fs::hard_link(&temp_path, path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    })();
    drop(file);
    let _ = fs::remove_file(&temp_path);
    result.map_err(|error| key_error("persist", path, purpose, error))
}

fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("secret-key");
    path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::now_v7()))
}

fn key_error(action: &str, path: &Path, purpose: &str, error: std::io::Error) -> AppError {
    AppError::Internal(format!(
        "failed to {action} {purpose} at {}: {error}",
        path.display()
    ))
}
