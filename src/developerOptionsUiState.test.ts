import { describe, expect, it } from "vitest";
import { createDeveloperOptionSnapshot } from "./developerOptions";
import {
  buildMatrixSerialSet,
  buildDeveloperOptionBatchPlan,
  buildDeveloperOptionDivergenceRows,
  countPendingDeveloperOptions,
  createDeveloperOptionDeviceSnapshot,
  pruneDeveloperOptionsMatrixState,
  resolveDeveloperOptionsPrimaryAutoReadKey,
  resolveDeveloperOptionsMatrixStaleMessage,
  resolveDeveloperOptionValueForUi,
  resolveDeveloperOptionValueLabel,
  resolveDeveloperOptionsMatrixSerials,
  resolveDeveloperOptionsScope,
  setPendingDeveloperOptionValue,
  shouldMarkMatrixStaleAfterApply,
  type DeveloperOptionPendingMap,
} from "./developerOptionsUiState";

describe("developerOptionsUiState helpers", () => {
  it("resolves primary-instant scope from active serial", () => {
    const scope = resolveDeveloperOptionsScope({
      activeSerial: "emulator-5554",
      selectedSerials: ["emulator-5554", "device-1234"],
      onlineSerials: ["emulator-5554"],
      applyMode: "primary_instant",
    });

    expect(scope.readSerial).toBe("emulator-5554");
    expect(scope.primaryOnline).toBe(true);
    expect(scope.targetSerials).toEqual(["emulator-5554"]);
    expect(scope.selectedOnlineSerials).toEqual(["emulator-5554"]);
    expect(scope.selectedOfflineSerials).toEqual(["device-1234"]);
    expect(scope.skippedCount).toBe(0);
  });

  it("resolves selected-batch scope and offline skips", () => {
    const scope = resolveDeveloperOptionsScope({
      activeSerial: "emulator-5554",
      selectedSerials: ["emulator-5554", "device-1", "device-2", "device-2"],
      onlineSerials: ["device-2", "emulator-5554"],
      applyMode: "selected_batch",
    });

    expect(scope.targetSerials).toEqual(["emulator-5554", "device-2"]);
    expect(scope.applySourceSerials).toEqual(["emulator-5554", "device-1", "device-2"]);
    expect(scope.selectedOfflineSerials).toEqual(["device-1"]);
    expect(scope.skippedCount).toBe(1);
    expect(scope.hasOnlineTarget).toBe(true);
  });

  it("tracks pending changes and clears if value equals snapshot", () => {
    const snapshot = createDeveloperOptionSnapshot();
    snapshot.show_touches = false;

    let pending: DeveloperOptionPendingMap = {};
    pending = setPendingDeveloperOptionValue({
      pending,
      snapshot,
      optionKey: "show_touches",
      nextValue: true,
    });
    expect(pending).toEqual({ show_touches: true });
    expect(countPendingDeveloperOptions(pending)).toBe(1);

    pending = setPendingDeveloperOptionValue({
      pending,
      snapshot,
      optionKey: "show_touches",
      nextValue: false,
    });
    expect(pending).toEqual({});
    expect(countPendingDeveloperOptions(pending)).toBe(0);
  });

  it("resolves option value from pending first, otherwise snapshot", () => {
    const snapshot = createDeveloperOptionSnapshot();
    snapshot.window_animation_scale = "1";
    const pending: DeveloperOptionPendingMap = { window_animation_scale: "0.5" };

    expect(
      resolveDeveloperOptionValueForUi({
        optionKey: "window_animation_scale",
        snapshot,
        pending,
      }),
    ).toBe("0.5");
  });

  it("builds batch plan in developer-option definition order with high-risk extraction", () => {
    const pending: DeveloperOptionPendingMap = {
      show_touches: true,
      adb_enabled: false,
      pointer_location: true,
    };

    const plan = buildDeveloperOptionBatchPlan(pending);
    expect(plan.count).toBe(3);
    expect(plan.changes.map((item) => item.optionKey)).toEqual([
      "show_touches",
      "pointer_location",
      "adb_enabled",
    ]);
    expect(plan.highRiskChanges.map((item) => item.optionKey)).toEqual(["adb_enabled"]);
    expect(plan.hasHighRisk).toBe(true);
  });

  it("resolves matrix serials with primary pinned first", () => {
    const result = resolveDeveloperOptionsMatrixSerials({
      activeSerial: "primary",
      selectedSerials: ["secondary-1", "primary", "secondary-2", "offline-1"],
      onlineSerials: ["primary", "secondary-1", "secondary-2"],
    });

    expect(result.onlineSerials).toEqual(["primary", "secondary-1", "secondary-2"]);
    expect(result.offlineSerials).toEqual(["offline-1"]);
  });

  it("builds divergence rows against primary baseline", () => {
    const baseline = createDeveloperOptionDeviceSnapshot("primary", "success");
    baseline.values.show_touches = true;
    baseline.values.window_animation_scale = "1";

    const same = createDeveloperOptionDeviceSnapshot("same", "success");
    same.values.show_touches = true;
    same.values.window_animation_scale = "1";

    const diverged = createDeveloperOptionDeviceSnapshot("diverged", "success");
    diverged.values.show_touches = false;
    diverged.values.window_animation_scale = "0.5";

    const rows = buildDeveloperOptionDivergenceRows({
      baselineSerial: "primary",
      compareSerials: ["primary", "same", "diverged"],
      snapshotsBySerial: {
        primary: baseline,
        same,
        diverged,
      },
    });

    expect(rows.show_touches.hasBaseline).toBe(true);
    expect(rows.show_touches.divergentSerials).toEqual(["diverged"]);
    expect(rows.window_animation_scale.divergentSerials).toEqual(["diverged"]);
  });

  it("returns no divergence when baseline is unavailable", () => {
    const baseline = createDeveloperOptionDeviceSnapshot("primary", "error");
    const device = createDeveloperOptionDeviceSnapshot("device-1", "success");
    device.values.show_touches = true;

    const rows = buildDeveloperOptionDivergenceRows({
      baselineSerial: "primary",
      compareSerials: ["primary", "device-1"],
      snapshotsBySerial: {
        primary: baseline,
        "device-1": device,
      },
    });

    expect(rows.show_touches.hasBaseline).toBe(false);
    expect(rows.show_touches.divergentSerials).toEqual([]);
  });

  it("formats matrix value labels for toggle/select/null", () => {
    expect(resolveDeveloperOptionValueLabel("show_touches", true)).toBe("On");
    expect(resolveDeveloperOptionValueLabel("show_touches", false)).toBe("Off");
    expect(resolveDeveloperOptionValueLabel("window_animation_scale", "1")).toBe("1x");
    expect(resolveDeveloperOptionValueLabel("window_animation_scale", null)).toBe("N/A");
  });

  it("resolves primary auto-read key only for developer-options view with active serial", () => {
    expect(resolveDeveloperOptionsPrimaryAutoReadKey("emulator-5554", true)).toBe(
      "developer-options:emulator-5554",
    );
    expect(resolveDeveloperOptionsPrimaryAutoReadKey("emulator-5554", false)).toBeNull();
    expect(resolveDeveloperOptionsPrimaryAutoReadKey(null, true)).toBeNull();
  });

  it("marks matrix as stale after apply only when target serials overlap current matrix serials", () => {
    expect(
      shouldMarkMatrixStaleAfterApply(["emulator-5554"], ["emulator-5554", "device-2"]),
    ).toBe(true);
    expect(shouldMarkMatrixStaleAfterApply(["device-3"], ["emulator-5554", "device-2"])).toBe(false);
    expect(shouldMarkMatrixStaleAfterApply([], ["emulator-5554"])).toBe(false);
    expect(shouldMarkMatrixStaleAfterApply(["emulator-5554"], [])).toBe(false);
  });

  it("resolves stale message by reason", () => {
    expect(resolveDeveloperOptionsMatrixStaleMessage("selection_changed")).toContain(
      "selection changes",
    );
    expect(resolveDeveloperOptionsMatrixStaleMessage("apply_completed")).toContain("apply actions");
    expect(resolveDeveloperOptionsMatrixStaleMessage(null)).toBe("");
  });

  it("builds matrix serial set and removes duplicates", () => {
    const result = buildMatrixSerialSet(["emulator-5554", "device-2", "emulator-5554", ""]);
    expect(Array.from(result)).toEqual(["emulator-5554", "device-2"]);
  });

  it("prunes matrix state to allowed serials only", () => {
    const keep = createDeveloperOptionDeviceSnapshot("keep", "success");
    const remove = createDeveloperOptionDeviceSnapshot("remove", "error");
    const pruned = pruneDeveloperOptionsMatrixState({
      bySerial: { keep, remove },
      errorBySerial: { keep: null, remove: "Read failed" },
      allowedSerials: ["keep"],
    });

    expect(Object.keys(pruned.bySerial)).toEqual(["keep"]);
    expect(Object.keys(pruned.errorBySerial)).toEqual(["keep"]);
  });
});
