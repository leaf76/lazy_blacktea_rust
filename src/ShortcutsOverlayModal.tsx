import React, { useEffect } from "react";

type ShortcutsOverlayModalProps = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string; description: string }> }> = [
  {
    title: "Global",
    items: [
      { keys: "Ctrl+K / Cmd+K", description: "Open Command Palette (search pages, devices, actions, tasks)" },
      { keys: "?", description: "Toggle Keyboard Shortcuts help overlay" },
      { keys: "/", description: "Focus device search input (navigates to Devices if needed)" },
      { keys: "Esc", description: "Close open dialogs, overlays, or context menus" },
    ],
  },
  {
    title: "Devices List",
    items: [
      { keys: "ArrowUp / ArrowDown", description: "Move keyboard focus across visible devices" },
      { keys: "Space / Enter", description: "Toggle selection for focused device" },
      { keys: "Ctrl+A / Cmd+A", description: "Select all visible devices (Multi mode)" },
      { keys: "Ctrl+Shift+A", description: "Keep single primary device selected" },
    ],
  },
];

export const ShortcutsOverlayModal: React.FC<ShortcutsOverlayModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts"
      onClick={onClose}
    >
      <div className="modal-card shortcuts-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header" style={{ marginBottom: 10 }}>
          <h2>Keyboard Shortcuts</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="stack" style={{ gap: 6 }}>
              <strong>{group.title}</strong>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.keys} className="shortcut-row">
                    <span className="badge shortcut-kbd">{item.keys}</span>
                    <span className="muted">{item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
