import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  filterCommandPaletteItems,
  type CommandPaletteCategory,
  type CommandPaletteItem,
} from "./commandPalette";

type CommandPaletteModalProps = {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
  onSelect: (item: CommandPaletteItem) => void;
};

const CATEGORY_LABELS: Record<CommandPaletteCategory, string> = {
  action: "Quick Actions",
  device: "Devices",
  navigation: "Navigation",
  task: "Recent Tasks",
};

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  items,
  onClose,
  onSelect,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => filterCommandPaletteItems(items, query), [items, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (filtered.length === 0) {
        return 0;
      }
      return Math.min(prev, filtered.length - 1);
    });
  }, [filtered.length]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target && !target.disabled) {
        onSelect(target);
        onClose();
      }
    }
  };

  return (
    <div
      className="modal-backdrop command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onClick={onClose}
    >
      <div
        className="modal-card command-palette-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-search-row">
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search pages, devices, actions, or recent tasks…"
            aria-label="Command palette search"
          />
          <span className="badge">Esc</span>
        </div>

        <div className="command-palette-list" role="listbox" aria-label="Command palette results">
          {filtered.length === 0 ? (
            <div className="command-palette-empty muted">No matching commands or devices.</div>
          ) : (
            filtered.map((item, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={item.disabled}
                  className={`command-palette-item${isActive ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    if (!item.disabled) {
                      onSelect(item);
                      onClose();
                    }
                  }}
                >
                  <div className="command-palette-item-main">
                    <strong>{item.title}</strong>
                    {item.subtitle && <span className="muted">{item.subtitle}</span>}
                  </div>
                  <div className="command-palette-item-meta">
                    <span className="badge">{CATEGORY_LABELS[item.category]}</span>
                    {item.shortcut && <span className="badge">{item.shortcut}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
