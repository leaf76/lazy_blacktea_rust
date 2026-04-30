import { useMemo, useRef, useState } from "react";
import {
  buildAdbCommandRunStartResult,
  buildCustomAdbCommandPack,
  buildAdbCommandLibraryEntries,
  createCustomAdbCommand,
  CUSTOM_ADB_COMMAND_PACK_FILENAME,
  EXAMPLE_ADB_COMMAND_PACK,
  formatAdbCommandPackJson,
  mergeImportedAdbCommandPack,
  normalizeAdbCommandLibrarySettings,
  parseAdbCommandPackJson,
  removeCustomAdbCommand,
  removeImportedAdbCommandPack,
  setAdbCommandFavorite,
  upsertCustomAdbCommand,
  type AdbCommandRunDeviceResult,
  type AdbCommandRunResult,
  type AdbCommandLibraryEntry,
} from "./adbCommandLibrary";
import type { AdbCommandLibrarySettings, AdbCommandRisk } from "./types";

type CommandDraft = {
  title: string;
  category: string;
  command: string;
  description: string;
  tags: string;
  risk: AdbCommandRisk;
};

type AdbCommandLibraryPanelProps = {
  library: AdbCommandLibrarySettings | null | undefined;
  targetSerials: string[];
  disabled: boolean;
  onSaveLibrary: (library: AdbCommandLibrarySettings, message: string) => Promise<boolean>;
  onRunCommand: (
    entry: AdbCommandLibraryEntry,
    startedAt: string,
  ) => Promise<AdbCommandRunResult | null>;
  onCopyText: (text: string, successMessage: string) => Promise<void>;
  onNotify: (message: string, tone: "info" | "error") => void;
};

const CATEGORY_ALL = "__all__";
const CATEGORY_FAVORITES = "__favorites__";
const EXAMPLE_ADB_COMMAND_PACK_FILENAME = "lazy-blacktea-example-pack.json";

const createBlankDraft = (): CommandDraft => ({
  title: "",
  category: "Custom",
  command: "",
  description: "",
  tags: "",
  risk: "normal",
});

const buildDraftFromEntry = (entry: AdbCommandLibraryEntry): CommandDraft => ({
  title: entry.title,
  category: entry.category,
  command: entry.command,
  description: entry.description,
  tags: entry.tags.join(", "),
  risk: entry.risk,
});

const parseTagsInput = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const describeSource = (entry: AdbCommandLibraryEntry): string => {
  if (entry.source === "built_in") {
    return "Built-in";
  }
  if (entry.source === "custom") {
    return "Custom";
  }
  return entry.pack_name;
};

const formatRunTime = (value: string | null): string => {
  if (!value) {
    return "Running";
  }
  return new Date(value).toLocaleString();
};

const runStatusTone = (status: AdbCommandRunResult["status"]): string => {
  if (status === "running") {
    return "busy";
  }
  return status === "success" ? "ok" : "error";
};

const deviceRunStatusTone = (status: AdbCommandRunDeviceResult["status"]): string => {
  if (status === "running") {
    return "busy";
  }
  return status === "success" ? "ok" : "error";
};

const downloadJsonFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export function AdbCommandLibraryPanel({
  library,
  targetSerials,
  disabled,
  onSaveLibrary,
  onRunCommand,
  onCopyText,
  onNotify,
}: AdbCommandLibraryPanelProps) {
  const normalizedLibrary = useMemo(() => normalizeAdbCommandLibrarySettings(library), [library]);
  const entries = useMemo(() => buildAdbCommandLibraryEntries(normalizedLibrary), [normalizedLibrary]);
  const examplePackJson = useMemo(() => formatAdbCommandPackJson(EXAMPLE_ADB_COMMAND_PACK), []);
  const customExport = useMemo(
    () => buildCustomAdbCommandPack(normalizedLibrary),
    [normalizedLibrary],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommandDraft>(() => createBlankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [latestRunResult, setLatestRunResult] = useState<AdbCommandRunResult | null>(null);

  const categories = useMemo(() => {
    const values = new Set(entries.map((entry) => entry.category).filter(Boolean));
    return [CATEGORY_ALL, CATEGORY_FAVORITES, ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category === CATEGORY_FAVORITES && !entry.is_favorite) {
        return false;
      }
      if (category !== CATEGORY_ALL && category !== CATEGORY_FAVORITES && entry.category !== category) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = [
        entry.title,
        entry.category,
        entry.command,
        entry.description,
        entry.pack_name,
        entry.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [category, entries, query]);

  const selectedEntry =
    filteredEntries.find((entry) => entry.library_id === selectedId) ??
    filteredEntries[0] ??
    entries[0] ??
    null;
  const selectedRunResult =
    selectedEntry && latestRunResult?.command_library_id === selectedEntry.library_id
      ? latestRunResult
      : null;

  const saveLibrary = async (nextLibrary: AdbCommandLibrarySettings, message: string): Promise<boolean> => {
    setFormError(null);
    setImportError(null);
    return onSaveLibrary(nextLibrary, message);
  };

  const openNewCommand = () => {
    setEditingCommandId(null);
    setDraft(createBlankDraft());
    setFormError(null);
    setDraftOpen(true);
  };

  const openEditCommand = (entry: AdbCommandLibraryEntry) => {
    if (!entry.editable) {
      return;
    }
    setEditingCommandId(entry.id);
    setDraft(buildDraftFromEntry(entry));
    setFormError(null);
    setDraftOpen(true);
  };

  const handleSaveDraft = async () => {
    const existingCommands = normalizedLibrary.custom_commands.filter(
      (command) => command.id !== editingCommandId,
    );
    const built = createCustomAdbCommand(
      {
        id: editingCommandId ?? undefined,
        title: draft.title,
        category: draft.category,
        command: draft.command,
        description: draft.description,
        tags: parseTagsInput(draft.tags),
        risk: draft.risk,
      },
      existingCommands,
    );
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    const nextLibrary = upsertCustomAdbCommand(normalizedLibrary, built.command);
    const saved = await saveLibrary(nextLibrary, editingCommandId ? "Command updated." : "Command saved.");
    if (!saved) {
      return;
    }
    setSelectedId(`custom:${built.command.id}`);
    setDraftOpen(false);
    setEditingCommandId(null);
    setDraft(createBlankDraft());
  };

  const handleDeleteCustom = async (entry: AdbCommandLibraryEntry) => {
    if (!entry.editable) {
      return;
    }
    if (!window.confirm(`Delete "${entry.title}"?`)) {
      return;
    }
    const saved = await saveLibrary(removeCustomAdbCommand(normalizedLibrary, entry.id), "Command deleted.");
    if (!saved) {
      return;
    }
    setSelectedId(null);
    setDraftOpen(false);
  };

  const handleRemovePack = async (entry: AdbCommandLibraryEntry) => {
    if (entry.source !== "imported" || !entry.pack_id) {
      return;
    }
    if (!window.confirm(`Remove "${entry.pack_name}"?`)) {
      return;
    }
    const saved = await saveLibrary(
      removeImportedAdbCommandPack(normalizedLibrary, entry.pack_id),
      "Command pack removed.",
    );
    if (!saved) {
      return;
    }
    setSelectedId(null);
  };

  const handleToggleFavorite = async (entry: AdbCommandLibraryEntry) => {
    await saveLibrary(
      setAdbCommandFavorite(normalizedLibrary, entry.library_id, !entry.is_favorite),
      entry.is_favorite ? "Favorite removed." : "Favorite saved.",
    );
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    const content = await file.text();
    const parsed = parseAdbCommandPackJson(content);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    const nextLibrary = mergeImportedAdbCommandPack(normalizedLibrary, parsed.pack);
    const saved = await saveLibrary(nextLibrary, `Imported ${parsed.pack.name}.`);
    if (!saved) {
      setImportError("Failed to save command pack.");
    }
  };

  const handleCopyExample = async () => {
    setImportError(null);
    await onCopyText(examplePackJson, "Example pack copied.");
  };

  const handleDownloadExample = () => {
    setImportError(null);
    try {
      downloadJsonFile(EXAMPLE_ADB_COMMAND_PACK_FILENAME, examplePackJson);
      onNotify("Example pack download started.", "info");
    } catch {
      setImportError("Download failed. Copy the example pack instead.");
      onNotify("Download failed. Copy the example pack instead.", "error");
    }
  };

  const handleExportCustomPack = async () => {
    setImportError(null);
    if (!customExport.ok) {
      onNotify(customExport.error, "error");
      return;
    }
    const content = formatAdbCommandPackJson(customExport.pack);
    try {
      downloadJsonFile(CUSTOM_ADB_COMMAND_PACK_FILENAME, content);
      onNotify("Custom command pack export started.", "info");
    } catch {
      await onCopyText(content, "Custom command pack copied.");
    }
  };

  const handleRunSelected = async (entry: AdbCommandLibraryEntry) => {
    const startedAt = new Date().toISOString();
    const previousResult = latestRunResult;
    setLatestRunResult(buildAdbCommandRunStartResult(entry, targetSerials, startedAt));
    const result = await onRunCommand(entry, startedAt);
    setLatestRunResult(result ?? previousResult);
  };

  const selectedTargetText =
    targetSerials.length === 1 ? "1 target" : `${targetSerials.length} targets`;
  const canRun =
    Boolean(selectedEntry) &&
    targetSerials.length > 0 &&
    !disabled &&
    selectedRunResult?.status !== "running";

  const renderOutputBlock = (
    label: "stdout" | "stderr",
    output: string,
    defaultOpen: boolean,
  ) => {
    if (!output.trim()) {
      return null;
    }
    return (
      <details className="adb-command-run-output" open={defaultOpen}>
        <summary>{label}</summary>
        <pre>{output}</pre>
      </details>
    );
  };

  return (
    <section className="panel adb-command-library-panel">
      <div className="panel-header adb-command-library-header">
        <div>
          <h2>ADB Command Library</h2>
          <span className="muted">{selectedTargetText}</span>
        </div>
        <div className="adb-command-library-actions">
          <button type="button" className="ghost" onClick={openNewCommand} disabled={disabled}>
            Add Command
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void handleExportCustomPack()}
            disabled={disabled || !customExport.ok}
            title={!customExport.ok ? customExport.error : "Export custom commands as a JSON pack"}
            aria-label="Export custom commands as a JSON pack"
          >
            Export Pack
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Import Pack
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (file) {
                void handleImportFile(file);
              }
            }}
          />
        </div>
      </div>

      <details className="adb-command-library-help">
        <summary>How to use command packs</summary>
        <div className="adb-command-library-help-content">
          <div className="adb-command-library-help-copy">
            <p>
              Command packs save reusable Android shell commands. Select a target device, choose a
              command, then run it manually.
            </p>
            <ul>
              <li>Add Command saves one custom shell command.</li>
              <li>Import Pack accepts JSON pack v1 and stores it without running anything.</li>
              <li>Commands may use plain shell content or an <code>adb shell</code> prefix.</li>
              <li>Full adb tasks such as install, pull, push, or reboot are rejected.</li>
              <li>Dangerous commands ask for confirmation before running.</li>
            </ul>
            <div className="adb-command-library-help-actions">
              <button type="button" className="ghost" onClick={() => void handleCopyExample()}>
                Copy Example
              </button>
              <button type="button" className="ghost" onClick={handleDownloadExample}>
                Download Example Pack
              </button>
            </div>
          </div>
          <pre className="adb-command-library-example-code">{examplePackJson}</pre>
        </div>
      </details>

      <div className="adb-command-library-toolbar">
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands"
          />
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === CATEGORY_ALL ? "All" : item === CATEGORY_FAVORITES ? "Favorites" : item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {importError && <div className="form-error">{importError}</div>}

      <div className="adb-command-library-layout">
        <div className="adb-command-library-list" role="listbox" aria-label="ADB commands">
          {filteredEntries.length === 0 ? (
            <div className="terminal-empty adb-command-library-empty">
              <h3>No commands</h3>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.library_id}
                type="button"
                className={`adb-command-library-row ${
                  selectedEntry?.library_id === entry.library_id ? "active" : ""
                }`}
                onClick={() => setSelectedId(entry.library_id)}
              >
                <span className="adb-command-library-row-title">{entry.title}</span>
                <span className="muted">{entry.category}</span>
                <code>{entry.command}</code>
              </button>
            ))
          )}
        </div>

        <div className="adb-command-library-detail">
          {draftOpen ? (
            <div className="adb-command-library-form">
              <div className="panel-header">
                <h3>{editingCommandId ? "Edit Command" : "Add Command"}</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setDraftOpen(false);
                    setEditingCommandId(null);
                    setFormError(null);
                  }}
                >
                  Close
                </button>
              </div>
              <label>
                Title
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label>
                Category
                <input
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, category: event.target.value }))
                  }
                />
              </label>
              <label>
                Shell command
                <textarea
                  value={draft.command}
                  onChange={(event) => setDraft((prev) => ({ ...prev, command: event.target.value }))}
                  rows={3}
                />
              </label>
              <label>
                Description
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                  rows={2}
                />
              </label>
              <label>
                Tags
                <input
                  value={draft.tags}
                  onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="display, debug"
                />
              </label>
              <label>
                Risk
                <select
                  value={draft.risk}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, risk: event.target.value as AdbCommandRisk }))
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="dangerous">Dangerous</option>
                </select>
              </label>
              {formError && <div className="form-error">{formError}</div>}
              <div className="adb-command-library-form-actions">
                <button type="button" onClick={() => void handleSaveDraft()} disabled={disabled}>
                  Save
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setDraftOpen(false);
                    setEditingCommandId(null);
                    setFormError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : selectedEntry ? (
            <>
              <div className="adb-command-library-detail-main">
                <div className="adb-command-library-title-row">
                  <h3>{selectedEntry.title}</h3>
                  <span className={`status-pill ${selectedEntry.risk === "dangerous" ? "warn" : "ok"}`}>
                    {selectedEntry.risk === "dangerous" ? "Dangerous" : "Normal"}
                  </span>
                </div>
                <div className="muted">{describeSource(selectedEntry)}</div>
                {selectedEntry.description && <p>{selectedEntry.description}</p>}
                <pre className="adb-command-library-command">{selectedEntry.command}</pre>
                {selectedEntry.tags.length > 0 && (
                  <div className="adb-command-library-tags">
                    {selectedEntry.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="adb-command-library-detail-actions">
                <button type="button" onClick={() => void handleRunSelected(selectedEntry)} disabled={!canRun}>
                  Run on Selected
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleToggleFavorite(selectedEntry)}
                  disabled={disabled}
                >
                  {selectedEntry.is_favorite ? "Unfavorite" : "Favorite"}
                </button>
                {selectedEntry.editable && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => openEditCommand(selectedEntry)}
                    disabled={disabled}
                  >
                    Edit
                  </button>
                )}
                {selectedEntry.editable && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void handleDeleteCustom(selectedEntry)}
                    disabled={disabled}
                  >
                    Delete
                  </button>
                )}
                {selectedEntry.source === "imported" && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void handleRemovePack(selectedEntry)}
                    disabled={disabled}
                  >
                    Remove Pack
                  </button>
                )}
              </div>
              {selectedRunResult && (
                <section className="adb-command-run-result" aria-live="polite">
                  <div className="adb-command-run-result-header">
                    <div>
                      <h4>Latest Result</h4>
                      <p className="muted">
                        {selectedRunResult.command_title} • {formatRunTime(selectedRunResult.completed_at)}
                      </p>
                    </div>
                    <span className={`status-pill ${runStatusTone(selectedRunResult.status)}`}>
                      {selectedRunResult.status}
                    </span>
                  </div>
                  <div className="adb-command-run-result-meta">
                    <span className="badge">
                      {selectedRunResult.devices.length} device
                      {selectedRunResult.devices.length === 1 ? "" : "s"}
                    </span>
                    {selectedRunResult.trace_id && (
                      <code title={selectedRunResult.trace_id}>trace {selectedRunResult.trace_id}</code>
                    )}
                  </div>
                  <div className="adb-command-run-devices">
                    {selectedRunResult.devices.map((device) => {
                      const hasOutput = Boolean(device.stdout.trim() || device.stderr.trim());
                      return (
                        <article key={device.serial} className="adb-command-run-device">
                          <div className="adb-command-run-device-header">
                            <strong>{device.serial}</strong>
                            <span className={`status-pill ${deviceRunStatusTone(device.status)}`}>
                              {device.status}
                            </span>
                            {device.exit_code != null && (
                              <span className="muted">exit {device.exit_code}</span>
                            )}
                          </div>
                          <p className="muted">{device.message}</p>
                          {renderOutputBlock("stdout", device.stdout, device.status === "success")}
                          {renderOutputBlock("stderr", device.stderr, device.status === "error")}
                          {!hasOutput && device.status !== "running" && (
                            <p className="muted adb-command-run-empty-output">No output.</p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="terminal-empty adb-command-library-empty">
              <h3>No commands</h3>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
