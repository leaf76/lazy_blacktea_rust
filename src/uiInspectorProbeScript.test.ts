/// <reference types="node" />

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repoRoot, "scripts", "ui_inspector_probe.sh");

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-inspector-probe-test-"));
  tempDirs.push(dir);
  return dir;
};

const createFakeAdb = (dir: string, options: { failDownloadDump?: boolean; noDevices?: boolean } = {}) => {
  const remoteRoot = join(dir, "remote");
  mkdirSync(remoteRoot, { recursive: true });
  const adbPath = join(dir, "fake-adb.sh");
  const devicesOutput = options.noDevices
    ? "List of devices attached\n"
    : "List of devices attached\nRFCW40P6PSB device product:test model:Galaxy device:test transport_id:1\n";
  const script = `#!/usr/bin/env bash
set -u
REMOTE_ROOT="\${FAKE_ADB_REMOTE_ROOT:?}"
mkdir -p "$REMOTE_ROOT"
if [[ "$1" == "devices" && "$2" == "-l" ]]; then
  printf '%s' '${devicesOutput.replace(/'/g, "'\\''")}'
  exit 0
fi
if [[ "$1" == "-s" ]]; then
  serial="$2"
  shift 2
fi
if [[ "$1" == "shell" && "$2" == "getprop" ]]; then
  case "$3" in
    ro.product.manufacturer) echo "samsung" ;;
    ro.product.model) echo "Galaxy Test" ;;
    ro.build.version.release) echo "14" ;;
    ro.build.version.sdk) echo "34" ;;
    *) echo "" ;;
  esac
  exit 0
fi
if [[ "$1" == "exec-out" && "$2" == "uiautomator" ]]; then
  echo '<hierarchy rotation="0"></hierarchy>'
  exit 0
fi
if [[ "$1" == "shell" && "$2" == "uiautomator" && "$3" == "dump" ]]; then
  remote="$4"
  if [[ "$remote" == "/sdcard/Download/lbt_probe.xml" && "${options.failDownloadDump ? "1" : "0"}" == "1" ]]; then
    echo "Permission denied" >&2
    exit 1
  fi
  printf '%s\\n' '<hierarchy rotation="0"></hierarchy>' > "$REMOTE_ROOT/$(basename "$remote")"
  echo "UI hierchary dumped to: $remote"
  exit 0
fi
if [[ "$1" == "shell" && "$2" == "ls" && "$3" == "-l" ]]; then
  remote="$4"
  path="$REMOTE_ROOT/$(basename "$remote")"
  if [[ -f "$path" ]]; then
    echo "-rw-r--r-- 1 shell shell 36 2026-03-17 00:00 $(basename "$remote")"
    exit 0
  fi
  echo "No such file or directory" >&2
  exit 1
fi
if [[ "$1" == "pull" ]]; then
  remote="$2"
  local_path="$3"
  path="$REMOTE_ROOT/$(basename "$remote")"
  if [[ -f "$path" ]]; then
    cp "$path" "$local_path"
    echo "1 file pulled"
    exit 0
  fi
  echo "No such file or directory" >&2
  exit 1
fi
if [[ "$1" == "shell" && "$2" == "rm" && "$3" == "-f" ]]; then
  remote="$4"
  rm -f "$REMOTE_ROOT/$(basename "$remote")"
  exit 0
fi
echo "Unsupported invocation: $*" >&2
exit 1
`;
  writeFileSync(adbPath, script);
  const chmod = spawnSync("chmod", ["+x", adbPath], { encoding: "utf8" });
  if (chmod.status !== 0) {
    throw new Error(`chmod failed: ${chmod.stderr}`);
  }
  return { adbPath, remoteRoot };
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const baseEnv = (remoteRoot: string) => ({
  ...process.env,
  ANDROID_SERIAL: "",
  FAKE_ADB_REMOTE_ROOT: remoteRoot,
});

// Bash probe scripts are not runnable on native Windows CI without WSL/Git Bash wiring.
describe.skipIf(process.platform === "win32")("ui_inspector_probe.sh", () => {
  it("collects command artifacts and creates a zip bundle", () => {
    const dir = makeTempDir();
    const outputDir = join(dir, "probe-output");
    const { adbPath, remoteRoot } = createFakeAdb(dir);

    const result = spawnSync(scriptPath, ["--adb", adbPath, "--out", outputDir], {
      encoding: "utf8",
      env: baseEnv(remoteRoot),
    });

    expect(result.status).toBe(0);
    expect(statSync(join(outputDir, "commands", "adb_devices_l.stdout")).isFile()).toBe(true);
    expect(readFileSync(join(outputDir, "commands", "exec_out_uiautomator_dump.exitcode"), "utf8").trim()).toBe("0");
    expect(statSync(join(outputDir, "artifacts", "download_lbt_probe.xml")).isFile()).toBe(true);

    const zipLine = result.stdout
      .split("\n")
      .find((line: string) => line.startsWith("zip_path="));
    expect(zipLine).toBeTruthy();
    const zipPath = zipLine!.slice("zip_path=".length);
    expect(statSync(zipPath).isFile()).toBe(true);
  });

  it("falls back to /data/local/tmp when /sdcard/Download dump fails", () => {
    const dir = makeTempDir();
    const outputDir = join(dir, "probe-output");
    const { adbPath, remoteRoot } = createFakeAdb(dir, { failDownloadDump: true });

    const result = spawnSync(scriptPath, ["--adb", adbPath, "--out", outputDir], {
      encoding: "utf8",
      env: baseEnv(remoteRoot),
    });

    expect(result.status).toBe(0);
    expect(statSync(join(outputDir, "artifacts", "tmp_lbt_probe.xml")).isFile()).toBe(true);
    expect(readFileSync(join(outputDir, "commands", "tmp_pull.exitcode"), "utf8").trim()).toBe("0");
  });

  it("fails clearly when no device is connected", () => {
    const dir = makeTempDir();
    const outputDir = join(dir, "probe-output");
    const { adbPath, remoteRoot } = createFakeAdb(dir, { noDevices: true });

    const result = spawnSync(scriptPath, ["--adb", adbPath, "--out", outputDir], {
      encoding: "utf8",
      env: baseEnv(remoteRoot),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No connected Android devices found");
  });
});
