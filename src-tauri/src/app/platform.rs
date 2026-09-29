//! Platform-specific initialization and workarounds.

/// Computes the environment variable overrides required on Linux to prevent
/// WebKitGTK graphics crashes and GIO module symbol mismatches.
pub fn compute_linux_workaround_env(
    has_webkit_disable_dmabuf: bool,
    is_appimage: bool,
    is_conda: bool,
    has_gio_module_dir: bool,
) -> Vec<(&'static str, &'static str)> {
    let mut vars = Vec::new();
    if !has_webkit_disable_dmabuf {
        vars.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    if (is_appimage || is_conda) && !has_gio_module_dir {
        vars.push(("GIO_MODULE_DIR", ""));
    }
    vars
}

/// Applies platform-specific environment variables before Tauri or WebView initializes.
/// On Linux, this prevents WebKitGTK DMA-BUF renderer crashes (EGL_BAD_PARAMETER)
/// and isolates incompatible host GIO/GVFS modules in AppImage/Conda environments.
pub fn init_platform_environment() {
    #[cfg(target_os = "linux")]
    {
        let overrides = compute_linux_workaround_env(
            std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
            std::env::var_os("APPIMAGE").is_some(),
            std::env::var_os("CONDA_PREFIX").is_some(),
            std::env::var_os("GIO_MODULE_DIR").is_some(),
        );

        for (key, val) in overrides {
            std::env::set_var(key, val);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_linux_workaround_env_default() {
        let vars = compute_linux_workaround_env(false, false, false, false);
        assert_eq!(vars, vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
    }

    #[test]
    fn test_compute_linux_workaround_env_already_set() {
        let vars = compute_linux_workaround_env(true, false, false, false);
        assert!(vars.is_empty());
    }

    #[test]
    fn test_compute_linux_workaround_env_appimage() {
        let vars = compute_linux_workaround_env(false, true, false, false);
        assert_eq!(
            vars,
            vec![
                ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
                ("GIO_MODULE_DIR", "")
            ]
        );
    }

    #[test]
    fn test_compute_linux_workaround_env_conda() {
        let vars = compute_linux_workaround_env(false, false, true, false);
        assert_eq!(
            vars,
            vec![
                ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
                ("GIO_MODULE_DIR", "")
            ]
        );
    }

    #[test]
    fn test_compute_linux_workaround_env_gio_already_set() {
        let vars = compute_linux_workaround_env(false, true, true, true);
        assert_eq!(vars, vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
    }
}
