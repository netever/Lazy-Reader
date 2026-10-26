// Base64 for import chunks on Android, where Tauri IPC carries only JSON (see import_chunk
// in src-tauri/src/library.rs). Works in old WebViews without Uint8Array.prototype.toBase64.
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export const isAndroid = () => /Android/i.test(navigator.userAgent);
