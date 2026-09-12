fn main() {
    // Re-embed rebuilt frontend assets even when no Rust source changed.
    println!("cargo:rerun-if-changed=../frontend/dist");
}
