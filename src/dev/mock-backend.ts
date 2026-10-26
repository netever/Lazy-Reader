// Development only: lets the interface run in an ordinary browser (`npm run dev`, then open
// http://localhost:1420) without the Rust core. Books come from test-books/, state and settings
// live in localStorage. Used for quick checks of the reader logic in a Chromium browser.
// main.tsx loads this module only when import.meta.env.DEV is set and Tauri is absent.
import { mockIPC } from "@tauri-apps/api/mocks";

interface Book {
  bookId: string;
  fileName: string;
  path: string;
  format: string;
  size: number;
  title: string | null;
  authors: string[];
}

const FIXTURES: Omit<Book, "size" | "title" | "authors">[] = [
  { bookId: "test-epub", fileName: "sample.epub", path: "/test-books/sample.epub", format: "epub" },
  { bookId: "test-fb2", fileName: "sample-cp1251.fb2", path: "/test-books/sample-cp1251.fb2", format: "fb2" },
  { bookId: "test-fbz", fileName: "sample.fb2.zip", path: "/test-books/sample.fb2.zip", format: "fbz" },
  { bookId: "test-cbz", fileName: "SAMPLE-UPPER.CBZ", path: "/test-books/SAMPLE-UPPER.CBZ", format: "cbz" },
  { bookId: "test-pdf", fileName: "sample.pdf", path: "/test-books/sample.pdf", format: "pdf" },
  { bookId: "test-big-pdf", fileName: "big.pdf", path: "/test-books/large/big.pdf", format: "pdf" },
  { bookId: "test-big-tree-pdf", fileName: "big-tree.pdf", path: "/test-books/large/big-tree.pdf", format: "pdf" },
];

const books = new Map<string, Book>();
const KEY = "mock-backend:";

async function loadFixtures() {
  for (const f of FIXTURES) {
    const head = await fetch(f.path, { method: "HEAD" }).catch(() => null);
    const size = Number(head?.headers.get("content-length") ?? 0);
    if (!head?.ok || !size) continue;
    const info = JSON.parse(localStorage.getItem(KEY + "info:" + f.bookId) ?? "{}");
    books.set(f.bookId, { ...f, size, title: info.title ?? null, authors: info.authors ?? [] });
  }
}

function meta(b: Book) {
  return { schema: 1, sha256: "", addedAt: 0, updatedAt: 0, language: null, ...b };
}

export async function installMockBackend() {
  await loadFixtures();
  (window as unknown as { __MOCK_BACKEND__: boolean }).__MOCK_BACKEND__ = true;
  mockIPC(async (cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    const book = books.get(String(args.bookId ?? ""));
    switch (cmd) {
      case "list_books":
        return [...books.values()].map(meta);
      case "get_book":
        if (!book) throw new Error("book not found");
        return meta(book);
      case "read_book":
        return (await fetch(book!.path)).arrayBuffer();
      case "read_book_range": {
        const stats = ((window as unknown as { __rangeStats: { calls: number; bytes: number; offsets: number[] } })
          .__rangeStats ??= { calls: 0, bytes: 0, offsets: [] });
        stats.calls += 1;
        stats.bytes += Number(args.length);
        if (stats.offsets.length < 40) stats.offsets.push(Number(args.offset));
        const offset = Number(args.offset);
        const end = offset + Number(args.length) - 1;
        const res = await fetch(book!.path, { headers: { Range: `bytes=${offset}-${end}` } });
        if (res.status !== 206) throw new Error(`no range support: ${res.status}`);
        return res.arrayBuffer();
      }
      case "update_book_info":
        localStorage.setItem(KEY + "info:" + args.bookId, JSON.stringify({ title: args.title, authors: args.authors }));
        Object.assign(book!, { title: args.title, authors: args.authors });
        return meta(book!);
      case "load_state":
        return JSON.parse(localStorage.getItem(KEY + "state:" + args.bookId) ?? "null");
      case "save_state":
        localStorage.setItem(KEY + "state:" + args.bookId, JSON.stringify(args.state));
        return null;
      case "load_settings":
        return JSON.parse(localStorage.getItem(KEY + "settings") ?? "null");
      case "save_settings":
        localStorage.setItem(KEY + "settings", JSON.stringify(args.settings));
        return null;
      case "device_id":
        return "browser-dev";
      case "perf_mark":
        console.info(`PERF ${args.name} ${args.detail ?? ""}`);
        return null;
      default:
        throw new Error(`mock backend: command ${cmd} is not supported`);
    }
  });
}
