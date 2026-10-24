//! One-shot raster helper protocol, shared by display and OCR PDF preparation.
use base64::Engine;
use mlearn_core::{ImagePageLocation, OcrRect};
use serde::Deserialize;
use std::{
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Display {
        location: ImagePageLocation,
        crop: Option<OcrRect>,
    },
    Pdf {
        location: ImagePageLocation,
        output: PathBuf,
    },
}

fn original(location: &ImagePageLocation) -> Result<image::RgbImage, String> {
    if location.mime_type == "application/pdf" {
        crate::pdf::render(
            std::path::Path::new(&location.path),
            location
                .page_index
                .ok_or("PDF location is missing its page index")?,
        )
    } else {
        if location.page_index.is_some() {
            return Err("An image location cannot select a PDF page".into());
        }
        crate::raster::open(std::path::Path::new(&location.path), 8 * 1024 * 1024)
    }
}

pub(crate) fn run() -> Result<(), String> {
    // The non-Apple production helper also needs an OS allocation boundary:
    // encoded-size/page limits alone cannot bound every PDF decoder allocation.
    // This applies only to the one-shot raster process, never the warm OCR worker.
    #[cfg(target_os = "windows")]
    let _memory_job = {
        use std::os::windows::io::{FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
            Threading::GetCurrentProcess,
        };
        // SAFETY: the new kernel handle is adopted exactly once. Both API input
        // pointers refer to initialized values valid throughout each synchronous
        // call. The handle remains owned until all raster work/output completes.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!(
                    "Cannot create raster memory boundary: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let job = OwnedHandle::from_raw_handle(handle.cast());
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.ProcessMemoryLimit = 512 * 1024 * 1024;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, GetCurrentProcess()) == 0
            {
                return Err(format!(
                    "Cannot enforce raster memory boundary: {}",
                    std::io::Error::last_os_error()
                ));
            }
            job
        }
    };
    #[cfg(target_os = "linux")]
    {
        // Linux accounts anonymous decoder mappings in RLIMIT_DATA too. Keep an
        // inherited stricter limit; do not raise the caller's hard ceiling.
        // SAFETY: getrlimit initializes this C value; setrlimit borrows it only
        // during the call, and changes limits solely in this disposable process.
        unsafe {
            let mut limits: libc::rlimit = std::mem::zeroed();
            if libc::getrlimit(libc::RLIMIT_DATA, &raw mut limits) != 0 {
                return Err(format!(
                    "Cannot read raster memory boundary: {}",
                    std::io::Error::last_os_error()
                ));
            }
            limits.rlim_cur = limits.rlim_cur.min(512 * 1024 * 1024);
            if libc::setrlimit(libc::RLIMIT_DATA, &raw const limits) != 0 {
                return Err(format!(
                    "Cannot enforce raster memory boundary: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
    }
    let mut input = Vec::new();
    std::io::stdin()
        .take(32769)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())?;
    if input.len() > 32768 {
        return Err("Raster helper input exceeds 32 KiB".into());
    }
    let result = match serde_json::from_slice(&input).map_err(|e| e.to_string())? {
        Request::Display { location, crop } => {
            let png = crate::raster::display_pixels(original(&location)?, crop.as_ref())?;
            serde_json::Value::String(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png),
            ))
        }
        Request::Pdf { location, output } => {
            if location.mime_type != "application/pdf" {
                return Err("Raster destination requires an admitted PDF page".into());
            }
            original(&location)?
                .save_with_format(output, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            serde_json::Value::Null
        }
    };
    let bytes = serde_json::to_vec(&result).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Raster helper output exceeds 8 MiB".into());
    }
    std::io::stdout()
        .write_all(&bytes)
        .map_err(|e| e.to_string())
}
