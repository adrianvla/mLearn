#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if mlearn_desktop_ocr::worker::handle_process_mode() {
        return;
    }
    mlearn_desktop::run();
}
