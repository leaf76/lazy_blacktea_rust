import React from "react";
import {
  DEVICE_QUICK_FILTER_OPTIONS,
  type DeviceQuickFilterId,
} from "./deviceQuickFilters";

type DeviceQuickFilterBarProps = {
  activeFilters: DeviceQuickFilterId[];
  onToggle: (id: DeviceQuickFilterId) => void;
  onClearAll: () => void;
  hasAnyFilter: boolean;
};

export const DeviceQuickFilterBar: React.FC<DeviceQuickFilterBarProps> = ({
  activeFilters,
  onToggle,
  onClearAll,
  hasAnyFilter,
}) => {
  return (
    <div className="quick-filter-chips" role="group" aria-label="Device quick filters">
      {DEVICE_QUICK_FILTER_OPTIONS.map((option) => {
        const active = activeFilters.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            className={`quick-filter-chip${active ? " active" : ""}`}
            aria-pressed={active}
            onClick={() => onToggle(option.id)}
          >
            {option.label}
          </button>
        );
      })}
      {hasAnyFilter && (
        <button type="button" className="quick-filter-chip ghost" onClick={onClearAll}>
          Clear Filters
        </button>
      )}
    </div>
  );
};
