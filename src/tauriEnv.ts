// Minimal runtime detection to prevent calling Tauri-only APIs in a plain browser.
// This keeps `npm run dev` usable for UI smoke checks and avoids crashing effects.

export function isTauriRuntime(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;

  // Tauri v2 exposes internal IPC via __TAURI_INTERNALS__ in the webview.
  if (g.__TAURI_INTERNALS__ != null) {
    return true;
  }

  // Some environments/plugins may expose __TAURI__ or __TAURI_IPC__.
  if (g.__TAURI__ != null || g.__TAURI_IPC__ != null) {
    return true;
  }

  return false;
}

