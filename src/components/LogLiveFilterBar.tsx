import { memo, type ReactNode } from "react";
import type { LogTextChip, LogTextChipKind } from "../logTextFilters";

export function AdvancedToggleButton({
  open,
  onClick,
  disabled,
  className,
}: {
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`ghost${open ? " active" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
    >
      {open ? "Hide Advanced" : "Advanced"}
    </button>
  );
}

export const LogLiveFilterBar = memo(function LogLiveFilterBar({
  kind,
  onKindChange,
  value,
  onValueChange,
  onAdd,
  chips,
  onRemoveChip,
  onEditChip,
  onClearChips,
  showChipsRow,
  presets,
  presetSelected,
  onPresetSelectedChange,
  presetName,
  onPresetNameChange,
  hasSelectedPreset,
  onApplyPreset,
  onUpdatePreset,
  onDeletePreset,
  onSavePreset,
  showPresetRow,
  disabled,
  filtersCount,
  activePresetLabel,
  levelsSummary,
  isPresetDirty,
  headerActions,
  advancedOptions,
  selectClassName,
  compact,
  expanded,
  onToggleExpanded,
}: {
  kind: LogTextChipKind;
  onKindChange: (next: LogTextChipKind) => void;
  value: string;
  onValueChange: (next: string) => void;
  onAdd: () => void;
  chips?: LogTextChip[];
  onRemoveChip?: (chipId: string) => void;
  onEditChip?: (chip: LogTextChip) => void;
  onClearChips?: () => void;
  showChipsRow?: boolean;
  presets?: Array<{ name: string }>;
  presetSelected?: string;
  onPresetSelectedChange?: (next: string) => void;
  presetName?: string;
  onPresetNameChange?: (next: string) => void;
  hasSelectedPreset?: boolean;
  onApplyPreset?: (name: string) => void;
  onUpdatePreset?: (name: string) => void;
  onDeletePreset?: (name: string) => void;
  onSavePreset?: () => void;
  showPresetRow?: boolean;
  disabled: boolean;
  filtersCount: number;
  activePresetLabel?: string;
  levelsSummary?: string;
  isPresetDirty?: boolean;
  headerActions?: ReactNode;
  advancedOptions?: ReactNode;
  selectClassName?: string;
  compact?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const activeChips = chips ?? [];
  const shouldShowChipsRow = showChipsRow ?? true;
  const availablePresets = presets ?? [];
  const shouldShowPresetRow = showPresetRow ?? false;
  const nextPresetSelected = presetSelected ?? "";
  const nextPresetName = presetName ?? "";
  const canApplyPreset = Boolean(hasSelectedPreset && onApplyPreset && nextPresetSelected);
  const canUpdatePreset = Boolean(hasSelectedPreset && onUpdatePreset && nextPresetSelected);
  const canDeletePreset = Boolean(hasSelectedPreset && onDeletePreset && nextPresetSelected);
  const canSavePreset = Boolean(onSavePreset && nextPresetName.trim());
  const hasActivePreset = Boolean(activePresetLabel?.trim());
  const presetLabel = activePresetLabel?.trim() || "None";
  const levelsLabel = levelsSummary?.trim() || "All";
  const stateLabel = hasActivePreset
    ? isPresetDirty
      ? "Unsaved changes"
      : "Saved"
    : "No preset selected";
  const isCollapsible = compact ?? false;
  const isCollapsed = isCollapsible ? !(expanded ?? false) : false;

  return (
    <div
      className={`logcat-filter-grid logcat-live-filter-grid${isCollapsed ? " is-collapsed" : ""}`}
    >
      <div className="panel-sub logcat-filter-bar logcat-live-filter-bar">
        <div className="logcat-filter-combined">
          <div className="logcat-filter-section">
            <div className="logcat-filter-header">
              <h3 title="Use regex to refine logs. Shared with Logcat and Bugreport Log Viewer.">
                Live Filter
              </h3>
              <div className="logcat-filter-header-actions">
                <span className="muted">
                  {filtersCount ? `${filtersCount} filters` : "No filters"}
                </span>
                {headerActions}
                {isCollapsible && onToggleExpanded ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={onToggleExpanded}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? "Expand" : "Collapse"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="form-row">
              <label>Pattern</label>
              <select
                className={selectClassName}
                aria-label="Filter mode"
                value={kind}
                onChange={(event) => onKindChange(event.target.value as LogTextChipKind)}
                disabled={disabled}
                title="Prefix with - or ! to exclude, + to include."
              >
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <input
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                onKeyDown={(event) => {
                  const nativeIsComposing = Boolean(
                    (event.nativeEvent as KeyboardEvent).isComposing,
                  );
                  if (event.key === "Enter" && !nativeIsComposing) {
                    event.preventDefault();
                    onAdd();
                  }
                }}
                placeholder="e.g. ActivityManager|AndroidRuntime or -DEBUG"
                title="Regex patterns are case-insensitive."
                disabled={disabled}
              />
              <button type="button" onClick={onAdd} disabled={disabled || !value.trim()}>
                Add
              </button>
            </div>
            <div className="live-filter-status-strip" role="status" aria-live="polite">
              <span className="live-filter-status-pill">
                <span className="live-filter-status-pill-label">Preset</span>
                <strong>{presetLabel}</strong>
              </span>
              <span className="live-filter-status-pill">
                <span className="live-filter-status-pill-label">Filters</span>
                <strong>{filtersCount}</strong>
              </span>
              <span className="live-filter-status-pill">
                <span className="live-filter-status-pill-label">Levels</span>
                <strong>{levelsLabel}</strong>
              </span>
              <span className={`live-filter-status-pill ${isPresetDirty ? "is-dirty" : ""}`}>
                <span className="live-filter-status-pill-label">State</span>
                <strong>{stateLabel}</strong>
              </span>
            </div>
            {!isCollapsed && advancedOptions ? (
              <div className="logcat-live-filter-advanced">{advancedOptions}</div>
            ) : null}
            {!isCollapsed && shouldShowChipsRow && (
              <div className="logcat-live-filter-chip-row">
                {activeChips.length === 0 ? (
                  <p className="muted">No active filters yet.</p>
                ) : (
                  <>
                    <div
                      className="logcat-live-filter-chip-list"
                      role="list"
                      aria-label="Active live filters"
                    >
                      {activeChips.map((chip) => (
                        <span
                          key={chip.id}
                          className={`bugreport-log-chip ${chip.kind === "exclude" ? "exclude" : "include"}`}
                          role="listitem"
                        >
                          <button
                            type="button"
                            className="logcat-live-filter-chip-edit"
                            onClick={() => onEditChip?.(chip)}
                            disabled={disabled || !onEditChip}
                            title="Click to edit"
                            aria-label={`Edit ${chip.kind === "exclude" ? "exclude" : "include"} filter ${chip.value}`}
                          >
                            <span className="bugreport-log-chip-label" title={chip.value}>
                              {chip.kind === "exclude" ? `NOT ${chip.value}` : chip.value}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="bugreport-log-chip-remove"
                            aria-label={`Remove ${chip.kind === "exclude" ? "NOT " : ""}${chip.value}`}
                            onClick={() => onRemoveChip?.(chip.id)}
                            disabled={disabled || !onRemoveChip}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      onClick={onClearChips}
                      disabled={disabled || activeChips.length === 0 || !onClearChips}
                    >
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            )}
            {!isCollapsed && shouldShowPresetRow && (
              <div className="logcat-presets">
                <div className="logcat-preset-row single">
                  <div className="logcat-preset-group left">
                    <label>Preset</label>
                    <select
                      className={selectClassName}
                      value={nextPresetSelected}
                      onChange={(event) => onPresetSelectedChange?.(event.target.value)}
                      disabled={disabled || !onPresetSelectedChange}
                    >
                      <option value="">Select preset</option>
                      {availablePresets.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (nextPresetSelected) {
                          onApplyPreset?.(nextPresetSelected);
                        }
                      }}
                      disabled={disabled || !canApplyPreset}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        if (nextPresetSelected) {
                          onUpdatePreset?.(nextPresetSelected);
                        }
                      }}
                      disabled={disabled || !canUpdatePreset}
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        if (nextPresetSelected) {
                          onDeletePreset?.(nextPresetSelected);
                        }
                      }}
                      disabled={disabled || !canDeletePreset}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="logcat-preset-group right">
                    <label>New</label>
                    <input
                      value={nextPresetName}
                      onChange={(event) => onPresetNameChange?.(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && nextPresetName.trim() && !disabled) {
                          event.preventDefault();
                          onSavePreset?.();
                        }
                      }}
                      placeholder="e.g. Crash Only"
                      disabled={disabled || !onPresetNameChange}
                    />
                    <button
                      type="button"
                      onClick={onSavePreset}
                      disabled={disabled || !canSavePreset}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
