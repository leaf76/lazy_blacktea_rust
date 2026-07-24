import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS,
  buildDeviceInfoCopyItems,
  buildDeviceItemInfoFields,
  buildIosToolGuidanceRows,
  applyGroupAssignment,
  applyDeviceDetailPatch,
  buildDeviceQuickMenuActions,
  buildDeviceGroupOptions,
  buildDeviceGroupSelectionSummary,
  buildTopbarOverview,
  computeContextMenuLayout,
  computeContextMenuPosition,
  computeContextSubmenuLayout,
  expandDeviceGroups,
  filterDevicesBySearch,
  flattenDeviceGroups,
  formatDeviceApiLabel,
  formatDevicePlatformLabel,
  formatPrimaryDeviceLabel,
  formatDeviceInfoMarkdown,
  getDevicePlatform,
  getIosConfigurationProfileEligibleSerials,
  getIosCrashReportEligibleSerials,
  hasDeviceCapability,
  mergeDeviceDetails,
  normalizeDeviceItemInfoFieldIds,
  reduceSelectionToOne,
  resolveDeviceQuickMenuSelection,
  resolveHostOs,
  resolvePrimarySerial,
  resolveSelectedSerials,
  setPrimarySelection,
  shouldCloseContextMenuOnScroll,
  splitDeviceSerialsByPlatform,
  shouldEnableConnectivityForSelection,
  selectSerialsForGroup,
  withDeviceGroups,
} from "./deviceUtils";
import type { AppConfig, DeviceInfo } from "./types";

describe("deviceUtils", () => {
  it("merges detailed device info and drops missing devices", () => {
    const current: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: false },
      },
      {
        summary: { serial: "bravo", state: "offline" },
        detail: null,
      },
    ];

    const detailed: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device", model: "Pixel" },
        detail: { serial: "alpha", wifi_is_on: true, bt_is_on: false },
      },
      {
        summary: { serial: "charlie", state: "device" },
        detail: { serial: "charlie", wifi_is_on: true },
      },
    ];

    const merged = mergeDeviceDetails(current, detailed);

    expect(merged).toHaveLength(2);
    expect(merged[0].summary.serial).toBe("alpha");
    expect(merged[0].detail?.wifi_is_on).toBe(true);
    expect(merged[1].summary.serial).toBe("charlie");
  });

  it("preserves existing detail when incoming detail is missing", () => {
    const current: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: true },
      },
    ];

    const incoming: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: null,
      },
    ];

    const merged = mergeDeviceDetails(current, incoming, { preserveMissingDetail: true });

    expect(merged[0].detail?.wifi_is_on).toBe(true);
  });

  it("preserves missing iOS devices when merging Android tracking snapshots", () => {
    const current: DeviceInfo[] = [
      {
        summary: { platform: "android", serial: "emulator-5554", state: "device" },
        detail: { serial: "emulator-5554", android_version: "14" },
        capabilities: { logs: true, shell: true },
      },
      {
        summary: { platform: "ios", serial: "ios-udid", state: "device", model: "iPhone15,2" },
        detail: { serial: "ios-udid", os_version: "17.4", trust_status: "trusted" },
        capabilities: { logs: true, crash_reports: true, shell: false },
      },
    ];

    const incoming: DeviceInfo[] = [
      {
        summary: { platform: "android", serial: "emulator-5554", state: "device" },
        detail: null,
        capabilities: { logs: true, shell: true },
      },
    ];

    const merged = mergeDeviceDetails(current, incoming, {
      preserveMissingDetail: true,
      preserveMissingPlatforms: ["ios"],
    });

    expect(merged.map((device) => device.summary.serial)).toEqual(["emulator-5554", "ios-udid"]);
    expect(merged[0].detail?.android_version).toBe("14");
    expect(merged[0].capabilities?.shell).toBe(true);
    expect(merged[1].summary.platform).toBe("ios");
    expect(merged[1].capabilities?.crash_reports).toBe(true);
  });

  it("applies detail patches only to targeted devices", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: false, bt_is_on: false },
      },
      {
        summary: { serial: "bravo", state: "device" },
        detail: null,
      },
    ];

    const updated = applyDeviceDetailPatch(devices, ["bravo"], { wifi_is_on: true });

    expect(updated[0].detail?.wifi_is_on).toBe(false);
    expect(updated[1].detail?.wifi_is_on).toBe(true);
    expect(updated[1].detail?.serial).toBe("bravo");
  });

  it("resolves selection to preferred device when previous selection is invalid", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "offline" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
    ];

    const resolved = resolveSelectedSerials(["missing"], devices);

    expect(resolved).toEqual(["bravo"]);
  });

  it("resolves primary serial from the first selected device", () => {
    expect(resolvePrimarySerial([])).toBeNull();
    expect(resolvePrimarySerial(["alpha"])).toBe("alpha");
    expect(resolvePrimarySerial(["alpha", "bravo"])).toBe("alpha");
  });

  it("formats primary device label with model and serial", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel 8" },
      detail: { serial: "alpha", model: "Pixel 8 Pro" },
    };
    expect(formatPrimaryDeviceLabel("alpha", device)).toBe("Pixel 8 Pro (alpha)");
    expect(formatPrimaryDeviceLabel("alpha", null)).toBe("alpha");
    expect(formatPrimaryDeviceLabel(null, null)).toBe("Unknown device");
  });

  it("formats device info as a markdown list", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel" },
      detail: {
        serial: "alpha",
        name: "panther",
        brand: "google",
        serial_number: "ABC123",
        android_version: "15",
        api_level: "35",
        processor: "Tensor",
        resolution: "1080x2400",
        storage_total_bytes: 137_438_953_472,
        memory_total_bytes: 8 * 1024 * 1024 * 1024,
        wifi_is_on: true,
        bt_is_on: false,
        gms_version: "24.02",
        build_fingerprint: "fingerprint",
      },
    };

    const markdown = formatDeviceInfoMarkdown(device);

    expect(markdown).toContain("- **Serial:** alpha");
    expect(markdown).toContain("- **Name:** panther");
    expect(markdown).toContain("- **Brand:** google");
    expect(markdown).toContain("- **Serial Number:** ABC123");
    expect(markdown).toContain("- **Processor:** Tensor");
    expect(markdown).toContain("- **Resolution:** 1080x2400");
    expect(markdown).toContain("- **Storage:** 128 GB");
    expect(markdown).toContain("- **Memory:** 8.00 GB");
    expect(markdown).toContain("- **WiFi:** On");
    expect(markdown).toContain("- **Bluetooth:** Off");
  });

  it("builds device info copy items for full summary and individual fields", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel" },
      detail: {
        serial: "alpha",
        name: "panther",
        brand: "google",
        serial_number: "ABC123",
        android_version: "15",
        api_level: "35",
        processor: "Tensor",
        resolution: "1080x2400",
        storage_total_bytes: 137_438_953_472,
        memory_total_bytes: 8 * 1024 * 1024 * 1024,
        wifi_is_on: true,
        bt_is_on: false,
        gms_version: "24.02",
        build_fingerprint: "fingerprint",
      },
    };

    const items = buildDeviceInfoCopyItems(device);

    expect(items[0]).toEqual({
      id: "all",
      label: "All Device Info",
      value: formatDeviceInfoMarkdown(device),
    });
    expect(items).toContainEqual({ id: "serial", label: "Serial", value: "alpha" });
    expect(items).toContainEqual({ id: "model", label: "Model", value: "Pixel" });
    expect(items).toContainEqual({ id: "storage", label: "Storage", value: "128 GB" });
    expect(items).toContainEqual({ id: "memory", label: "Memory", value: "8.00 GB" });
    expect(items).toContainEqual({ id: "wifi", label: "WiFi", value: "On" });
    expect(items).toContainEqual({ id: "bluetooth", label: "Bluetooth", value: "Off" });
  });

  it("normalizes device item info field ids for stored preferences", () => {
    expect(DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS).toEqual(["platform", "api", "gms", "battery", "wifi", "bluetooth"]);
    expect(normalizeDeviceItemInfoFieldIds(["wifi", "api", "wifi", "missing"])).toEqual(["wifi", "api"]);
    expect(normalizeDeviceItemInfoFieldIds(["missing"])).toEqual(DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS);
    expect(normalizeDeviceItemInfoFieldIds("wifi")).toEqual(DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS);
  });

  it("builds customizable device item info fields in the requested order", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel" },
      detail: {
        serial: "alpha",
        brand: "google",
        android_version: "15",
        api_level: "35",
        battery_level: 88,
        wifi_is_on: true,
        bt_is_on: false,
        storage_total_bytes: 137_438_953_472,
        memory_total_bytes: 8 * 1024 * 1024 * 1024,
      },
    };

    expect(buildDeviceItemInfoFields(device, ["storage", "wifi", "battery", "api"])).toEqual([
      { id: "storage", label: "Storage", value: "128 GB" },
      { id: "wifi", label: "WiFi", value: "On" },
      { id: "battery", label: "Battery", value: "88%" },
      { id: "api", label: "API", value: "API 35" },
    ]);
  });

  it("reduces selection to one device while keeping the primary when possible", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "offline" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
    ];

    expect(reduceSelectionToOne([], devices)).toEqual(["bravo"]);
    expect(reduceSelectionToOne(["alpha", "bravo"], devices)).toEqual(["alpha"]);
    expect(reduceSelectionToOne(["missing"], devices)).toEqual(["bravo"]);
    expect(reduceSelectionToOne(["missing"], [])).toEqual([]);
  });

  it("filters devices by search text (serial or model)", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha-1", state: "device", model: "Pixel" },
        detail: { serial: "alpha-1", model: "Pixel 8" },
      },
      {
        summary: { serial: "bravo-2", state: "device", model: "Nexus" },
        detail: null,
      },
    ];

    expect(filterDevicesBySearch(devices, "")).toHaveLength(2);
    expect(filterDevicesBySearch(devices, "ALPHA")).toEqual([devices[0]]);
    expect(filterDevicesBySearch(devices, "pixel")).toEqual([devices[0]]);
    expect(filterDevicesBySearch(devices, "  nexus  ")).toEqual([devices[1]]);
  });

  it("formats iOS device platform fields and capabilities", () => {
    const device: DeviceInfo = {
      summary: {
        platform: "ios",
        serial: "00008030-001C195E0E82802E",
        state: "device",
        model: "iPhone15,2",
      },
      detail: {
        serial: "00008030-001C195E0E82802E",
        device_name: "Lab iPhone",
        os_version: "17.4",
        product_type: "iPhone15,2",
        trust_status: "trusted",
      },
      capabilities: {
        logs: true,
        crash_reports: true,
        shell: false,
        install_app: false,
      },
    };

    expect(getDevicePlatform(device)).toBe("ios");
    expect(formatPrimaryDeviceLabel(device.summary.serial, device)).toBe(
      "Lab iPhone (00008030-001C195E0E82802E)",
    );
    expect(formatDevicePlatformLabel(device)).toBe("iOS 17.4");
    expect(formatDeviceApiLabel(device)).toBe("iPhone15,2");
    expect(hasDeviceCapability(device, "logs")).toBe(true);
    expect(hasDeviceCapability(device, "shell")).toBe(false);
    expect(filterDevicesBySearch([device], "iphone")).toEqual([device]);
    expect(formatDeviceInfoMarkdown(device)).toContain("**Platform:** iOS");
    expect(buildDeviceInfoCopyItems(device).map((item) => item.id)).toContain("trust");
  });

  it("builds Linux iOS tool guidance without treating devicectl as required", () => {
    expect(resolveHostOs("Linux x86_64", "Mozilla/5.0")).toBe("linux");

    const rows = buildIosToolGuidanceRows(
      {
        devicectl: {
          available: false,
          command_path: "xcrun devicectl",
          version_output: "",
          error: "devicectl was not found by xcrun",
        },
        idevice_id: {
          available: true,
          command_path: "idevice_id",
          version_output: "idevice_id 1.4.0",
        },
        ideviceinfo: {
          available: false,
          command_path: "ideviceinfo",
          version_output: "",
          error: "command not found",
        },
        idevicesyslog: {
          available: false,
          command_path: "idevicesyslog",
          version_output: "",
          error: "command not found",
        },
        idevicecrashreport: {
          available: false,
          command_path: "idevicecrashreport",
          version_output: "",
          error: "command not found",
        },
        idevicescreenshot: {
          available: false,
          command_path: "idevicescreenshot",
          version_output: "",
          error: "command not found",
        },
        cfgutil: {
          available: false,
          command_path: "cfgutil",
          version_output: "",
          error: "command not found",
        },
        usbmuxd: {
          available: true,
          command_path: "/var/run/usbmuxd",
          version_output: "socket present",
        },
      },
      "linux",
    );

    expect(rows.find((row) => row.id === "devicectl")?.status).toBe("not_required");
    expect(rows.find((row) => row.id === "cfgutil")?.status).toBe("not_required");
    expect(rows.find((row) => row.id === "devicectl")?.detail).toContain("macOS-only");
    expect(rows.find((row) => row.id === "usbmuxd")?.role).toBe("required");
    expect(rows.find((row) => row.id === "usbmuxd")?.status).toBe("available");
    expect(rows.find((row) => row.id === "idevice_id")?.status).toBe("available");
    expect(rows.find((row) => row.id === "ideviceinfo")?.status).toBe("missing");
    expect(rows.find((row) => row.id === "idevicescreenshot")?.status).toBe("missing");
  });

  it("selects only online iOS devices with crash report capability for export", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { platform: "ios", serial: "ios-ready", state: "device" },
        detail: null,
        capabilities: { crash_reports: true },
      },
      {
        summary: { platform: "ios", serial: "ios-no-crash-tool", state: "device" },
        detail: null,
        capabilities: { crash_reports: false },
      },
      {
        summary: { platform: "ios", serial: "ios-offline", state: "offline" },
        detail: null,
        capabilities: { crash_reports: true },
      },
      {
        summary: { platform: "android", serial: "android-ready", state: "device" },
        detail: null,
        capabilities: { crash_reports: true },
      },
    ];

    expect(getIosCrashReportEligibleSerials(devices)).toEqual(["ios-ready"]);
  });

  it("selects only online iOS devices with configuration profile capability", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { platform: "ios", serial: "ios-ready", state: "device" },
        detail: null,
        capabilities: { configuration_profiles: true },
      },
      {
        summary: { platform: "ios", serial: "ios-no-cfgutil", state: "device" },
        detail: null,
        capabilities: { configuration_profiles: false },
      },
      {
        summary: { platform: "ios", serial: "ios-offline", state: "offline" },
        detail: null,
        capabilities: { configuration_profiles: true },
      },
      {
        summary: { platform: "android", serial: "android-ready", state: "device" },
        detail: null,
        capabilities: { configuration_profiles: true },
      },
    ];

    expect(getIosConfigurationProfileEligibleSerials(devices)).toEqual(["ios-ready"]);
  });

  it("splits monitoring serials by platform and treats unknown serials as Android", () => {
    const devices: DeviceInfo[] = [
      { summary: { platform: "android", serial: "android-1", state: "device" }, detail: null },
      { summary: { platform: "ios", serial: "ios-1", state: "device" }, detail: null },
    ];

    expect(splitDeviceSerialsByPlatform(devices, ["ios-1", "android-1", "missing"])).toEqual({
      android: ["android-1", "missing"],
      ios: ["ios-1"],
    });
  });

  it("selects serials by group, keeping device order and supporting all-devices preset", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
      { summary: { serial: "charlie", state: "device" }, detail: null },
    ];
    const groupMap: Record<string, string> = {
      alpha: "Test",
      bravo: "Prod",
    };

    expect(selectSerialsForGroup(devices, groupMap, "Test")).toEqual(["alpha"]);
    expect(selectSerialsForGroup(devices, groupMap, "__all_devices__")).toEqual(["alpha", "bravo", "charlie"]);
    expect(selectSerialsForGroup(devices, groupMap, "Missing")).toEqual([]);
  });

  it("applies group assignments without mutating other devices", () => {
    const current = {
      alpha: "Team A",
      bravo: "Team B",
      charlie: "Team A",
    };

    expect(applyGroupAssignment(current, ["bravo", "delta"], "Team C")).toEqual({
      alpha: "Team A",
      bravo: "Team C",
      charlie: "Team A",
      delta: "Team C",
    });
    expect(current).toEqual({
      alpha: "Team A",
      bravo: "Team B",
      charlie: "Team A",
    });
  });

  it("clears group assignments for the selected serials only", () => {
    expect(
      applyGroupAssignment(
        {
          alpha: "Team A",
          bravo: "Team B",
          charlie: "Team A",
        },
        ["alpha", "charlie"],
        "",
      ),
    ).toEqual({
      bravo: "Team B",
    });
  });

  it("round-trips grouped config values through flatten and expand helpers", () => {
    const grouped = {
      "Team A": ["alpha", "charlie"],
      "Team B": ["bravo"],
    };

    expect(flattenDeviceGroups(grouped)).toEqual({
      alpha: "Team A",
      charlie: "Team A",
      bravo: "Team B",
    });
    expect(expandDeviceGroups(flattenDeviceGroups(grouped))).toEqual(grouped);
  });

  it("injects the latest device groups into config before saving", () => {
    const config = {
      version: "0.0.72",
      device_groups: {
        Old: ["alpha"],
      },
    } as unknown as AppConfig;

    expect(
      withDeviceGroups(config, {
        alpha: "QA",
        bravo: "Lab",
      }),
    ).toEqual({
      version: "0.0.72",
      device_groups: {
        QA: ["alpha"],
        Lab: ["bravo"],
      },
    });
  });

  it("builds sorted group options with active filter metadata", () => {
    expect(
      buildDeviceGroupOptions(
        {
          alpha: "Beta",
          bravo: "Alpha",
          charlie: "Beta",
        },
        "Beta",
      ),
    ).toEqual([
      { name: "Alpha", count: 1, isActiveFilter: false },
      { name: "Beta", count: 2, isActiveFilter: true },
    ]);
  });

  it("summarizes selection with no selected devices", () => {
    expect(buildDeviceGroupSelectionSummary([], { alpha: "Lab" })).toEqual({
      kind: "none",
      groupState: "ungrouped",
      groupName: null,
      selectedCount: 0,
      assignedCount: 0,
      canClear: false,
    });
  });

  it("summarizes a single selected device with a group", () => {
    expect(
      buildDeviceGroupSelectionSummary(["alpha"], {
        alpha: "Lab",
      }),
    ).toEqual({
      kind: "single",
      groupState: "single_group",
      groupName: "Lab",
      selectedCount: 1,
      assignedCount: 1,
      canClear: true,
    });
  });

  it("summarizes multi-selection when all devices are ungrouped", () => {
    expect(
      buildDeviceGroupSelectionSummary(["alpha", "bravo"], {
        charlie: "Lab",
      }),
    ).toEqual({
      kind: "multi",
      groupState: "ungrouped",
      groupName: null,
      selectedCount: 2,
      assignedCount: 0,
      canClear: false,
    });
  });

  it("summarizes multi-selection when all devices share one group", () => {
    expect(
      buildDeviceGroupSelectionSummary(["alpha", "bravo"], {
        alpha: "Lab",
        bravo: "Lab",
      }),
    ).toEqual({
      kind: "multi",
      groupState: "single_group",
      groupName: "Lab",
      selectedCount: 2,
      assignedCount: 2,
      canClear: true,
    });
  });

  it("summarizes multi-selection with mixed groups and ungrouped devices", () => {
    expect(
      buildDeviceGroupSelectionSummary(["alpha", "bravo", "charlie"], {
        alpha: "Lab",
        bravo: "QA",
      }),
    ).toEqual({
      kind: "multi",
      groupState: "mixed",
      groupName: null,
      selectedCount: 3,
      assignedCount: 2,
      canClear: true,
    });
  });

  it("reorders selection when setting primary while preserving remaining order", () => {
    expect(setPrimarySelection(["alpha", "bravo", "charlie"], "bravo")).toEqual([
      "bravo",
      "alpha",
      "charlie",
    ]);
  });

  it("keeps selection unchanged when target is already primary", () => {
    const selection = ["alpha", "bravo", "charlie"];
    expect(setPrimarySelection(selection, "alpha")).toEqual(selection);
  });

  it("inserts target as primary when target is not in selection", () => {
    expect(setPrimarySelection(["alpha", "bravo"], "charlie")).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("uses force-enable strategy for connectivity quick actions", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: true, bt_is_on: true },
      },
      {
        summary: { serial: "bravo", state: "device" },
        detail: { serial: "bravo", wifi_is_on: false, bt_is_on: true },
      },
      {
        summary: { serial: "charlie", state: "offline" },
        detail: null,
      },
    ];

    expect(shouldEnableConnectivityForSelection(devices, ["alpha"], "wifi_is_on")).toBe(false);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "bravo"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "charlie"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["charlie"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, [], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["missing"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "bravo"], "bt_is_on")).toBe(false);
  });

  it("builds task quick-menu actions with output option only when output path is present", () => {
    expect(
      buildDeviceQuickMenuActions({
        source: "task",
        scopeKind: "single",
        outputPath: "/tmp/report.zip",
        actions: [],
      }),
    ).toEqual([
      {
        id: "selection",
        title: "Selection",
        actions: [
          {
            id: "set_primary",
            label: "Set Primary",
            section: "selection",
            scope: "single",
          },
          {
            id: "copy_device_info",
            label: "Copy Device Info",
            section: "selection",
            scope: "single",
          },
          {
            id: "open_output",
            label: "Open Output",
            section: "selection",
            scope: "single",
          },
        ],
      },
    ]);
    expect(
      buildDeviceQuickMenuActions({
        source: "task",
        scopeKind: "single",
        outputPath: "   ",
        actions: [],
      }),
    ).toEqual([
      {
        id: "selection",
        title: "Selection",
        actions: [
          {
            id: "set_primary",
            label: "Set Primary",
            section: "selection",
            scope: "single",
          },
          {
            id: "copy_device_info",
            label: "Copy Device Info",
            section: "selection",
            scope: "single",
          },
        ],
      },
    ]);
  });

  it("builds grouped quick-menu actions and disables single-device actions in multi scope", () => {
    expect(
      buildDeviceQuickMenuActions({
        source: "device_manager",
        scopeKind: "multi",
        actions: [
          {
            id: "screenshot",
            label: "Screenshot",
            section: "capture",
            scope: "both",
          },
          {
            id: "set_primary",
            label: "Set Primary",
            section: "selection",
            scope: "single",
          },
          {
            id: "copy_device_info",
            label: "Copy Device Info",
            section: "selection",
            scope: "single",
            hideWhenOutOfScope: true,
          },
          {
            id: "reboot",
            label: "Reboot…",
            section: "control",
            scope: "both",
            tone: "danger",
          },
        ],
      }),
    ).toEqual([
      {
        id: "selection",
        title: "Selection",
        actions: [
          {
            id: "set_primary",
            label: "Set Primary",
            section: "selection",
            scope: "single",
            disabled: true,
          },
        ],
      },
      {
        id: "capture",
        title: "Capture",
        actions: [
          {
            id: "screenshot",
            label: "Screenshot",
            section: "capture",
            scope: "both",
          },
        ],
      },
      {
        id: "control",
        title: "Control",
        actions: [
          {
            id: "reboot",
            label: "Reboot…",
            section: "control",
            scope: "both",
            tone: "danger",
          },
        ],
      },
    ]);
  });

  it("resolves row context selection to the current multi-selection when clicking a selected row", () => {
    expect(
      resolveDeviceQuickMenuSelection({
        source: "device_manager",
        clickedSerial: "bravo",
        selectedSerials: ["alpha", "bravo", "charlie"],
      }),
    ).toEqual({
      scopeKind: "multi",
      selectedSerials: ["alpha", "bravo", "charlie"],
      primarySerial: "alpha",
    });
  });

  it("resolves row context selection to the clicked device when clicking an unselected row", () => {
    expect(
      resolveDeviceQuickMenuSelection({
        source: "device_manager",
        clickedSerial: "delta",
        selectedSerials: ["alpha", "bravo", "charlie"],
      }),
    ).toEqual({
      scopeKind: "single",
      selectedSerials: ["delta"],
      primarySerial: "delta",
    });
  });

  it("always resolves task quick-menu selection to a single clicked device", () => {
    expect(
      resolveDeviceQuickMenuSelection({
        source: "task",
        clickedSerial: "bravo",
        selectedSerials: ["alpha", "bravo", "charlie"],
      }),
    ).toEqual({
      scopeKind: "single",
      selectedSerials: ["bravo"],
      primarySerial: "bravo",
    });
  });

  it("builds topbar overview for empty selection", () => {
    const overview = buildTopbarOverview([], [], null);
    expect(overview).toEqual({
      selectedCount: 0,
      onlineSelectedCount: 0,
      primaryLabel: "None",
      primaryTone: "warn",
    });
  });

  it("builds topbar overview with selected devices and offline members", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device", model: "Pixel 9" },
        detail: { serial: "alpha", model: "Pixel 9 Pro" },
      },
      {
        summary: { serial: "bravo", state: "offline", model: "Galaxy" },
        detail: { serial: "bravo", model: "Galaxy S24" },
      },
      {
        summary: { serial: "charlie", state: "device", model: "Nexus" },
        detail: null,
      },
    ];

    const overview = buildTopbarOverview(devices, ["alpha", "bravo", "charlie"], "alpha");

    expect(overview).toEqual({
      selectedCount: 3,
      onlineSelectedCount: 2,
      primaryLabel: "Pixel 9 Pro",
      primaryTone: "ok",
    });
  });

  it("falls back to summary model and serial when primary detail model is unavailable", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device", model: "Pixel 8" },
        detail: { serial: "alpha" },
      },
      {
        summary: { serial: "bravo", state: "offline" },
        detail: null,
      },
    ];

    expect(buildTopbarOverview(devices, ["alpha"], "alpha")).toEqual({
      selectedCount: 1,
      onlineSelectedCount: 1,
      primaryLabel: "Pixel 8",
      primaryTone: "ok",
    });

    expect(buildTopbarOverview([{ summary: { serial: "solo", state: "offline" }, detail: null }], ["solo"], "solo")).toEqual({
      selectedCount: 1,
      onlineSelectedCount: 0,
      primaryLabel: "solo",
      primaryTone: "warn",
    });
  });

  it("handles missing primary device gracefully", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device", model: "Pixel 7" },
        detail: { serial: "alpha", model: "Pixel 7" },
      },
    ];

    const overview = buildTopbarOverview(devices, ["alpha"], "missing");
    expect(overview).toEqual({
      selectedCount: 1,
      onlineSelectedCount: 1,
      primaryLabel: "None",
      primaryTone: "warn",
    });
  });

  it("computes context-menu position without overflow in normal viewport area", () => {
    const pos = computeContextMenuPosition({
      anchorX: 300,
      anchorY: 200,
      menuWidth: 180,
      menuHeight: 120,
      viewportWidth: 1280,
      viewportHeight: 720,
      margin: 10,
    });
    expect(pos).toEqual({ left: 300, top: 200 });
  });

  it("treats pointer anchors as viewport coordinates for fixed menus", () => {
    const containerOffset = { left: 180, top: 96 };
    const layout = computeContextMenuLayout({
      anchorX: 420,
      anchorY: 260,
      menuWidth: 230,
      desiredMenuHeight: 180,
      viewportWidth: 1280,
      viewportHeight: 720,
      margin: 10,
    });

    expect(layout.left).toBe(420);
    expect(layout.top).toBe(260);
    expect(layout.left).not.toBe(420 - containerOffset.left);
    expect(layout.top).not.toBe(260 - containerOffset.top);
  });

  it("flips and clamps context-menu position at the bottom-right corner", () => {
    const pos = computeContextMenuPosition({
      anchorX: 1260,
      anchorY: 700,
      menuWidth: 220,
      menuHeight: 180,
      viewportWidth: 1280,
      viewportHeight: 720,
      margin: 10,
    });
    expect(pos.left).toBe(1040);
    expect(pos.top).toBe(520);
  });

  it("clamps context-menu position when viewport is smaller than menu", () => {
    const pos = computeContextMenuPosition({
      anchorX: 4,
      anchorY: 4,
      menuWidth: 500,
      menuHeight: 300,
      viewportWidth: 320,
      viewportHeight: 240,
      margin: 10,
    });
    expect(pos.left).toBe(10);
    expect(pos.top).toBe(10);
  });

  it("sizes tall context menus to the viewport before positioning", () => {
    const layout = computeContextMenuLayout({
      anchorX: 1260,
      anchorY: 700,
      menuWidth: 240,
      desiredMenuHeight: 900,
      viewportWidth: 1280,
      viewportHeight: 720,
      margin: 10,
    });

    expect(layout.left).toBe(1020);
    expect(layout.top).toBe(10);
    expect(layout.maxHeight).toBe(700);
  });

  it("keeps tall context submenus aligned with their trigger and scrollable", () => {
    const layout = computeContextSubmenuLayout({
      triggerLeft: 814,
      triggerRight: 1158,
      triggerTop: 693,
      menuWidth: 250,
      desiredMenuHeight: 800,
      viewportWidth: 1980,
      viewportHeight: 1240,
      margin: 10,
      gutter: 8,
    });

    expect(layout.left).toBe(1166);
    expect(layout.top).toBe(693);
    expect(layout.maxHeight).toBe(537);
  });

  it("opens context submenus to the left when the right side would overflow", () => {
    const layout = computeContextSubmenuLayout({
      triggerLeft: 1710,
      triggerRight: 1940,
      triggerTop: 120,
      menuWidth: 250,
      desiredMenuHeight: 360,
      viewportWidth: 1980,
      viewportHeight: 1240,
      margin: 10,
      gutter: 8,
    });

    expect(layout.left).toBe(1452);
    expect(layout.top).toBe(120);
    expect(layout.maxHeight).toBe(360);
  });

  it("keeps context menus open when their own scroll containers move", () => {
    const mainMenuTarget = {} as Node;
    const submenuTarget = {} as Node;
    const outsideTarget = {} as Node;
    const mainMenu = {
      contains: (node: Node | null) => node === mainMenuTarget,
    };
    const submenu = {
      contains: (node: Node | null) => node === submenuTarget,
    };

    expect(shouldCloseContextMenuOnScroll(mainMenuTarget, [mainMenu, submenu])).toBe(false);
    expect(shouldCloseContextMenuOnScroll(submenuTarget, [mainMenu, submenu])).toBe(false);
    expect(shouldCloseContextMenuOnScroll(outsideTarget, [mainMenu, submenu])).toBe(true);
    expect(shouldCloseContextMenuOnScroll(null, [mainMenu, submenu])).toBe(true);
  });
});
