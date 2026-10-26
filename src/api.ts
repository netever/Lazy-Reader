// Calls into the Rust core (src-tauri/src). Each function maps to one Tauri command.
import { invoke } from "@tauri-apps/api/core";
import type { StateFile } from "./reader/locator";

export interface BookMeta {
  schema: number;
  bookId: string;
  sha256: string;
  fileName: string;
  format: "epub" | "fb2" | "fbz" | "cbz" | "pdf" | "mobi" | "azw3";
  title: string | null;
  authors: string[];
  language: string | null;
  addedAt: number;
  updatedAt: number;
  size: number;
}

export interface Settings {
  schema: number;
  lastBookId?: string | null;
  fontSize?: number;
  animated?: boolean;
  [key: string]: unknown;
}

const IMPORT_CHUNK = 4 * 1024 * 1024;

/** Copy a file into the library in chunks, so big books never sit in memory whole. */
export async function importBook(file: File, onProgress?: (fraction: number) => void): Promise<BookMeta> {
  const importId = await invoke<string>("import_begin", { fileName: file.name });
  try {
    for (let offset = 0; offset < file.size; offset += IMPORT_CHUNK) {
      const chunk = new Uint8Array(await file.slice(offset, offset + IMPORT_CHUNK).arrayBuffer());
      await invoke("import_chunk", chunk, { headers: { "x-import-id": importId } });
      onProgress?.(Math.min(1, (offset + chunk.length) / file.size));
    }
    return await invoke<BookMeta>("import_finish", { importId });
  } catch (e) {
    await invoke("import_cancel", { importId }).catch(() => undefined);
    throw e;
  }
}

export const listBooks = () => invoke<BookMeta[]>("list_books");
export const getBook = (bookId: string) => invoke<BookMeta>("get_book", { bookId });
export const readBook = (bookId: string) => invoke<ArrayBuffer>("read_book", { bookId });
export const readBookRange = (bookId: string, offset: number, length: number) =>
  invoke<ArrayBuffer>("read_book_range", { bookId, offset, length });
export const updateBookInfo = (bookId: string, title: string | null, authors: string[], language: string | null) =>
  invoke<BookMeta>("update_book_info", { bookId, title, authors, language });

export const loadState = (bookId: string) => invoke<StateFile | null>("load_state", { bookId });
export const saveState = (bookId: string, state: StateFile) => invoke<void>("save_state", { bookId, state });
export const loadSettings = () => invoke<Settings | null>("load_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });
export const deviceId = () => invoke<string>("device_id");

/** Startup and animation measurements, see docs/PERF.md. Never fails the caller. */
export function perfMark(name: string, detail?: string): void {
  invoke("perf_mark", { name, detail }).catch(() => undefined);
}
