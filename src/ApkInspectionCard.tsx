import React from "react";
import { evaluateApkCompatibility, formatApkFileSize } from "./apkInspector";
import type { ApkInfo, DeviceInfo } from "./types";

type ApkInspectionCardProps = {
  info: ApkInfo | null;
  loading: boolean;
  error: string | null;
  selectedDevices: DeviceInfo[];
  onUsePackageForLaunch?: (packageName: string) => void;
};

export const ApkInspectionCard: React.FC<ApkInspectionCardProps> = ({
  info,
  loading,
  error,
  selectedDevices,
  onUsePackageForLaunch,
}) => {
  if (!loading && !error && !info) {
    return null;
  }

  const compatibility = evaluateApkCompatibility(info, selectedDevices);
  const incompatibleDevices = compatibility.devices.filter((item) => item.compatible === false);

  return (
    <div className="output-block" style={{ marginTop: 8 }}>
      <div className="inline-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <strong>APK Pre-Check</strong>
        {loading && <span className="status-pill busy">Inspecting…</span>}
        {!loading && error && <span className="status-pill error">Invalid</span>}
        {!loading && !error && info && (
          <span className={`status-pill ${info.error ? "error" : incompatibleDevices.length > 0 ? "warn" : "ok"}`}>
            {info.error
              ? "Invalid APK"
              : incompatibleDevices.length > 0
                ? `${incompatibleDevices.length} incompatible`
                : "Valid"}
          </span>
        )}
      </div>

      {error && <p className="muted">{error}</p>}
      {!error && info?.error && <p className="muted">{info.error}</p>}

      {!error && info && !info.error && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="task-summary">
            {info.package_name && (
              <span className="badge">
                Package: <strong>{info.package_name}</strong>
              </span>
            )}
            {(info.version_name || info.version_code != null) && (
              <span className="badge">
                Version: {info.version_name ?? "—"}
                {info.version_code != null ? ` (${info.version_code})` : ""}
              </span>
            )}
            {info.min_sdk_version != null && <span className="badge">minSDK {info.min_sdk_version}</span>}
            {info.target_sdk_version != null && (
              <span className="badge">targetSDK {info.target_sdk_version}</span>
            )}
            <span className="badge">{formatApkFileSize(info.file_size_bytes)}</span>
            {info.is_split_apk && (
              <span className="badge">Split bundle ({info.split_apk_paths.length} APKs)</span>
            )}
          </div>

          {info.package_name && !info.is_split_apk && onUsePackageForLaunch && (
            <div className="inline-row">
              <button
                type="button"
                className="ghost"
                onClick={() => onUsePackageForLaunch(info.package_name!)}
              >
                Use package for Launch After Install
              </button>
            </div>
          )}

          {incompatibleDevices.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <strong style={{ color: "var(--warn, #e5a93c)" }}>
                SDK Compatibility Warning ({incompatibleDevices.length} device
                {incompatibleDevices.length > 1 ? "s" : ""})
              </strong>
              {incompatibleDevices.map((item) => (
                <div key={item.serial} className="muted">
                  • {item.label}: {item.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
