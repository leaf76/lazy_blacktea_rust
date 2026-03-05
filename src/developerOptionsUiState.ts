import {
  DEVELOPER_OPTIONS,
  type DeveloperOptionKey,
  type DeveloperOptionSnapshot,
  type DeveloperOptionDefinition,
  type DeveloperOptionValue,
} from "./developerOptions";

export type DeveloperOptionsApplyMode = "primary_instant" | "selected_batch";

export type DeveloperOptionPendingMap = Partial<Record<DeveloperOptionKey, DeveloperOptionValue>>;

export type DeveloperOptionDeviceReadStatus =
  | "idle"
  | "loading"
  | "success"
  | "unsupported"
  | "offline"
  | "error";

export type DeveloperOptionDeviceSnapshot = {
  serial: string;
  status: DeveloperOptionDeviceReadStatus;
  values: DeveloperOptionSnapshot;
  supportedByKey: Record<DeveloperOptionKey, boolean>;
  messageByKey: Record<DeveloperOptionKey, string | null>;
  lastReadAt: number | null;
};

export type DeveloperOptionsMatrixState = {
  bySerial: Record<string, DeveloperOptionDeviceSnapshot>;
  loadingSerials: string[];
  errorBySerial: Record<string, string | null>;
  lastRefreshAt: number | null;
};

export type DeveloperOptionDivergenceRow = {
  optionKey: DeveloperOptionKey;
  divergentSerials: string[];
  hasBaseline: boolean;
};

export type DeveloperOptionsMatrixLogBufferState = "idle" | "loading" | "loaded" | "error";
export type DeveloperOptionsMatrixRefreshMode = "fast" | "full";

export type DeveloperOptionsMatrixStaleReason = "selection_changed" | "apply_completed";

export type ResolveDeveloperOptionsScopeInput = {
  activeSerial: string | null;
  selectedSerials: string[];
  onlineSerials: string[];
  applyMode: DeveloperOptionsApplyMode;
};

export type DeveloperOptionsScope = {
  readSerial: string | null;
  primaryOnline: boolean;
  uniqueSelectedSerials: string[];
  selectedOnlineSerials: string[];
  selectedOfflineSerials: string[];
  applySourceSerials: string[];
  targetSerials: string[];
  skippedCount: number;
  hasOnlineTarget: boolean;
};

export type DeveloperOptionBatchChange = {
  optionKey: DeveloperOptionKey;
  label: string;
  value: Exclude<DeveloperOptionValue, null>;
  highRisk: boolean;
};

export type DeveloperOptionRiskChangeSummary = Pick<
  DeveloperOptionBatchChange,
  "optionKey" | "label" | "value"
>;

export type DeveloperOptionBatchPlan = {
  changes: DeveloperOptionBatchChange[];
  highRiskChanges: DeveloperOptionRiskChangeSummary[];
  count: number;
  hasHighRisk: boolean;
};

type ResolveDeveloperOptionsMatrixSerialsInput = {
  activeSerial: string | null;
  selectedSerials: string[];
  onlineSerials: string[];
};

const createDeveloperOptionSupportMap = (value: boolean): Record<DeveloperOptionKey, boolean> => {
  const map = {} as Record<DeveloperOptionKey, boolean>;
  DEVELOPER_OPTIONS.forEach((option) => {
    map[option.key] = value;
  });
  return map;
};

const createDeveloperOptionMessageMap = (): Record<DeveloperOptionKey, string | null> => {
  const map = {} as Record<DeveloperOptionKey, string | null>;
  DEVELOPER_OPTIONS.forEach((option) => {
    map[option.key] = null;
  });
  return map;
};

const optionByKey = new Map<DeveloperOptionKey, DeveloperOptionDefinition>(
  DEVELOPER_OPTIONS.map((option) => [option.key, option]),
);

export const resolveDeveloperOptionsScope = (
  input: ResolveDeveloperOptionsScopeInput,
): DeveloperOptionsScope => {
  const onlineSerialSet = new Set(input.onlineSerials);
  const uniqueSelectedSerials = Array.from(new Set(input.selectedSerials));
  const selectedOnlineSerials = uniqueSelectedSerials.filter((serial) => onlineSerialSet.has(serial));
  const selectedOfflineSerials = uniqueSelectedSerials.filter((serial) => !onlineSerialSet.has(serial));
  const primaryOnline = !!input.activeSerial && onlineSerialSet.has(input.activeSerial);
  const applySourceSerials =
    input.applyMode === "selected_batch"
      ? uniqueSelectedSerials
      : input.activeSerial
        ? [input.activeSerial]
        : [];
  const targetSerials = applySourceSerials.filter((serial) => onlineSerialSet.has(serial));

  return {
    readSerial: input.activeSerial,
    primaryOnline,
    uniqueSelectedSerials,
    selectedOnlineSerials,
    selectedOfflineSerials,
    applySourceSerials,
    targetSerials,
    skippedCount: Math.max(0, applySourceSerials.length - targetSerials.length),
    hasOnlineTarget: targetSerials.length > 0,
  };
};

export const createDeveloperOptionDeviceSnapshot = (
  serial: string,
  status: DeveloperOptionDeviceReadStatus = "idle",
): DeveloperOptionDeviceSnapshot => ({
  serial,
  status,
  values: {
    log_buffer_size: null,
    stay_on_while_plugged_in: null,
    bluetooth_btsnoop_default_mode: null,
    show_touches: null,
    pointer_location: null,
    window_animation_scale: null,
    transition_animation_scale: null,
    animator_duration_scale: null,
    always_finish_activities: null,
    mobile_data_always_on: null,
    development_settings_enabled: null,
    adb_enabled: null,
    adb_wifi_enabled: null,
    verifier_verify_adb_installs: null,
  },
  supportedByKey: createDeveloperOptionSupportMap(false),
  messageByKey: createDeveloperOptionMessageMap(),
  lastReadAt: null,
});

export const createDeveloperOptionsMatrixState = (): DeveloperOptionsMatrixState => ({
  bySerial: {},
  loadingSerials: [],
  errorBySerial: {},
  lastRefreshAt: null,
});

export const resolveDeveloperOptionsMatrixSerials = (
  input: ResolveDeveloperOptionsMatrixSerialsInput,
): { onlineSerials: string[]; offlineSerials: string[] } => {
  const uniqueSelectedSerials = Array.from(new Set(input.selectedSerials));
  const onlineSet = new Set(input.onlineSerials);
  const onlineSerials = uniqueSelectedSerials.filter((serial) => onlineSet.has(serial));
  const offlineSerials = uniqueSelectedSerials.filter((serial) => !onlineSet.has(serial));

  if (input.activeSerial && onlineSerials.includes(input.activeSerial)) {
    return {
      onlineSerials: [input.activeSerial, ...onlineSerials.filter((serial) => serial !== input.activeSerial)],
      offlineSerials,
    };
  }

  return { onlineSerials, offlineSerials };
};

export const buildMatrixSerialSet = (serials: string[]): Set<string> =>
  new Set(serials.filter((serial) => serial.trim().length > 0));

export const pruneDeveloperOptionsMatrixState = ({
  bySerial,
  errorBySerial,
  allowedSerials,
}: {
  bySerial: Record<string, DeveloperOptionDeviceSnapshot>;
  errorBySerial: Record<string, string | null>;
  allowedSerials: string[];
}): Pick<DeveloperOptionsMatrixState, "bySerial" | "errorBySerial"> => {
  const allowedSet = buildMatrixSerialSet(allowedSerials);
  if (allowedSet.size === 0) {
    return { bySerial: {}, errorBySerial: {} };
  }

  const nextBySerial: Record<string, DeveloperOptionDeviceSnapshot> = {};
  const nextErrorBySerial: Record<string, string | null> = {};

  Object.entries(bySerial).forEach(([serial, snapshot]) => {
    if (allowedSet.has(serial)) {
      nextBySerial[serial] = snapshot;
    }
  });
  Object.entries(errorBySerial).forEach(([serial, message]) => {
    if (allowedSet.has(serial)) {
      nextErrorBySerial[serial] = message;
    }
  });

  return {
    bySerial: nextBySerial,
    errorBySerial: nextErrorBySerial,
  };
};

export const resolveDeveloperOptionsPrimaryAutoReadKey = (
  activeSerial: string | null,
  isDeveloperOptionsView: boolean,
): string | null => {
  if (!isDeveloperOptionsView || !activeSerial) {
    return null;
  }
  return `developer-options:${activeSerial}`;
};

export const shouldMarkMatrixStaleAfterApply = (
  targetSerials: string[],
  matrixOnlineSerials: string[],
): boolean => {
  if (targetSerials.length === 0 || matrixOnlineSerials.length === 0) {
    return false;
  }
  const matrixSet = new Set(matrixOnlineSerials);
  return targetSerials.some((serial) => matrixSet.has(serial));
};

export const resolveDeveloperOptionsMatrixStaleMessage = (
  reason: DeveloperOptionsMatrixStaleReason | null,
  staleAt?: number | null,
): string => {
  const suffix = staleAt ? ` Last change: ${new Date(staleAt).toLocaleTimeString()}.` : "";
  if (reason === "selection_changed") {
    return `Comparison values may be outdated due to selection changes. Refresh selected to update.${suffix}`;
  }
  if (reason === "apply_completed") {
    return `Comparison values may be outdated after apply actions. Refresh selected to update.${suffix}`;
  }
  return "";
};

export const resolveDeveloperOptionValueLabel = (
  optionKey: DeveloperOptionKey,
  value: DeveloperOptionValue,
): string => {
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  if (typeof value === "string") {
    const option = optionByKey.get(optionKey);
    const optionLabel = option?.options?.find((item) => item.value === value)?.label;
    return optionLabel ?? value;
  }
  return "N/A";
};

export const buildDeveloperOptionDivergenceRows = ({
  baselineSerial,
  compareSerials,
  snapshotsBySerial,
}: {
  baselineSerial: string | null;
  compareSerials: string[];
  snapshotsBySerial: Record<string, DeveloperOptionDeviceSnapshot>;
}): Record<DeveloperOptionKey, DeveloperOptionDivergenceRow> => {
  const result = {} as Record<DeveloperOptionKey, DeveloperOptionDivergenceRow>;
  const baseline = baselineSerial ? snapshotsBySerial[baselineSerial] : undefined;
  const hasBaseline = !!baseline && baseline.status === "success";

  DEVELOPER_OPTIONS.forEach((option) => {
    const divergentSerials: string[] = [];
    if (hasBaseline && baseline) {
      const baselineValue = baseline.values[option.key];
      compareSerials.forEach((serial) => {
        if (serial === baseline.serial) {
          return;
        }
        const snapshot = snapshotsBySerial[serial];
        if (!snapshot || snapshot.status !== "success") {
          return;
        }
        if (snapshot.values[option.key] !== baselineValue) {
          divergentSerials.push(serial);
        }
      });
    }

    result[option.key] = {
      optionKey: option.key,
      divergentSerials,
      hasBaseline,
    };
  });

  return result;
};

export const countPendingDeveloperOptions = (pending: DeveloperOptionPendingMap): number =>
  Object.keys(pending).length;

export const hasPendingDeveloperOptionValue = (
  pending: DeveloperOptionPendingMap,
  optionKey: DeveloperOptionKey,
): boolean => Object.prototype.hasOwnProperty.call(pending, optionKey);

export const resolveDeveloperOptionValueForUi = ({
  optionKey,
  snapshot,
  pending,
}: {
  optionKey: DeveloperOptionKey;
  snapshot: DeveloperOptionSnapshot;
  pending: DeveloperOptionPendingMap;
}): DeveloperOptionValue =>
  hasPendingDeveloperOptionValue(pending, optionKey) ? pending[optionKey] ?? null : snapshot[optionKey];

export const setPendingDeveloperOptionValue = ({
  pending,
  snapshot,
  optionKey,
  nextValue,
}: {
  pending: DeveloperOptionPendingMap;
  snapshot: DeveloperOptionSnapshot;
  optionKey: DeveloperOptionKey;
  nextValue: DeveloperOptionValue;
}): DeveloperOptionPendingMap => {
  const currentValue = snapshot[optionKey];
  const nextPending = { ...pending };
  if (nextValue == null || currentValue === nextValue) {
    delete nextPending[optionKey];
    return nextPending;
  }
  nextPending[optionKey] = nextValue;
  return nextPending;
};

export const clearPendingDeveloperOption = (
  pending: DeveloperOptionPendingMap,
  optionKey: DeveloperOptionKey,
): DeveloperOptionPendingMap => {
  if (!hasPendingDeveloperOptionValue(pending, optionKey)) {
    return pending;
  }
  const nextPending = { ...pending };
  delete nextPending[optionKey];
  return nextPending;
};

export const buildDeveloperOptionBatchPlan = (
  pending: DeveloperOptionPendingMap,
): DeveloperOptionBatchPlan => {
  const changes: DeveloperOptionBatchChange[] = [];
  DEVELOPER_OPTIONS.forEach((option) => {
    if (!hasPendingDeveloperOptionValue(pending, option.key)) {
      return;
    }
    const value = pending[option.key];
    if (value == null) {
      return;
    }
    changes.push({
      optionKey: option.key,
      label: option.label,
      value,
      highRisk: option.highRisk,
    });
  });

  const highRiskChanges: DeveloperOptionRiskChangeSummary[] = changes
    .filter((change) => change.highRisk)
    .map((change) => ({
      optionKey: change.optionKey,
      label: change.label,
      value: change.value,
    }));

  return {
    changes,
    highRiskChanges,
    count: changes.length,
    hasHighRisk: highRiskChanges.length > 0,
  };
};
