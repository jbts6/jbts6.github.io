export function isTauriRuntime(): boolean {
  // Tauri injects a __TAURI__ global in the browser window.
  // In pure web builds this should not exist.
  // We keep it loose to avoid bundler issues across environments.
  return typeof window !== "undefined" && typeof (window as any).__TAURI__ !== "undefined";
}

