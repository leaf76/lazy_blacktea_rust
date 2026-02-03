use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tempfile::TempDir;
use zip::ZipArchive;

use crate::app::models::{ApkInfo};

pub struct SplitApkBundle {
    pub apk_paths: Vec<String>,
    #[allow(dead_code)]
    pub temp_dir: Option<TempDir>,
}

pub fn is_split_bundle(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".apks") || lower.ends_with(".xapk")
}

pub fn extract_split_apks(path: &str) -> Result<SplitApkBundle, String> {
    let file = File::open(path).map_err(|err| format!("Failed to open bundle: {err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|err| format!("Invalid bundle: {err}"))?;
    let temp_dir = TempDir::new().map_err(|err| format!("Failed to create temp dir: {err}"))?;
    let mut extracted = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|err| format!("Failed to read bundle: {err}"))?;
        let name = file.name().to_string();
        if !name.to_lowercase().ends_with(".apk") {
            continue;
        }
        let file_name = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| "Invalid apk name".to_string())?;
        let target = temp_dir.path().join(file_name);
        let mut output = File::create(&target)
            .map_err(|err| format!("Failed to extract apk: {err}"))?;
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

pub fn get_apk_info(path: &str) -> ApkInfo {
    let mut info = ApkInfo {
        path: path.to_string(),
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

    let path_obj = Path::new(path);
    if !path_obj.is_file() {
        info.error = Some(format!("File not found: {path}"));
        return info;
    }

    if let Ok(metadata) = fs::metadata(path_obj) {
        info.file_size_bytes = metadata.len();
    }

    if let Some(name) = path_obj.file_stem().and_then(|s| s.to_str()) {
        info.package_name = Some(name.to_string());
    }

    match File::open(path_obj) {
        Ok(file) => {
            if let Err(err) = ZipArchive::new(file) {
                info.error = Some(format!("Invalid APK: {err}"));
            }
        }
        Err(err) => {
            info.error = Some(format!("Failed to open APK: {err}"));
        }
    }

    info
}

pub fn normalize_apk_path(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(path.trim_start_matches("~/"));
        }
    }
    PathBuf::from(path)
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
        zip.start_file("base.apk", FileOptions::<()>::default()).unwrap();
        zip.write_all(b"base").unwrap();
        zip.start_file("config.apk", FileOptions::<()>::default()).unwrap();
        zip.write_all(b"config").unwrap();
        zip.finish().unwrap();

        let bundle = extract_split_apks(bundle_path.to_str().unwrap()).expect("extract");
        assert_eq!(bundle.apk_paths.len(), 2);
        assert!(bundle.apk_paths[0].ends_with("base.apk"));
    }
}
