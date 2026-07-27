fn main() {
    // Unit-test harnesses on Windows do not inherit Tauri's app manifest.
    // Without Common Controls v6, comctl32 lacks TaskDialogIndirect and the
    // test harness fails at process start with STATUS_ENTRYPOINT_NOT_FOUND.
    //
    // Only enable when CI/local sets LAZY_BLACKTEA_TEST_MANIFEST=1 for
    // `cargo test`. Unconditional injection collides with tauri-build's
    // resource MANIFEST on bin links (CVT1100 / LNK1123).
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let inject_test_manifest = std::env::var("LAZY_BLACKTEA_TEST_MANIFEST")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    println!("cargo:rerun-if-env-changed=LAZY_BLACKTEA_TEST_MANIFEST");
    if target_os == "windows" && inject_test_manifest {
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
