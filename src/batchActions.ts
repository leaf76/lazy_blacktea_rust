export type BatchActionKind = "fan-out" | "set-state" | "stateful-toggle" | "singleton";
export type BatchActionMode = "blocked" | "run" | "set" | "start" | "stop" | "toggle";
export type BatchActionTaskGroupAction = "run" | "set" | "start" | "stop";

export type BatchActionTaskGroup = {
  action: BatchActionTaskGroupAction;
  key: string;
  serials: string[];
};

export type BatchActionMeta = {
  kind: BatchActionKind;
  requestedSerials: string[];
  eligibleSerials: string[];
  skippedSerials: string[];
  activeSerials: string[];
  idleSerials: string[];
  actionMode: BatchActionMode;
  title: string;
  description: string;
  hint: string;
  summary: string | null;
  taskGroups: BatchActionTaskGroup[];
  disabled: boolean;
  targetActive?: boolean;
};

type BatchActionContext = {
  kind: BatchActionKind;
  requestedSerials: string[];
  eligibleSerials: string[];
  skippedSerials: string[];
  activeSerials: string[];
  idleSerials: string[];
  actionMode: BatchActionMode;
  requestedCount: number;
  eligibleCount: number;
  skippedCount: number;
  activeCount: number;
  idleCount: number;
  multiSelected: boolean;
  targetActive?: boolean;
};

type ResolveBatchActionOptions = {
  kind: BatchActionKind;
  selectedSerials: string[];
  availabilityBySerial?: Record<string, boolean | undefined>;
  activeBySerial?: Record<string, boolean | undefined>;
  targetActive?: boolean;
  taskGroupKeys?: Partial<Record<BatchActionTaskGroupAction, string>>;
  buildCopy: (context: BatchActionContext) => Pick<BatchActionMeta, "title" | "description" | "hint" | "summary">;
};

type FanOutActionMetaOptions = {
  selectedSerials: string[];
  availabilityBySerial?: Record<string, boolean | undefined>;
  title: string;
  singleDescription: string;
  multiDescription: string;
  hint?: string;
  taskKey?: string;
};

type ConnectivityActionMetaOptions = {
  capabilityLabel: string;
  selectedSerials: string[];
  availabilityBySerial?: Record<string, boolean | undefined>;
  activeBySerial?: Record<string, boolean | undefined>;
};

type SingletonActionMetaOptions = {
  selectedSerials: string[];
  availabilityBySerial?: Record<string, boolean | undefined>;
  title: string;
  readyDescription: string;
  blockedDescription: string;
  hint?: string;
};

const uniq = (serials: string[]) => Array.from(new Set(serials));

const listEligibleSerials = (
  serials: string[],
  availabilityBySerial: Record<string, boolean | undefined>,
) => serials.filter((serial) => availabilityBySerial[serial] !== false);

const formatSummary = (parts: Array<[number, string]>): string | null => {
  const text = parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(", ");
  return text || null;
};

const appendSummary = (base: string, summary: string | null) => {
  if (!summary) {
    return base;
  }
  return `${base} ${summary}.`;
};

const buildTaskGroups = (
  context: BatchActionContext,
  keys: Partial<Record<BatchActionTaskGroupAction, string>>,
): BatchActionTaskGroup[] => {
  if (context.actionMode === "blocked") {
    return [];
  }
  if (context.kind === "fan-out") {
    return context.eligibleCount
      ? [{ action: "run", key: keys.run ?? "run", serials: context.eligibleSerials }]
      : [];
  }
  if (context.kind === "singleton") {
    return [];
  }
  if (context.kind === "set-state") {
    return context.eligibleCount
      ? [
          {
            action: "set",
            key: context.targetActive ? keys.set ?? "set_active" : keys.set ?? "set_idle",
            serials: context.eligibleSerials,
          },
        ]
      : [];
  }
  if (context.actionMode === "toggle") {
    const groups: BatchActionTaskGroup[] = [];
    if (context.activeCount) {
      groups.push({
        action: "stop",
        key: keys.stop ?? "stop",
        serials: context.activeSerials,
      });
    }
    if (context.idleCount) {
      groups.push({
        action: "start",
        key: keys.start ?? "start",
        serials: context.idleSerials,
      });
    }
    return groups;
  }
  if (context.actionMode === "stop") {
    return context.activeCount
      ? [{ action: "stop", key: keys.stop ?? "stop", serials: context.activeSerials }]
      : [];
  }
  return context.idleCount
    ? [{ action: "start", key: keys.start ?? "start", serials: context.idleSerials }]
    : [];
};

export const resolveBatchAction = ({
  kind,
  selectedSerials,
  availabilityBySerial = {},
  activeBySerial = {},
  targetActive,
  taskGroupKeys = {},
  buildCopy,
}: ResolveBatchActionOptions): BatchActionMeta => {
  const requestedSerials = uniq(selectedSerials);
  const eligibleSerials = listEligibleSerials(requestedSerials, availabilityBySerial);
  const skippedSerials = requestedSerials.filter((serial) => !eligibleSerials.includes(serial));

  let activeSerials: string[] = [];
  let idleSerials: string[] = [];
  let actionMode: BatchActionMode = "blocked";

  if (kind === "fan-out") {
    actionMode = eligibleSerials.length ? "run" : "blocked";
  } else if (kind === "singleton") {
    actionMode = requestedSerials.length === 1 && eligibleSerials.length === 1 ? "run" : "blocked";
  } else {
    activeSerials = eligibleSerials.filter((serial) => activeBySerial[serial] === true);
    idleSerials = eligibleSerials.filter((serial) => !activeSerials.includes(serial));
    if (!eligibleSerials.length) {
      actionMode = "blocked";
    } else if (kind === "set-state") {
      actionMode = "set";
    } else {
      actionMode =
        activeSerials.length === 0 ? "start" : idleSerials.length === 0 ? "stop" : "toggle";
    }
  }

  const context: BatchActionContext = {
    kind,
    requestedSerials,
    eligibleSerials,
    skippedSerials,
    activeSerials,
    idleSerials,
    actionMode,
    requestedCount: requestedSerials.length,
    eligibleCount: eligibleSerials.length,
    skippedCount: skippedSerials.length,
    activeCount: activeSerials.length,
    idleCount: idleSerials.length,
    multiSelected: requestedSerials.length > 1,
    targetActive,
  };

  const copy = buildCopy(context);

  return {
    ...context,
    ...copy,
    taskGroups: buildTaskGroups(context, taskGroupKeys),
    disabled: actionMode === "blocked",
  };
};

export const buildFanOutActionMeta = ({
  selectedSerials,
  availabilityBySerial = {},
  title,
  singleDescription,
  multiDescription,
  hint = "Multi-device",
  taskKey = "run",
}: FanOutActionMetaOptions): BatchActionMeta =>
  resolveBatchAction({
    kind: "fan-out",
    selectedSerials,
    availabilityBySerial,
    taskGroupKeys: { run: taskKey },
    buildCopy: (context) => {
      const summary =
        context.requestedCount === 0
          ? null
          : formatSummary([
              [context.eligibleCount, "eligible"],
              [context.skippedCount, "skipped"],
            ]);
      const base =
        context.requestedCount === 0
          ? multiDescription
          : context.eligibleCount === 0
            ? "No eligible devices selected."
            : context.requestedCount === 1
              ? singleDescription
              : multiDescription;
      return {
        title,
        description: appendSummary(base, summary),
        hint,
        summary,
      };
    },
  });

export const buildConnectivityActionMeta = ({
  capabilityLabel,
  selectedSerials,
  availabilityBySerial = {},
  activeBySerial = {},
}: ConnectivityActionMetaOptions): BatchActionMeta => {
  const requestedSerials = uniq(selectedSerials);
  const eligibleSerials = listEligibleSerials(requestedSerials, availabilityBySerial);
  const targetActive = eligibleSerials.length === 0 || eligibleSerials.some((serial) => activeBySerial[serial] !== true);

  return resolveBatchAction({
    kind: "set-state",
    selectedSerials,
    availabilityBySerial,
    activeBySerial,
    targetActive,
    taskGroupKeys: { set: targetActive ? "set_active" : "set_idle" },
    buildCopy: (context) => {
      const verb = context.targetActive ? "Enable" : "Disable";
      const summary =
        context.requestedCount === 0
          ? null
          : formatSummary([
              [context.eligibleCount, "eligible"],
              [context.skippedCount, "skipped"],
            ]);
      const base =
        context.requestedCount === 0
          ? `${verb} ${capabilityLabel} on eligible selected devices.`
          : context.eligibleCount === 0
            ? "No eligible devices selected."
            : context.requestedCount === 1 && context.skippedCount === 0
              ? `${verb} ${capabilityLabel} on the selected device.`
              : `${verb} ${capabilityLabel} on eligible selected devices.`;
      return {
        title: `${verb} ${capabilityLabel}`,
        description: appendSummary(base, summary),
        hint: "Multi-device",
        summary,
      };
    },
  });
};

export const buildSingletonActionMeta = ({
  selectedSerials,
  availabilityBySerial = {},
  title,
  readyDescription,
  blockedDescription,
  hint = "Single device",
}: SingletonActionMetaOptions): BatchActionMeta =>
  resolveBatchAction({
    kind: "singleton",
    selectedSerials,
    availabilityBySerial,
    buildCopy: (context) => ({
      title,
      description: context.actionMode === "run" ? readyDescription : blockedDescription,
      hint,
      summary: null,
    }),
  });

export const formatEligibilitySummary = (meta: Pick<BatchActionMeta, "eligibleSerials" | "skippedSerials">) =>
  formatSummary([
    [meta.eligibleSerials.length, "eligible"],
    [meta.skippedSerials.length, "skipped"],
  ]);

export const formatStateSummary = (
  meta: Pick<BatchActionMeta, "activeSerials" | "idleSerials" | "skippedSerials">,
  labels: {
    active: string;
    idle: string;
    skipped?: string;
  },
) =>
  formatSummary([
    [meta.activeSerials.length, labels.active],
    [meta.idleSerials.length, labels.idle],
    [meta.skippedSerials.length, labels.skipped ?? "skipped"],
  ]);

export const appendBatchSummary = appendSummary;
