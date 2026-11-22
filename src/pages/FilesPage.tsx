import {
  memo,
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  DEFAULT_IMAGE_PREVIEW_ZOOM,
  formatImageZoomLabel,
  stepImageZoom,
  type ImagePreviewZoomState,
} from "../imagePreviewZoom";
import { formatBytes } from "../perf";
import { isTauriRuntime } from "../tauriEnv";
import type { DeviceFileEntry, FilePreview } from "../types";
import type { ContextMenuPosition } from "./AppsPage";

export type FileKind = "folder" | "apk" | "image" | "archive" | "text" | "file";

export type FilesViewMode = "list" | "grid";

export type FileBreadcrumb = {
  label: string;
  path: string;
};

export type FilesContextMenuState = {
  x: number;
  y: number;
  entry: DeviceFileEntry;
};

export function getFileKind(entry: DeviceFileEntry): FileKind {
  if (entry.is_dir) {
    return "folder";
  }
  const lower = entry.name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  if (["apk", "apks", "xapk"].includes(ext)) {
    return "apk";
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic"].includes(ext)) {
    return "image";
  }
  if (["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"].includes(ext)) {
    return "archive";
  }
  if (["txt", "log", "json", "xml", "md", "csv", "yaml", "yml"].includes(ext)) {
    return "text";
  }
  return "file";
}

export function getFileKindLabel(kind: FileKind): string {
  if (kind === "folder") {
    return "Folder";
  }
  if (kind === "apk") {
    return "APK";
  }
  if (kind === "image") {
    return "Image";
  }
  if (kind === "archive") {
    return "Archive";
  }
  if (kind === "text") {
    return "Text";
  }
  return "File";
}

export const FileTypeIcon = memo(function FileTypeIcon({ kind }: { kind: FileKind }) {
  if (kind === "folder") {
    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.5 4.5h3.9l1.2 1.2H13.5c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1V5.5c0-.6.4-1 1-1Z"
          fill="currentColor"
          opacity="0.9"
        />
        <path d="M1.5 6h13" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      </svg>
    );
  }

  if (kind === "image") {
    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.3" y="3" width="11.4" height="10" rx="2" fill="currentColor" opacity="0.25" />
        <path
          d="M4 11.2 6.2 8.8 8.1 10.7 10.1 8.5 12.3 11.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="6" cy="6.3" r="1" fill="currentColor" opacity="0.85" />
      </svg>
    );
  }

  if (kind === "archive") {
    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="3.2" width="10" height="9.6" rx="2" fill="currentColor" opacity="0.25" />
        <path
          d="M6.2 4.7h3.6M6.2 6.3h3.6M7.8 7.9v4.1"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M7.2 9.1h1.2"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    );
  }

  if (kind === "text") {
    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 2.5h5l3 3V13c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.5c0-.6.4-1 1-1Z"
          fill="currentColor"
          opacity="0.22"
        />
        <path
          d="M9 2.6V6h3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M5.1 7.6h6M5.1 9.4h6M5.1 11.2h4.2"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    );
  }

  if (kind === "apk") {
    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="5" y="2.7" width="6" height="10.6" rx="1.4" fill="currentColor" opacity="0.25" />
        <path
          d="M6.7 4.4h2.6"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M6.8 12h2.4"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
    );
  }

  return (
    <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 2.5h5l3 3V13c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.5c0-.6.4-1 1-1Z"
        fill="currentColor"
        opacity="0.22"
      />
      <path
        d="M9 2.6V6h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
});

export type FilesPageProps = {
  activeSerial: string | null;
  selectedSummaryLabel: string;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  busy: boolean;
  filesDropActive: boolean;
  filesPath: string;
  onFilesPathChange: (next: string) => void;
  onFilesGoUp: () => void;
  onFilesRefresh: (path?: string) => Promise<void>;
  onOpenFilesMkdirModal: () => void;
  onFileUpload: () => void;
  filesOverwriteEnabled: boolean;
  onFilesOverwriteEnabledChange: (next: boolean) => void;
  fileBreadcrumbs: FileBreadcrumb[];
  filesSearchQuery: string;
  onFilesSearchQueryChange: (next: string) => void;
  filesViewMode: FilesViewMode;
  onFilesViewModeChange: (next: FilesViewMode) => void;
  fileFilterSummary: string;
  files: DeviceFileEntry[];
  filteredFiles: DeviceFileEntry[];
  visibleFiles: DeviceFileEntry[];
  canLoadMoreFiles: boolean;
  onLoadMoreFiles: () => void;
  filesListRef: RefObject<HTMLDivElement | null>;
  filesLoadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  filesSelectedPaths: string[];
  setFilesSelectedPaths: Dispatch<SetStateAction<string[]>>;
  isFileSelected: (path: string) => boolean;
  toggleFileSelected: (path: string, checked: boolean) => void;
  onOpenFilesContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: DeviceFileEntry) => void;
  onFilePull: (entry: DeviceFileEntry) => Promise<void>;
  onFilePreview: (entry: DeviceFileEntry) => Promise<void>;
  filePreview: FilePreview | null;
  filePreviewDevicePath: string | null;
  onOpenExternalPath: (path: string) => Promise<void>;
  fileSelectionLabel: string;
  hasFileSelection: boolean;
  onFilesPullSelected: () => void;
  onOpenFilesDeleteSelectedModal: () => void;
  filesContextMenu: FilesContextMenuState | null;
  filesContextMenuPosition: ContextMenuPosition | null;
  filesContextMenuRef: RefObject<HTMLDivElement | null>;
  onCloseFilesContextMenu: () => void;
  onOpenFilesRenameModal: (entry: DeviceFileEntry) => void;
  onOpenFilesDeleteModal: (entry: DeviceFileEntry) => void;
  onCopyText: (text: string, successMessage: string) => Promise<void>;
  onNotifyInfo: (message: string) => void;
};

export const FilesPage = memo(function FilesPage({
  activeSerial,
  selectedSummaryLabel,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  busy,
  filesDropActive,
  filesPath,
  onFilesPathChange,
  onFilesGoUp,
  onFilesRefresh,
  onOpenFilesMkdirModal,
  onFileUpload,
  filesOverwriteEnabled,
  onFilesOverwriteEnabledChange,
  fileBreadcrumbs,
  filesSearchQuery,
  onFilesSearchQueryChange,
  filesViewMode,
  onFilesViewModeChange,
  fileFilterSummary,
  files,
  filteredFiles,
  visibleFiles,
  canLoadMoreFiles,
  onLoadMoreFiles,
  filesListRef,
  filesLoadMoreSentinelRef,
  filesSelectedPaths,
  setFilesSelectedPaths,
  isFileSelected,
  toggleFileSelected,
  onOpenFilesContextMenu,
  onFilePull,
  onFilePreview,
  filePreview,
  filePreviewDevicePath,
  onOpenExternalPath,
  fileSelectionLabel,
  hasFileSelection,
  onFilesPullSelected,
  onOpenFilesDeleteSelectedModal,
  filesContextMenu,
  filesContextMenuPosition,
  filesContextMenuRef,
  onCloseFilesContextMenu,
  onOpenFilesRenameModal,
  onOpenFilesDeleteModal,
  onCopyText,
  onNotifyInfo,
}: FilesPageProps) {
  const [filePreviewZoom, setFilePreviewZoom] = useState<ImagePreviewZoomState>(
    DEFAULT_IMAGE_PREVIEW_ZOOM,
  );

  useEffect(() => {
    setFilePreviewZoom(DEFAULT_IMAGE_PREVIEW_ZOOM);
  }, [filePreviewDevicePath]);

  return (
    <div className="page-section files-page page-section-stretch files-workspace">
      {filesDropActive && (
        <div className="file-drop-overlay">
          <div className="file-drop-overlay-inner">
            <strong>Drop files to upload</strong>
            <span className="muted">Target: {filesPath}</span>
          </div>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>File Explorer</h1>
          <p className="muted">Browse device storage, download files, and upload files.</p>
        </div>
      </div>
      <section className="panel panel-stretch files-panel">
        <div className="panel-header">
          <h2>Device Files</h2>
          <span>{selectedSummaryLabel}</span>
        </div>
        {singleSelectionWarning && (
          <div className="inline-alert info">
            <strong>Primary device in use</strong>
            <span>{singleSelectionWarningMessage}</span>
          </div>
        )}
        <div className="form-row files-nav-row">
          <label>Device path</label>
          <div className="files-nav-controls">
            <button
              className="ghost files-up-button"
              onClick={onFilesGoUp}
              disabled={busy || !activeSerial}
              title="Go to parent directory"
              aria-label="Go to parent directory"
            >
              Up
            </button>
            <input
              className="files-path-input"
              value={filesPath}
              onChange={(event) => onFilesPathChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (busy || !activeSerial) {
                  return;
                }
                void onFilesRefresh();
              }}
              placeholder="/sdcard"
            />
            <button
              className="files-go-button"
              onClick={() => void onFilesRefresh()}
              disabled={busy || !activeSerial}
            >
              Go
            </button>
          </div>
        </div>
        <div className="form-row files-action-row">
          <label>Actions</label>
          <div className="files-action-controls">
            <button
              className="ghost"
              onClick={onOpenFilesMkdirModal}
              disabled={busy || !activeSerial}
            >
              New folder
            </button>
            <button onClick={onFileUpload} disabled={busy || !activeSerial}>
              Upload
            </button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={filesOverwriteEnabled}
                onChange={(event) => onFilesOverwriteEnabledChange(event.target.checked)}
              />
              Overwrite existing
            </label>
          </div>
        </div>
        <div className="file-breadcrumbs">
          <span className="file-breadcrumbs-label">Breadcrumbs</span>
          <div className="file-breadcrumbs-trail">
            {fileBreadcrumbs.map((crumb, index) => (
              <span key={crumb.path} className="file-breadcrumbs-item">
                <button
                  className="ghost file-breadcrumb"
                  onClick={() => void onFilesRefresh(crumb.path)}
                  disabled={busy || !activeSerial}
                  aria-label={`Go to ${crumb.path}`}
                >
                  {crumb.label}
                </button>
                {index < fileBreadcrumbs.length - 1 && (
                  <span className="file-breadcrumbs-sep">/</span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="form-row file-search-row">
          <label>Quick filter</label>
          <input
            value={filesSearchQuery}
            onChange={(event) => onFilesSearchQueryChange(event.target.value)}
            placeholder="Type to filter by name or path"
          />
          <button
            className="ghost"
            onClick={() => onFilesSearchQueryChange("")}
            disabled={busy || !filesSearchQuery.trim()}
          >
            Clear filter
          </button>
          <div className="toggle-group files-view-toggle" role="group" aria-label="File view mode">
            <button
              type="button"
              className={`toggle${filesViewMode === "list" ? " active" : ""}`}
              onClick={() => onFilesViewModeChange("list")}
              title="List view"
            >
              List
            </button>
            <button
              type="button"
              className={`toggle${filesViewMode === "grid" ? " active" : ""}`}
              onClick={() => onFilesViewModeChange("grid")}
              title="Grid view"
            >
              Icons
            </button>
          </div>
          <span className="muted file-filter-meta">{fileFilterSummary}</span>
        </div>
        <div className="split files-split split-stretch">
          <div
            className={filesViewMode === "grid" ? "file-grid" : "file-list"}
            ref={filesListRef}
          >
            {files.length === 0 ? (
              <p className="muted">No files loaded. Press Enter in Device path or click Go.</p>
            ) : filteredFiles.length === 0 ? (
              <p className="muted">No matches. Clear the filter to see all items.</p>
            ) : (
              visibleFiles.map((entry) => {
                const kind = getFileKind(entry);
                const kindLabel = getFileKindLabel(kind);
                const sizeLabel = entry.size_bytes == null ? "—" : formatBytes(entry.size_bytes);
                const isSelected = isFileSelected(entry.path);

                if (filesViewMode === "grid") {
                  return (
                    <div
                      key={entry.path}
                      className={`file-card${isSelected ? " is-selected" : ""}`}
                      onContextMenu={(event) => onOpenFilesContextMenu(event, entry)}
                      onDoubleClick={() => {
                        if (busy || !activeSerial) {
                          return;
                        }
                        if (entry.is_dir) {
                          void onFilesRefresh(entry.path);
                        } else {
                          void onFilePull(entry);
                        }
                      }}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey) {
                          toggleFileSelected(entry.path, !isSelected);
                          return;
                        }
                        setFilesSelectedPaths((prev) =>
                          prev.length === 1 && prev[0] === entry.path ? prev : [entry.path],
                        );
                      }}
                    >
                      <div className="file-card-check">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => toggleFileSelected(entry.path, event.target.checked)}
                          disabled={busy}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className={`file-card-icon kind-${kind}`} title={kindLabel}>
                        <FileTypeIcon kind={kind} />
                      </div>
                      <div className="file-card-name" title={entry.name}>
                        {entry.name}
                      </div>
                      <button
                        className="ghost icon-only file-card-menu"
                        onClick={(event) => onOpenFilesContextMenu(event, entry)}
                        title="Actions"
                      >
                        ⋯
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={entry.path}
                    className={`file-row${isSelected ? " is-selected" : ""}`}
                    onContextMenu={(event) => onOpenFilesContextMenu(event, entry)}
                    onDoubleClick={() => {
                      if (busy || !activeSerial) {
                        return;
                      }
                      if (entry.is_dir) {
                        void onFilesRefresh(entry.path);
                      } else {
                        void onFilePull(entry);
                      }
                    }}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        toggleFileSelected(entry.path, !isSelected);
                        return;
                      }
                      setFilesSelectedPaths((prev) =>
                        prev.length === 1 && prev[0] === entry.path ? prev : [entry.path],
                      );
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => toggleFileSelected(entry.path, event.target.checked)}
                      disabled={busy}
                      aria-label={`Select ${entry.name}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div
                      className={`file-row-icon kind-${kind}`}
                      title={kindLabel}
                      aria-hidden="true"
                    >
                      <FileTypeIcon kind={kind} />
                    </div>
                    <div className="file-row-main">
                      <strong title={entry.path}>{entry.name}</strong>
                      <p className="muted">{kindLabel}</p>
                    </div>
                    <div className="file-row-meta">
                      {entry.is_dir ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="file-row-size">{sizeLabel}</span>
                      )}
                    </div>
                    <div className="file-row-actions">
                      <button
                        type="button"
                        className="ghost icon-only"
                        onClick={(event) => onOpenFilesContextMenu(event, entry)}
                        disabled={busy}
                        title="File actions"
                        aria-label={`Actions for ${entry.name}`}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {files.length > 0 && filteredFiles.length > 0 && (
              <div className="file-list-footer">
                <span className="muted">
                  Showing {visibleFiles.length}/{filteredFiles.length}
                </span>
                {canLoadMoreFiles ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={onLoadMoreFiles}
                    disabled={busy}
                  >
                    Load more
                  </button>
                ) : (
                  <span className="muted">All loaded</span>
                )}
              </div>
            )}
            <div className="file-load-more-sentinel" ref={filesLoadMoreSentinelRef} />
          </div>
          <div className="preview-panel">
            <h3>Preview</h3>

            {(() => {
              if (!activeSerial) {
                return <p className="muted">Select a device to preview files.</p>;
              }
              if (filesSelectedPaths.length !== 1) {
                return <p className="muted">Select one file to preview.</p>;
              }
              const selectedPath = filesSelectedPaths[0];
              const entry = files.find((item) => item.path === selectedPath);
              if (!entry) {
                return <p className="muted">Select a file to preview.</p>;
              }
              if (entry.is_dir) {
                return <p className="muted">Folder selected. Double click to open.</p>;
              }

              const kind = getFileKind(entry);
              const canPreview = kind === "image" || kind === "text";
              const previewMatches = filePreview && filePreviewDevicePath === entry.path;
              const isImage = previewMatches && filePreview.mime_type.startsWith("image/");
              const imageSrc = isImage
                ? filePreview.preview_data_url ??
                  (isTauriRuntime() ? convertFileSrc(filePreview.local_path) : null)
                : null;

              if (!previewMatches) {
                return (
                  <div className="preview-empty">
                    <p className="muted">
                      {canPreview
                        ? "Preview is available for this file."
                        : "Preview is available for image and text files."}
                    </p>
                    <div className="button-row compact">
                      <button
                        onClick={() => void onFilePreview(entry)}
                        disabled={busy || !canPreview}
                      >
                        Preview
                      </button>
                      <button
                        className="ghost"
                        onClick={() => void onFilePull(entry)}
                        disabled={busy}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <>
                  {isImage ? (
                    imageSrc ? (
                      <div className="stack" style={{ gap: 8 }}>
                        <div className="button-row compact">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setFilePreviewZoom((prev) => stepImageZoom(prev, "out"))}
                          >
                            Zoom -
                          </button>
                          <span className="badge">{formatImageZoomLabel(filePreviewZoom)}</span>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setFilePreviewZoom((prev) => stepImageZoom(prev, "in"))}
                          >
                            Zoom +
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setFilePreviewZoom({ mode: "custom", scale: 1 })}
                          >
                            100%
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setFilePreviewZoom(DEFAULT_IMAGE_PREVIEW_ZOOM)}
                          >
                            Fit
                          </button>
                        </div>
                        <div
                          style={{
                            overflow: "auto",
                            maxHeight: 420,
                            borderRadius: 8,
                          }}
                        >
                          <img
                            className="preview-image"
                            src={imageSrc}
                            alt={entry.name}
                            style={
                              filePreviewZoom.mode === "custom"
                                ? {
                                    maxWidth: "none",
                                    maxHeight: "none",
                                    width: `${Math.round(filePreviewZoom.scale * 100)}%`,
                                  }
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="muted">Image preview requires the desktop app runtime.</p>
                    )
                  ) : filePreview.is_text && filePreview.preview_text ? (
                    <pre>{filePreview.preview_text}</pre>
                  ) : (
                    <p className="muted">Preview not available ({filePreview.mime_type}).</p>
                  )}

                  <div className="button-row compact">
                    <button
                      onClick={() => void onOpenExternalPath(filePreview.local_path)}
                      disabled={busy}
                    >
                      Open Externally
                    </button>
                    <button
                      className="ghost"
                      onClick={() => void onFilePull(entry)}
                      disabled={busy}
                    >
                      Download
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        <div className="file-bulk-bar">
          <span className="muted">{fileSelectionLabel}</span>
          <div className="file-bulk-actions">
            <button
              className="ghost"
              onClick={() => setFilesSelectedPaths([])}
              disabled={busy || !activeSerial || !hasFileSelection}
            >
              Clear selection
            </button>
            <button
              onClick={onFilesPullSelected}
              disabled={busy || !activeSerial || !hasFileSelection}
            >
              Download selected
            </button>
            <button
              className="danger"
              onClick={onOpenFilesDeleteSelectedModal}
              disabled={busy || !activeSerial || !hasFileSelection}
            >
              Delete selected
            </button>
          </div>
        </div>

        {filesContextMenu && (
          <>
            <div className="context-menu-backdrop" onClick={onCloseFilesContextMenu} />
            <div
              ref={filesContextMenuRef}
              className="context-menu context-menu-scrollable"
              style={{
                top: filesContextMenuPosition?.top ?? filesContextMenu.y,
                left: filesContextMenuPosition?.left ?? Math.max(10, filesContextMenu.x - 160),
                maxHeight: filesContextMenuPosition?.maxHeight,
                width: 280,
              }}
            >
              {(() => {
                const entry = filesContextMenu.entry;
                const kind = getFileKind(entry);
                const kindLabel = getFileKindLabel(kind);
                const sizeLabel = entry.is_dir
                  ? "—"
                  : entry.size_bytes == null
                    ? "—"
                    : formatBytes(entry.size_bytes);
                const modifiedLabel = entry.modified_at ? entry.modified_at : "";
                const previewable = !entry.is_dir && (kind === "image" || kind === "text");

                return (
                  <>
                    <div className="context-menu-header">
                      <div className="context-menu-header-title">{entry.name}</div>
                      <div className="context-menu-header-sub">
                        {kindLabel} · {sizeLabel}
                        {modifiedLabel ? ` · ${modifiedLabel}` : ""}
                      </div>
                      <div className="context-menu-header-sub">{entry.path}</div>
                    </div>
                    <div className="context-menu-sep" />

                    {entry.is_dir ? (
                      <button
                        type="button"
                        className="context-menu-item"
                        onClick={() => {
                          onCloseFilesContextMenu();
                          void onFilesRefresh(entry.path);
                        }}
                        disabled={busy || !activeSerial}
                      >
                        Open folder
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="context-menu-item"
                          onClick={() => {
                            onCloseFilesContextMenu();
                            void onFilePull(entry);
                          }}
                          disabled={busy || !activeSerial}
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          className="context-menu-item"
                          onClick={() => {
                            onCloseFilesContextMenu();
                            void onFilePreview(entry);
                          }}
                          disabled={busy || !activeSerial || !previewable}
                          title={
                            previewable ? "" : "Preview is supported for image and text files."
                          }
                        >
                          Preview
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      className="context-menu-item"
                      onClick={() => {
                        onOpenFilesRenameModal(entry);
                        onCloseFilesContextMenu();
                      }}
                      disabled={busy || !activeSerial}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="context-menu-item danger"
                      onClick={() => {
                        onOpenFilesDeleteModal(entry);
                        onCloseFilesContextMenu();
                      }}
                      disabled={busy || !activeSerial}
                    >
                      Delete
                    </button>

                    <div className="context-menu-sep" />

                    <button
                      type="button"
                      className="context-menu-item"
                      onClick={() => {
                        void onCopyText(entry.path, "Path copied.");
                        onCloseFilesContextMenu();
                      }}
                    >
                      Copy path
                    </button>
                    <button
                      type="button"
                      className="context-menu-item"
                      onClick={() => {
                        void onCopyText(entry.name, "Name copied.");
                        onCloseFilesContextMenu();
                      }}
                    >
                      Copy name
                    </button>

                    <div className="context-menu-sep" />

                    <button
                      type="button"
                      className="context-menu-item"
                      onClick={() => {
                        onNotifyInfo(
                          `${kindLabel}: ${entry.name} · ${sizeLabel}${modifiedLabel ? ` · ${modifiedLabel}` : ""}`,
                        );
                        onCloseFilesContextMenu();
                      }}
                    >
                      Get info
                    </button>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </section>
    </div>
  );
});
