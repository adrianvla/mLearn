//! Checked Windows 10 Acrylic boundary. window-vibrancy 0.8.1 discards this
//! API's BOOL result; keep this adapter until its apply/clear paths report it.
use std::{ffi::c_void, mem::size_of};
use windows_sys::{
    Win32::{
        Foundation::HWND,
        System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
    },
    core::w,
};

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    color: u32,
    animation: u32,
}

#[repr(C)]
struct CompositionData {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}

type SetComposition = unsafe extern "system" fn(HWND, *mut CompositionData) -> i32;

pub(super) fn set(hwnd: HWND, color: Option<[u8; 4]>) -> Result<(), String> {
    if windows_version::OsVersion::current().build < 17763 {
        return Err("Acrylic requires Windows 10 version 1809 or newer".into());
    }
    // user32 is already loaded by the window owner. Borrow its handle rather
    // than accumulating LoadLibrary references on every theme transition.
    let module = unsafe { GetModuleHandleW(w!("user32.dll")) };
    if module.is_null() {
        return Err("Native window composition module is unavailable".into());
    }
    let function =
        unsafe { GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast()) }
            .ok_or("SetWindowCompositionAttribute is unavailable")?;
    // The dynamically exported function uses the Win32 composition-data ABI.
    let set = unsafe {
        std::mem::transmute::<unsafe extern "system" fn() -> isize, SetComposition>(function)
    };
    let mut policy = match color {
        Some(color) => AccentPolicy {
            state: 4, // ACCENT_ENABLE_ACRYLICBLURBEHIND
            flags: 0,
            color: u32::from_le_bytes(color),
            animation: 0,
        },
        None => AccentPolicy {
            state: 0, // ACCENT_DISABLED
            flags: 2,
            color: 0,
            animation: 0,
        },
    };
    let mut data = CompositionData {
        attribute: 0x13, // WCA_ACCENT_POLICY, shared by apply and clear.
        data: (&mut policy as *mut AccentPolicy).cast(),
        size: size_of::<AccentPolicy>(),
    };
    // Both stack records remain alive for this synchronous native call.
    if unsafe { set(hwnd, &mut data) } == 0 {
        Err("SetWindowCompositionAttribute rejected the native material".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WS_OVERLAPPEDWINDOW,
    };

    #[test]
    fn native_acrylic_apply_and_clear_release_the_owned_window() {
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                w!("STATIC"),
                w!("mLearn native material verification"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                120,
                90,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!hwnd.is_null(), "Cannot create native verification window");
        let result = set(hwnd, Some([17, 34, 51, 125])).and_then(|()| set(hwnd, None));
        let destroyed = unsafe { DestroyWindow(hwnd) };
        assert_ne!(destroyed, 0, "Native verification window was not released");
        result.unwrap();
    }
}
