use crate::app::models::AppInfo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageEntry {
    pub package_name: String,
    pub apk_path: Option<String>,
    pub is_system: bool,
}

pub fn parse_pm_list_packages_output(output: &str) -> Vec<PackageEntry> {
    let mut apps = Vec::new();
    for raw in output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("package:") {
            if let Some((apk_path, pkg)) = line.rsplit_once('=') {
                let apk_path = apk_path.trim().to_string();
                let pkg = pkg.trim().to_string();
                if pkg.is_empty() {
                    continue;
                }
                apps.push(PackageEntry {
                    package_name: pkg,
                    apk_path: Some(apk_path.clone()),
                    is_system: is_system_path(&apk_path),
                });
            } else {
                apps.push(PackageEntry {
                    package_name: line.to_string(),
                    apk_path: None,
                    is_system: false,
                });
            }
            continue;
        }

        let payload = line.trim_start_matches("package:");
        if let Some((apk_path, pkg)) = payload.rsplit_once('=') {
            let apk_path = apk_path.trim().to_string();
            let pkg = pkg.trim().to_string();
            if pkg.is_empty() {
                continue;
            }
            apps.push(PackageEntry {
                package_name: pkg,
                apk_path: Some(apk_path.clone()),
                is_system: is_system_path(&apk_path),
            });
        }
    }
    apps
}

pub fn parse_dumpsys_version_name(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("versionName=") {
            return Some(value.trim_matches(['\"', '\'']).to_string());
        }
        if let Some(value) = trimmed.strip_prefix("versionName:") {
            return Some(value.trim_matches(['\"', '\'']).to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("versionName=") {
            return Some(tail.trim_matches(['\"', '\'']).to_string());
        }
    }
    None
}

pub fn parse_dumpsys_version_code(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("versionCode=") {
            return Some(value.split_whitespace().next().unwrap_or(value).to_string());
        }
        if let Some(value) = trimmed.strip_prefix("versionCode:") {
            return Some(value.split_whitespace().next().unwrap_or(value).to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("versionCode=") {
            return Some(tail.split_whitespace().next().unwrap_or(tail).to_string());
        }
    }
    None
}

pub fn parse_dumpsys_first_install_time(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("firstInstallTime=") {
            return Some(value.trim().to_string());
        }
        if let Some(value) = trimmed.strip_prefix("firstInstallTime:") {
            return Some(value.trim().to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("firstInstallTime=") {
            return Some(tail.trim().to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("firstInstallTime:") {
            return Some(tail.trim().to_string());
        }
    }
    None
}

pub fn parse_dumpsys_last_update_time(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("lastUpdateTime=") {
            return Some(value.trim().to_string());
        }
        if let Some(value) = trimmed.strip_prefix("lastUpdateTime:") {
            return Some(value.trim().to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("lastUpdateTime=") {
            return Some(tail.trim().to_string());
        }
        if let Some((_, tail)) = trimmed.split_once("lastUpdateTime:") {
            return Some(tail.trim().to_string());
        }
    }
    None
}

pub fn parse_pm_path_output(output: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for raw in output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("package:") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                paths.push(trimmed.to_string());
            }
        }
    }
    paths
}

pub fn package_entry_to_app_info(
    entry: PackageEntry,
    version_name: Option<String>,
    version_code: Option<String>,
) -> AppInfo {
    AppInfo {
        package_name: entry.package_name,
        version_name,
        version_code,
        is_system: entry.is_system,
        apk_path: entry.apk_path,
    }
}

fn is_system_path(path: &str) -> bool {
    path.starts_with("/system/")
        || path.starts_with("/product/")
        || path.starts_with("/vendor/")
        || path.starts_with("/system_ext/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pm_list_packages_output() {
        let output = "package:/data/app/com.example/base.apk=com.example\npackage:/system/app/Sys.apk=com.android.sys\n";
        let items = parse_pm_list_packages_output(output);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].package_name, "com.example");
        assert!(!items[0].is_system);
        assert!(items[1].is_system);
    }

    #[test]
    fn parses_dumpsys_version_info() {
        let output = "versionName=1.2.3\nversionCode=1000 minSdk=24\n";
        assert_eq!(parse_dumpsys_version_name(output).as_deref(), Some("1.2.3"));
        assert_eq!(parse_dumpsys_version_code(output).as_deref(), Some("1000"));
    }

    #[test]
    fn parses_dumpsys_install_times() {
        let output = "firstInstallTime=2026-01-02 03:04:05\nlastUpdateTime=2026-02-03 04:05:06\n";
        assert_eq!(
            parse_dumpsys_first_install_time(output).as_deref(),
            Some("2026-01-02 03:04:05")
        );
        assert_eq!(
            parse_dumpsys_last_update_time(output).as_deref(),
            Some("2026-02-03 04:05:06")
        );

        let output_alt =
            "something else\nfirstInstallTime: 2026-01-02 03:04:05\nlastUpdateTime: 2026-02-03 04:05:06\n";
        assert_eq!(
            parse_dumpsys_first_install_time(output_alt).as_deref(),
            Some("2026-01-02 03:04:05")
        );
        assert_eq!(
            parse_dumpsys_last_update_time(output_alt).as_deref(),
            Some("2026-02-03 04:05:06")
        );
    }

    #[test]
    fn parses_pm_path_output() {
        let output = "package:/data/app/com.example/base.apk\npackage:/data/app/com.example/split_config.en.apk\n";
        let paths = parse_pm_path_output(output);
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], "/data/app/com.example/base.apk");
        assert_eq!(paths[1], "/data/app/com.example/split_config.en.apk");

        let output_with_noise = "\ninvalid line\npackage:/a.apk\n  package:/b.apk  \n";
        let paths = parse_pm_path_output(output_with_noise);
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], "/a.apk");
        assert_eq!(paths[1], "/b.apk");
    }
}
