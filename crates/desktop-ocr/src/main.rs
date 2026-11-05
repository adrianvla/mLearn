fn main() {
    if mlearn_desktop_ocr::worker::handle_process_mode() {
        return;
    }
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if let Err(error) = mlearn_desktop_ocr::worker::run(&args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
