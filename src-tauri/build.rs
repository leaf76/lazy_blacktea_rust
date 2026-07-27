fn main() {
    // Unit-test harnesses on Windows do not inherit Tauri's app manifest.
    // Without Common Controls v6, comctl32 lacks TaskDialogIndirect and the
    // test harness fails at process start with STATUS_ENTRYPOINT_NOT_FOUND.
    //
    // Note: cargo test --all also links bin unit-test harnesses (smoke/soak)
    // with tauri-build's resource.lib. Adding a second MANIFEST then causes
    // CVT1100/LNK1123. CI therefore runs `cargo test --lib` only.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app.manifest");
        println!("cargo:rerun-if-changed=windows-app.manifest");
        // Forward slashes avoid backslash-escape issues in cargo link-arg plumbing.
        let manifest_arg = manifest.to_string_lossy().replace('\\', "/");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest_arg}");
    }

    tauri_build::build()
}
