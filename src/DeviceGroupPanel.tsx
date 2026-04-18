import type { DeviceInfo } from "./types";
import {
  buildDeviceGroupSelectionSummary,
  formatPrimaryDeviceLabel,
  type DeviceGroupOption,
} from "./deviceUtils";

type DeviceGroupPanelProps = {
  busy: boolean;
  selectedDevices: DeviceInfo[];
  selectedCount: number;
  selectedOnlineCount: number;
  groupMap: Record<string, string>;
  groupName: string;
  groupFilter: string;
  groups: DeviceGroupOption[];
  onGroupNameChange: (value: string) => void;
  onAssignGroup: () => void;
  onAssignExistingGroup: (group: string) => void;
  onClearAssignment: () => void;
  onApplyFilter: (group: string) => void;
  onClearFilter: () => void;
};

const renderSelectionDescription = (
  summary: ReturnType<typeof buildDeviceGroupSelectionSummary>,
  selectedDevices: DeviceInfo[],
  selectedOnlineCount: number,
) => {
  if (summary.kind === "none") {
    return "Select one or more devices to assign, move, or clear group membership.";
  }
  if (summary.kind === "single") {
    const device = selectedDevices[0] ?? null;
    const label = device
      ? formatPrimaryDeviceLabel(device.summary.serial, device)
      : "Selected device";
    return summary.groupName
      ? `${label} is currently in ${summary.groupName}.`
      : `${label} is currently ungrouped.`;
  }
  if (summary.groupState === "single_group" && summary.groupName) {
    return `${summary.selectedCount} selected · ${selectedOnlineCount} online · all devices are in ${summary.groupName}.`;
  }
  if (summary.groupState === "ungrouped") {
    return `${summary.selectedCount} selected · ${selectedOnlineCount} online · no group assigned yet.`;
  }
  return `${summary.selectedCount} selected · ${selectedOnlineCount} online · selection spans multiple group states.`;
};

const renderSelectionChip = (summary: ReturnType<typeof buildDeviceGroupSelectionSummary>) => {
  if (summary.kind === "none") {
    return <span className="group-tag is-muted">No selection</span>;
  }
  if (summary.groupState === "single_group" && summary.groupName) {
    return <span className="group-tag">{summary.groupName}</span>;
  }
  if (summary.groupState === "mixed") {
    return <span className="group-tag is-mixed">Mixed groups</span>;
  }
  return <span className="group-tag is-muted">Ungrouped</span>;
};

export function DeviceGroupPanel({
  busy,
  selectedDevices,
  selectedCount,
  selectedOnlineCount,
  groupMap,
  groupName,
  groupFilter,
  groups,
  onGroupNameChange,
  onAssignGroup,
  onAssignExistingGroup,
  onClearAssignment,
  onApplyFilter,
  onClearFilter,
}: DeviceGroupPanelProps) {
  const summary = buildDeviceGroupSelectionSummary(
    selectedDevices.map((device) => device.summary.serial),
    groupMap,
  );
  const hasSelection = selectedCount > 0;
  const hasGroups = groups.length > 0;
  const helperText = hasSelection
    ? "Click an existing group to assign the current selection."
    : "Click a group to filter the device list.";

  return (
    <aside className="panel device-group-panel" aria-label="Device groups">
      <div className="panel-header">
        <div>
          <h3>Groups</h3>
          <span>{hasGroups ? `${groups.length} groups available` : "Create the first group from a selection"}</span>
        </div>
      </div>

      <div className="device-group-panel-body">
        <section className="device-group-section">
          <div className="device-group-section-header">
            <span className="device-group-section-label">List Filter</span>
            {groupFilter !== "all" ? (
              <button type="button" className="ghost device-group-filter-clear" onClick={onClearFilter} disabled={busy}>
                Show all
              </button>
            ) : null}
          </div>
          <div className="device-group-filter-state">
            <span className={`group-tag${groupFilter === "all" ? " is-active-filter" : " is-muted"}`}>
              {groupFilter === "all" ? "All groups" : groupFilter}
            </span>
            <p className="muted">
              {groupFilter === "all"
                ? "The list currently shows devices from every group."
                : "The list is filtered to one group."}
            </p>
          </div>
        </section>

        <section className="device-group-section device-group-selection-card">
          <div className="device-group-section-header">
            <span className="device-group-section-label">Selection</span>
            {renderSelectionChip(summary)}
          </div>
          <strong className="device-group-selection-title">
            {summary.kind === "none"
              ? "No devices selected"
              : summary.kind === "single"
                ? "Single device selection"
                : "Multi-device selection"}
          </strong>
          <p className="muted">{renderSelectionDescription(summary, selectedDevices, selectedOnlineCount)}</p>

          <div className="device-group-editor">
            <input
              value={groupName}
              onChange={(event) => onGroupNameChange(event.target.value)}
              placeholder={hasSelection ? "Create or reuse a group name" : "Select devices to start grouping"}
              disabled={busy || !hasSelection}
              aria-label="Group name"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy && hasSelection) {
                  event.preventDefault();
                  onAssignGroup();
                }
              }}
            />
            <div className="device-group-editor-actions">
              <button type="button" onClick={onAssignGroup} disabled={busy || !hasSelection}>
                Assign
              </button>
              <button
                type="button"
                className="ghost"
                onClick={onClearAssignment}
                disabled={busy || !summary.canClear}
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        <section className="device-group-section">
          <div className="device-group-section-header">
            <span className="device-group-section-label">
              {hasSelection ? "Existing Groups" : "Browse Groups"}
            </span>
            {hasGroups ? <span className="muted device-group-helper">{helperText}</span> : null}
          </div>
          {hasGroups ? (
            <div className="device-group-list" role="list">
              {groups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  className={`device-group-card${group.isActiveFilter ? " is-active" : ""}`}
                  onClick={() => (hasSelection ? onAssignExistingGroup(group.name) : onApplyFilter(group.name))}
                  disabled={busy}
                >
                  <span className="device-group-card-main">
                    <span className="group-tag">{group.name}</span>
                    <span className="muted">
                      {group.count} {group.count === 1 ? "device" : "devices"}
                    </span>
                  </span>
                  <span className="device-group-card-action">
                    {hasSelection ? "Assign" : group.isActiveFilter ? "Filtered" : "Filter"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="device-group-empty" role="status">
              <strong>No groups yet</strong>
              <p className="muted">
                {hasSelection
                  ? "Enter a group name above to create the first group for the selected devices."
                  : "Select devices first, then assign them to a new group."}
              </p>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
