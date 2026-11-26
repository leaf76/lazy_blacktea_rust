import type { DeviceFileEntry } from "./types";

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
