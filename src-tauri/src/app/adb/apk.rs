use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tempfile::TempDir;
use zip::ZipArchive;

use crate::app::adb::runner::run_command_with_timeout;
use crate::app::models::ApkInfo;

pub struct SplitApkBundle {
    pub apk_paths: Vec<String>,
    #[allow(dead_code)]
    pub temp_dir: Option<TempDir>,
}

pub fn is_split_bundle(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".apks") || lower.ends_with(".xapk")
}

pub fn supports_push_and_pm_install(extra_args: &[String]) -> bool {
    extra_args.is_empty()
}

pub fn extract_split_apks(path: &str) -> Result<SplitApkBundle, String> {
    let file = File::open(path).map_err(|err| format!("Failed to open bundle: {err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|err| format!("Invalid bundle: {err}"))?;
    let temp_dir = TempDir::new().map_err(|err| format!("Failed to create temp dir: {err}"))?;
    let mut extracted = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|err| format!("Failed to read bundle: {err}"))?;
        let name = file.name().to_string();
        if !name.to_lowercase().ends_with(".apk") {
            continue;
        }
        let file_name = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| "Invalid apk name".to_string())?;
        let target = temp_dir.path().join(file_name);
        let mut output =
            File::create(&target).map_err(|err| format!("Failed to extract apk: {err}"))?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|err| format!("Failed to read apk: {err}"))?;
        output
            .write_all(&buffer)
            .map_err(|err| format!("Failed to write apk: {err}"))?;
        extracted.push(target.to_string_lossy().to_string());
    }

    extracted.sort_by_key(|path| {
        let name = Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_lowercase();
        if name.contains("base") {
            (0, name)
        } else {
            (1, name)
        }
    });

    Ok(SplitApkBundle {
        apk_paths: extracted,
        temp_dir: Some(temp_dir),
    })
}

fn extract_quoted_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let start = line.find(key)? + key.len();
    let rest = &line[start..];
    let end = rest.find('\'')?;
    Some(&rest[..end])
}

pub fn parse_aapt_badging(output: &str, info: &mut ApkInfo) {
    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.starts_with("package:") {
            if let Some(name) = extract_quoted_value(line, "name='") {
                if !name.trim().is_empty() {
                    info.package_name = Some(name.trim().to_string());
                }
            }
            if let Some(code) = extract_quoted_value(line, "versionCode='") {
                if let Ok(parsed) = code.trim().parse::<i32>() {
                    info.version_code = Some(parsed);
                }
            }
            if let Some(version_name) = extract_quoted_value(line, "versionName='") {
                if !version_name.trim().is_empty() {
                    info.version_name = Some(version_name.trim().to_string());
                }
            }
        } else if line.starts_with("sdkVersion:") {
            if let Some(sdk) = extract_quoted_value(line, "'") {
                if let Ok(parsed) = sdk.trim().parse::<i32>() {
                    info.min_sdk_version = Some(parsed);
                }
            }
        } else if line.starts_with("targetSdkVersion:") {
            if let Some(sdk) = extract_quoted_value(line, "'") {
                if let Ok(parsed) = sdk.trim().parse::<i32>() {
                    info.target_sdk_version = Some(parsed);
                }
            }
        }
    }
}

fn version_sort_key(name: &str) -> Vec<u32> {
    name.split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok())
        .collect()
}

fn aapt_binary_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["aapt2.exe", "aapt.exe"]
    } else {
        &["aapt2", "aapt"]
    }
}

pub fn find_aapt_command() -> Option<PathBuf> {
    let candidates = aapt_binary_candidates();

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for bin in candidates {
                let candidate = dir.join(bin);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    let sdk_root = std::env::var_os("ANDROID_HOME")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("ANDROID_SDK_ROOT").filter(|v| !v.is_empty()));

    if let Some(root) = sdk_root {
        let build_tools = PathBuf::from(root).join("build-tools");
        if let Ok(entries) = fs::read_dir(&build_tools) {
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|entry| entry.ok().map(|e| e.path()))
                .filter(|path| path.is_dir())
                .collect();
            dirs.sort_by(|a, b| {
                let a_name = a.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let b_name = b.file_name().and_then(|n| n.to_str()).unwrap_or("");
                version_sort_key(b_name).cmp(&version_sort_key(a_name))
            });
            for dir in dirs {
                for bin in candidates {
                    let candidate = dir.join(bin);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

pub fn validate_apk_for_device(
    apk_info: &ApkInfo,
    device_api_level: Option<i32>,
) -> Result<(), String> {
    if !apk_info.is_valid() {
        return Err(apk_info
            .error
            .clone()
            .unwrap_or_else(|| "Invalid APK".to_string()));
    }
    if let (Some(api_level), Some(min_sdk)) = (device_api_level, apk_info.min_sdk_version) {
        if api_level > 0 && api_level < min_sdk {
            return Err(format!(
                "Device API level {api_level} is below minimum required API {min_sdk}"
            ));
        }
    }
    Ok(())
}

pub fn get_apk_info(path: &str) -> ApkInfo {
    let normalized = normalize_apk_path(path);
    let normalized_str = normalized.to_string_lossy().to_string();
    let mut info = ApkInfo {
        path: normalized_str.clone(),
        package_name: None,
        version_code: None,
        version_name: None,
        min_sdk_version: None,
        target_sdk_version: None,
        is_split_apk: false,
        split_apk_paths: Vec::new(),
        file_size_bytes: 0,
        error: None,
    };

    let path_obj = Path::new(&normalized_str);
    if !path_obj.exists() {
        info.error = Some(format!("File not found: {normalized_str}"));
        return info;
    }
    if !path_obj.is_file() {
        info.error = Some(format!("Not a file: {normalized_str}"));
        return info;
    }

    if let Ok(metadata) = fs::metadata(path_obj) {
        info.file_size_bytes = metadata.len();
    }

    if is_split_bundle(&normalized_str) {
        info.is_split_apk = true;
        match File::open(path_obj) {
            Ok(file) => match ZipArchive::new(file) {
                Ok(mut archive) => {
                    let mut apk_entries = Vec::new();
                    for idx in 0..archive.len() {
                        if let Ok(entry) = archive.by_index(idx) {
                            let name = entry.name().to_string();
                            if name.to_lowercase().ends_with(".apk") {
                                apk_entries.push(name);
                            }
                        }
                    }
                    apk_entries.sort_by_key(|name| {
                        let base = Path::new(name)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if base.contains("base") {
                            (0, base)
                        } else {
                            (1, base)
                        }
                    });
                    if apk_entries.is_empty() {
                        info.error = Some("Invalid bundle: no .apk entries found".to_string());
                        return info;
                    }
                    info.split_apk_paths = apk_entries;
                    if let Some(stem) = path_obj.file_stem().and_then(|s| s.to_str()) {
                        info.package_name = Some(stem.to_string());
                    }
                }
                Err(err) => {
                    info.error = Some(format!("Invalid bundle: {err}"));
                }
            },
            Err(err) => {
                info.error = Some(format!("Failed to open bundle: {err}"));
            }
        }
        return info;
    }

    match File::open(path_obj) {
        Ok(file) => match ZipArchive::new(file) {
            Ok(mut archive) => {
                let mut has_manifest = false;
                for idx in 0..archive.len() {
                    if let Ok(entry) = archive.by_index(idx) {
                        if entry.name() == "AndroidManifest.xml" {
                            has_manifest = true;
                            break;
                        }
                    }
                }
                if !has_manifest {
                    info.error = Some("Invalid APK: missing AndroidManifest.xml".to_string());
                    return info;
                }
            }
            Err(err) => {
                info.error = Some(format!("Invalid APK: {err}"));
                return info;
            }
        },
        Err(err) => {
            info.error = Some(format!("Failed to open APK: {err}"));
            return info;
        }
    }

    if let Some(aapt_cmd) = find_aapt_command() {
        let aapt_program = aapt_cmd.to_string_lossy().to_string();
        let args = vec![
            "dump".to_string(),
            "badging".to_string(),
            normalized_str.clone(),
        ];
        if let Ok(output) =
            run_command_with_timeout(&aapt_program, &args, Duration::from_secs(15), "apk-inspect")
        {
            if output.exit_code == Some(0) {
                parse_aapt_badging(&output.stdout, &mut info);
            }
        }
    }

    if info.package_name.is_none() {
        if let Some(name) = path_obj.file_stem().and_then(|s| s.to_str()) {
            info.package_name = Some(name.to_string());
        }
    }

    info
}

pub fn normalize_apk_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            return PathBuf::from(home).join(trimmed.trim_start_matches("~/"));
        }
    }
    PathBuf::from(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::FileOptions;

    #[test]
    fn extracts_split_apks() {
        let tmp = TempDir::new().expect("tmp");
        let bundle_path = tmp.path().join("bundle.apks");
        let file = File::create(&bundle_path).expect("bundle");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("base.apk", FileOptions::<()>::default())
            .unwrap();
        zip.write_all(b"base").unwrap();
        zip.start_file("config.apk", FileOptions::<()>::default())
            .unwrap();
        zip.write_all(b"config").unwrap();
        zip.finish().unwrap();

        let bundle = extract_split_apks(bundle_path.to_str().unwrap()).expect("extract");
        assert_eq!(bundle.apk_paths.len(), 2);
        assert!(bundle.apk_paths[0].ends_with("base.apk"));
    }

    #[test]
    fn get_apk_info_rejects_zip_without_android_manifest() {
        let tmp = TempDir::new().expect("tmp");
        let apk_path = tmp.path().join("broken.apk");
        let file = File::create(&apk_path).expect("apk");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("classes.dex", FileOptions::<()>::default())
            .unwrap();
        zip.write_all(b"dex").unwrap();
        zip.finish().unwrap();

        let info = get_apk_info(apk_path.to_str().unwrap());
        assert!(!info.is_valid());
        assert_eq!(
            info.error.as_deref(),
            Some("Invalid APK: missing AndroidManifest.xml")
        );
    }

    #[test]
    fn get_apk_info_accepts_valid_apk_and_inspects_split_bundle() {
        let tmp = TempDir::new().expect("tmp");

        let apk_path = tmp.path().join("sample-app.apk");
        let file = File::create(&apk_path).expect("apk");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("AndroidManifest.xml", FileOptions::<()>::default())
            .unwrap();
        zip.write_all(b"manifest").unwrap();
        zip.finish().unwrap();

        let info = get_apk_info(apk_path.to_str().unwrap());
        assert!(info.is_valid());
        assert!(!info.is_split_apk);
        assert!(info.file_size_bytes > 0);
        assert_eq!(info.package_name.as_deref(), Some("sample-app"));

        let bundle_path = tmp.path().join("demo.apks");
        let bfile = File::create(&bundle_path).expect("bundle");
        let mut bzip = zip::ZipWriter::new(bfile);
        bzip.start_file("splits/config.arm64.apk", FileOptions::<()>::default())
            .unwrap();
        bzip.write_all(b"arm64").unwrap();
        bzip.start_file("splits/base-master.apk", FileOptions::<()>::default())
            .unwrap();
        bzip.write_all(b"base").unwrap();
        bzip.finish().unwrap();

        let bundle_info = get_apk_info(bundle_path.to_str().unwrap());
        assert!(bundle_info.is_valid());
        assert!(bundle_info.is_split_apk);
        assert_eq!(bundle_info.split_apk_paths.len(), 2);
        assert!(bundle_info.split_apk_paths[0].contains("base-master.apk"));
    }

    #[test]
    fn parses_aapt_badging_metadata() {
        let badging = "\
package: name='com.example.demo' versionCode='42' versionName='2.3.1' compileSdkVersion='34'\n\
sdkVersion:'26'\n\
targetSdkVersion:'34'\n\
application-label:'Demo App'\n";
        let mut info = ApkInfo {
            path: "/tmp/demo.apk".to_string(),
            package_name: None,
            version_code: None,
            version_name: None,
            min_sdk_version: None,
            target_sdk_version: None,
            is_split_apk: false,
            split_apk_paths: Vec::new(),
            file_size_bytes: 1234,
            error: None,
        };
        parse_aapt_badging(badging, &mut info);
        assert_eq!(info.package_name.as_deref(), Some("com.example.demo"));
        assert_eq!(info.version_code, Some(42));
        assert_eq!(info.version_name.as_deref(), Some("2.3.1"));
        assert_eq!(info.min_sdk_version, Some(26));
        assert_eq!(info.target_sdk_version, Some(34));
    }

    #[test]
    fn validates_apk_min_sdk_against_device_api() {
        let info = ApkInfo {
            path: "/tmp/demo.apk".to_string(),
            package_name: Some("com.example.demo".to_string()),
            version_code: Some(1),
            version_name: Some("1.0".to_string()),
            min_sdk_version: Some(30),
            target_sdk_version: Some(34),
            is_split_apk: false,
            split_apk_paths: Vec::new(),
            file_size_bytes: 100,
            error: None,
        };
        assert!(validate_apk_for_device(&info, Some(30)).is_ok());
        assert!(validate_apk_for_device(&info, Some(34)).is_ok());
        assert!(validate_apk_for_device(&info, None).is_ok());
        let err = validate_apk_for_device(&info, Some(28)).expect_err("expected sdk mismatch");
        assert!(err.contains("28"));
        assert!(err.contains("30"));
    }
}
